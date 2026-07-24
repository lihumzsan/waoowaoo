import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/creative-resource/generation-contract'
import {
  CREATIVE_RESOURCE_SCHEMA,
  isCreativeResourceMediaType,
} from '@/lib/creative-resource'
import {
  buildCreativeWorkInputFingerprint,
  CREATIVE_WORK_TASK_PROTOCOL,
  creativeWorkDelegationInputSchema,
  creativeWorkTaskPayloadSchema,
  projectAdoptedCreativeDirection,
  readAdoptedCreativeDirectionSnapshot,
  readCreativeWorkOutputDefinition,
  type AdoptedCreativeDirectionSnapshot,
  type CreativeWorkDelegationInput,
  type CreativeWorkDelegationItem,
  type CreativeWorkHydratedRequest,
  type CreativeWorkTaskRequest,
} from '@/lib/creative-worker'
import { compileEpisodeChapterContexts } from '@/lib/edit-chapter'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskBatchSubmitOperationOutputSchema } from '@/lib/operations/output-schemas'
import { requireProjectVideoRatio } from '@/lib/operations/project-video-ratio-policy'
import { submitOperationTaskBatch } from '@/lib/operations/submit-operation-task'
import {
  writeOperationDataPart,
  type ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { prisma } from '@/lib/prisma'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import { createTaskBatchKey } from '@/lib/task/batch'
import { TASK_TYPE } from '@/lib/task/types'

const creativeWorkDelegationOutputSchema = refineTaskBatchSubmitOperationOutputSchema(z.object({
  success: z.literal(true),
  async: z.literal(true),
  batchKey: z.string().trim().min(1),
  total: z.number().int().positive(),
  taskIds: z.array(z.string().trim().min(1)).min(1),
  results: z.array(z.object({
    refId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    taskType: z.literal(TASK_TYPE.CREATIVE_WORK),
    targetType: z.literal('CreativeWork'),
    targetId: z.string().trim().min(1),
  }).strict()).min(1),
}).strict())

const EFFECTS_CREATIVE_TASK = {
  writes: true,
  workspaceResourceImpact: 'none',
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: true,
  externalSideEffects: true,
  longRunning: true,
} as const

const CREATIVE_CHAPTER_CONTEXT_MAX_CHARS = 200_000

function requireInvocationIdentity(input: {
  runId?: string | null
  toolCallId?: string | null
}): { runId: string; toolCallId: string } {
  const runId = input.runId?.trim() || ''
  const toolCallId = input.toolCallId?.trim() || ''
  if (!runId || !toolCallId) throw new Error('CREATIVE_WORK_INVOCATION_IDENTITY_REQUIRED')
  return { runId, toolCallId }
}

function resolveEpisodeId(input: string | undefined, contextEpisodeId: unknown): string {
  const episodeId = input?.trim()
    || (typeof contextEpisodeId === 'string' ? contextEpisodeId.trim() : '')
  if (!episodeId) throw new Error('EPISODE_REQUIRED')
  return episodeId
}

async function resolveDelegationRequests(input: {
  readonly operationInput: CreativeWorkDelegationInput['delegation']
  readonly projectId: string
  readonly userId: string
  readonly contextEpisodeId: unknown
}): Promise<CreativeWorkHydratedItem[]> {
  const operationInput = input.operationInput
  if (operationInput.source === 'requests') {
    return await hydrateExactResourceMaterials({
      requests: operationInput.requests,
      projectId: input.projectId,
      userId: input.userId,
    })
  }
  const compiled = await compileEpisodeChapterContexts({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: resolveEpisodeId(undefined, input.contextEpisodeId),
    chapterIds: operationInput.chapters.map((chapter) => chapter.chapterId),
    referencedAssets: operationInput.referencedAssets,
    maxCharsPerChapter: CREATIVE_CHAPTER_CONTEXT_MAX_CHARS,
  })
  const requests = compiled.map((result, index) => {
    const requestedChapter = operationInput.chapters[index]
    if (!requestedChapter || requestedChapter.chapterId !== result.context.chapter.chapterId) {
      throw new Error(`CREATIVE_WORK_CHAPTER_CONTEXT_ORDER_MISMATCH:${String(index)}`)
    }
    const sourceStart = result.context.source.sourceStart
    const sourceEnd = result.context.source.sourceEnd
    return {
      requestKey: requestedChapter.requestKey,
      outputKind: operationInput.outputKind,
      goal: `${operationInput.goal}\nChapter ${String(result.context.chapter.chapterIndex + 1)}: ${result.context.chapter.title}`,
      durationIntent: requestedChapter.durationIntent,
      context: {
        userRequest: operationInput.userRequest,
        sourceMaterials: [
          {
            kind: 'inline' as const,
            label: `Chapter ${String(result.context.chapter.chapterIndex + 1)} context`,
            mediaType: 'structured' as const,
            content: JSON.stringify(result.context),
            provenance: {
              kind: 'domain' as const,
              sourceType: 'creative_chapter_context',
              sourceId: result.context.chapter.chapterId,
              revision: `${String(sourceStart)}:${String(sourceEnd)}`,
            },
          },
        ],
        constraints: operationInput.constraints,
      },
    }
  })
  return await hydrateExactResourceMaterials({
    requests,
    projectId: input.projectId,
    userId: input.userId,
  })
}

async function hydrateExactResourceMaterials(input: {
  readonly requests: readonly CreativeWorkDelegationItem[]
  readonly projectId: string
  readonly userId: string
}): Promise<CreativeWorkHydratedItem[]> {
  const revisionIds = [...new Set(input.requests.flatMap((request) => (
    request.context.sourceMaterials.flatMap((source) => (
      source.kind === 'resource' ? [source.revisionId] : []
    ))
  )))]
  const revisions = revisionIds.length > 0 ? await prisma.creativeResourceRevision.findMany({
      where: {
        id: { in: revisionIds },
        resource: {
          userId: input.userId,
          status: 'ready',
          OR: [
            { projectId: input.projectId },
            { scopeKind: 'user', scopeId: input.userId, projectId: null, episodeId: null },
          ],
        },
      },
      select: {
        id: true,
        contentText: true,
        contentJson: true,
        sourceType: true,
        sourceId: true,
        sourceRevision: true,
        prompt: true,
        media: { select: { mimeType: true, width: true, height: true, durationMs: true } },
        resource: {
          select: {
            id: true,
            name: true,
            mediaType: true,
            schemaId: true,
            creativeData: true,
            projectId: true,
            episodeId: true,
          },
        },
      },
    }) : []
  if (revisions.length !== revisionIds.length) {
    const found = new Set(revisions.map((revision) => revision.id))
    const missing = revisionIds.find((revisionId) => !found.has(revisionId)) ?? 'unknown'
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_WORK_RESOURCE_REVISION_NOT_FOUND',
      field: 'sourceMaterials.provenance.revisionId',
      revisionId: missing,
      agentRetryableAfterCorrection: true,
    })
  }
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]))
  return input.requests.map((request) => {
    const usedRevisionIds = new Set<string>()
    const resourceSchemas: Array<{ revisionId: string; schemaId: string }> = []
    const sourceMaterials = request.context.sourceMaterials.map((source) => {
      if (source.kind === 'inline') {
        return {
          label: source.label,
          kind: source.mediaType,
          content: source.content,
          provenance: source.provenance,
        }
      }
      const revisionId = source.revisionId
      if (usedRevisionIds.has(revisionId)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_WORK_RESOURCE_REVISION_DUPLICATE',
          field: 'sourceMaterials.provenance.revisionId',
          revisionId,
          agentRetryableAfterCorrection: true,
        })
      }
      usedRevisionIds.add(revisionId)
      const revision = revisionById.get(revisionId)
      if (!revision) throw new Error(`CREATIVE_WORK_RESOURCE_REVISION_MISSING:${revisionId}`)
      if (!isCreativeResourceMediaType(revision.resource.mediaType)) {
        throw new Error(`CREATIVE_WORK_RESOURCE_MEDIA_TYPE_INVALID:${revisionId}`)
      }
      resourceSchemas.push({ revisionId, schemaId: revision.resource.schemaId })
      const kind = revision.contentJson !== null
        ? 'structured' as const
        : revision.contentText !== null
          ? 'text' as const
          : revision.resource.mediaType
      const content = revision.contentJson !== null
        ? JSON.stringify(revision.contentJson)
        : revision.contentText !== null
          ? revision.contentText
          : JSON.stringify({
              name: revision.resource.name,
              schemaId: revision.resource.schemaId,
              prompt: revision.prompt,
              creativeData: revision.resource.creativeData,
              media: revision.media,
              domainSource: revision.sourceType && revision.sourceId && revision.sourceRevision
                ? {
                    sourceType: revision.sourceType,
                    sourceId: revision.sourceId,
                    sourceRevision: revision.sourceRevision,
                  }
                : null,
            })
      return {
        label: revision.resource.name,
        kind,
        content,
        provenance: { kind: 'resource' as const, revisionId },
      }
    })
    const manuallySuppliedDirection = resourceSchemas.find(
      (source) => source.schemaId === CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    )
    if (request.outputKind !== 'creative_direction' && manuallySuppliedDirection) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_DIRECTION_MANUAL_REFERENCE_FORBIDDEN',
        field: 'sourceMaterials',
        revisionId: manuallySuppliedDirection.revisionId,
        agentRetryableAfterCorrection: true,
      })
    }
    if (request.outputKind === 'asset_manifest') {
      const screenplaySources = resourceSchemas.filter(
        (source) => source.schemaId === CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
      )
      if (screenplaySources.length !== 1) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'ASSET_MANIFEST_SCREENPLAY_SOURCE_REQUIRED',
          field: 'sourceMaterials',
          agentRetryableAfterCorrection: true,
        })
      }
    }
    return {
      ...request,
      context: { ...request.context, sourceMaterials },
    }
  })
}

type CreativeWorkHydratedItem = CreativeWorkHydratedRequest & { readonly requestKey: string }
type CreativeWorkTaskItem = CreativeWorkTaskRequest & { readonly requestKey: string }

function canComposeDuration(target: number, options: readonly number[]): boolean {
  const reachable = new Uint8Array(target + 1)
  reachable[0] = 1
  for (let duration = 1; duration <= target; duration += 1) {
    reachable[duration] = options.some((option) => duration >= option && reachable[duration - option] === 1)
      ? 1
      : 0
  }
  return reachable[target] === 1
}

async function resolveTaskRequests(input: {
  readonly requests: readonly CreativeWorkHydratedItem[]
  readonly projectId: string
  readonly userId: string
  readonly adoptedCreativeDirection: AdoptedCreativeDirectionSnapshot | null
}): Promise<CreativeWorkTaskItem[]> {
  const needsVideoProduction = input.requests.some((request) => request.outputKind === 'video_prompt_set')
  if (!needsVideoProduction) {
    return input.requests.map((request) => ({
      ...request,
      creativeDirection: projectAdoptedCreativeDirection({
        snapshot: input.adoptedCreativeDirection,
        outputKind: request.outputKind,
      }),
      productionContext: { video: null },
    }))
  }

  const [project, videoModelKey] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: { videoRatio: true },
    }),
    resolveSystemModelKey({
      userId: input.userId,
      projectId: input.projectId,
      purpose: 'video',
    }),
  ])
  if (!project) {
    throw new ApiError('NOT_FOUND', { code: 'PROJECT_NOT_FOUND', field: 'projectId' })
  }
  const aspectRatio = requireProjectVideoRatio(project.videoRatio).value
  const rawDurationOptions = resolveBuiltinCapabilitiesByModelKey('video', videoModelKey)?.video?.durationOptions ?? []
  const allowedSegmentDurationsSeconds = Array.from(new Set(rawDurationOptions
    .filter((duration): duration is number => Number.isInteger(duration)
      && duration > 0
      && duration <= CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS)))
    .sort((left, right) => left - right)
  const minSegmentDurationSeconds = allowedSegmentDurationsSeconds[0]
  const maxSegmentDurationSeconds = allowedSegmentDurationsSeconds.at(-1)
  if (minSegmentDurationSeconds === undefined || maxSegmentDurationSeconds === undefined) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_DURATION_CAPABILITY_REQUIRED',
      field: 'durationSeconds',
    })
  }

  return input.requests.map((request) => {
    if (request.outputKind !== 'video_prompt_set') {
      return {
        ...request,
        creativeDirection: projectAdoptedCreativeDirection({
          snapshot: input.adoptedCreativeDirection,
          outputKind: request.outputKind,
        }),
        productionContext: { video: null },
      }
    }
    const durationIntent = request.durationIntent
    if (durationIntent === undefined) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_VIDEO_DURATION_INTENT_REQUIRED',
        field: 'durationIntent',
        allowedValues: allowedSegmentDurationsSeconds,
        agentRetryableAfterCorrection: true,
      })
    }
    if (
      durationIntent.mode === 'fixed'
      && !canComposeDuration(durationIntent.seconds, allowedSegmentDurationsSeconds)
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_VIDEO_TARGET_DURATION_UNSUPPORTED',
        field: 'durationIntent.seconds',
        requestedValue: durationIntent.seconds,
        allowedValues: allowedSegmentDurationsSeconds,
        agentRetryableAfterCorrection: true,
      })
    }
    return {
      ...request,
      creativeDirection: projectAdoptedCreativeDirection({
        snapshot: input.adoptedCreativeDirection,
        outputKind: request.outputKind,
      }),
      productionContext: {
        video: {
          aspectRatio,
          allowedSegmentDurationsSeconds,
          minSegmentDurationSeconds,
          maxSegmentDurationSeconds,
        },
      },
    }
  })
}

export function createAssistantCreativeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    delegate_creative_work: defineOperation({
      id: 'delegate_creative_work',
      summary: 'Delegate one or more bounded professional creative reasoning requests to background Subagents. Set delegation.source=requests with a one-or-more requests list for caller-supplied contexts, or delegation.source=chapters to compile persisted Chapter contexts server-side. Every request becomes one independent Creative Task; the Worker sees the complete registered Skill catalog, autonomously reads relevant Skills, and returns structured advice until a normal project Operation adopts or executes it.',
      intent: 'act',
      effects: EFFECTS_CREATIVE_TASK,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: { kind: 'none', required: false },
      inputSchema: creativeWorkDelegationInputSchema,
      outputSchema: creativeWorkDelegationOutputSchema,
      execute: async (context, input) => {
        const identity = requireInvocationIdentity({
          runId: context.context.runId,
          toolCallId: context.toolCallId,
        })
        const delegatedRequests = await resolveDelegationRequests({
          operationInput: input.delegation,
          projectId: context.projectId,
          userId: context.userId,
          contextEpisodeId: context.context.episodeId,
        })
        const adoptedCreativeDirection = await readAdoptedCreativeDirectionSnapshot({
          projectId: context.projectId,
          userId: context.userId,
        })
        const requests = await resolveTaskRequests({
          requests: delegatedRequests,
          projectId: context.projectId,
          userId: context.userId,
          adoptedCreativeDirection,
        })
        const invocationEpisodeId = input.delegation.source === 'chapters'
          ? resolveEpisodeId(undefined, context.context.episodeId)
          : context.context.episodeId ?? null
        const requestKeys = new Set<string>()
        for (const request of requests) {
          if (requestKeys.has(request.requestKey)) {
            throw new Error(`CREATIVE_WORK_REQUEST_KEY_DUPLICATE:${request.requestKey}`)
          }
          requestKeys.add(request.requestKey)
        }

        const modelKey = await resolveSystemModelKey({
          userId: context.userId,
          projectId: context.projectId,
          purpose: 'analysis',
        })
        const batchKey = createTaskBatchKey('creative_work')
        const locale = resolveOperationLocale(context.context)
        const submitted = await submitOperationTaskBatch(requests.map((item) => {
          const { requestKey, ...request } = item
          const inputFingerprint = buildCreativeWorkInputFingerprint({ request: item, modelKey })
          const targetId = inputFingerprint
          const lifecycleProjection = {
            requestKey,
            outputKind: request.outputKind,
            goal: request.goal,
            events: [{
              sequence: 1,
              occurredAt: new Date().toISOString(),
              event: {
                kind: 'started' as const,
                outputKind: request.outputKind,
                goal: request.goal,
              },
            }],
          }
          const payload = creativeWorkTaskPayloadSchema.parse({
            protocol: CREATIVE_WORK_TASK_PROTOCOL,
            requestKey,
            request,
            modelKey,
            inputFingerprint,
            origin: identity,
            lifecycleProjection,
          })
          return {
            request: context.request,
            userId: context.userId,
            projectId: context.projectId,
            episodeId: readCreativeWorkOutputDefinition(request.outputKind).resourceScope === 'project'
              ? null
              : invocationEpisodeId,
            type: TASK_TYPE.CREATIVE_WORK,
            targetType: 'CreativeWork',
            targetId,
            operationId: 'delegate_creative_work',
            source: context.source,
            payload,
            dedupeKey: `creative_work:${identity.runId}:${identity.toolCallId}:${requestKey}:${inputFingerprint}`,
            batchKey,
            locale,
            decoratePayload: false,
          }
        }))

        const results = requests.map((request, index) => {
          const task = submitted[index]
          if (!task) throw new Error(`CREATIVE_WORK_TASK_RESULT_MISSING:${request.requestKey}`)
          return {
            refId: request.requestKey,
            taskId: task.taskId,
            taskType: TASK_TYPE.CREATIVE_WORK,
            targetType: 'CreativeWork' as const,
            targetId: buildCreativeWorkInputFingerprint({ request, modelKey }),
          }
        })
        const output = creativeWorkDelegationOutputSchema.parse({
          success: true,
          async: true,
          batchKey,
          total: results.length,
          taskIds: results.map((result) => result.taskId),
          results,
        })
        writeOperationDataPart<TaskBatchSubmittedPartData>(context.writer, 'data-task-batch-submitted', {
          operationId: 'delegate_creative_work',
          total: output.total,
          taskTotal: output.total,
          targetTotal: output.total,
          taskIds: output.taskIds,
          results: output.results,
        })
        return output
      },
    }),
  }
}
