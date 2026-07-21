import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/creative-resource/generation-contract'
import {
  buildCreativeWorkInputFingerprint,
  CREATIVE_WORK_TASK_PROTOCOL,
  creativeWorkDelegationInputSchema,
  creativeWorkTaskPayloadSchema,
  type CreativeWorkDelegationInput,
  type CreativeWorkDelegationItem,
  type CreativeWorkTaskRequest,
} from '@/lib/creative-worker'
import { compileEpisodeChapterContexts } from '@/lib/edit-chapter'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskBatchSubmitOperationOutputSchema } from '@/lib/operations/output-schemas'
import { submitOperationTaskBatch } from '@/lib/operations/submit-operation-task'
import {
  writeOperationDataPart,
  type ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { prisma } from '@/lib/prisma'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import { createTaskBatchKey } from '@/lib/task/batch'
import { TASK_TYPE } from '@/lib/task/types'
import { createAssistantCreativeBibleOperations } from './creative-bible-ops'
import { createAssistantCreativeStyleOperations } from './creative-style-ops'

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
}): Promise<CreativeWorkDelegationItem[]> {
  const operationInput = input.operationInput
  if (operationInput.source === 'requests') {
    return [...operationInput.requests]
  }
  const compiled = await compileEpisodeChapterContexts({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: resolveEpisodeId(undefined, input.contextEpisodeId),
    chapterIds: operationInput.chapters.map((chapter) => chapter.chapterId),
    referencedAssets: operationInput.referencedAssets,
    maxCharsPerChapter: CREATIVE_CHAPTER_CONTEXT_MAX_CHARS,
  })
  return compiled.map((result, index) => {
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
      targetDurationSeconds: result.context.chapter.targetDurationSec,
      context: {
        userRequest: operationInput.userRequest,
        sourceMaterials: [
          {
            label: `Chapter ${String(result.context.chapter.chapterIndex + 1)} context`,
            kind: 'structured' as const,
            content: JSON.stringify(result.context),
            provenance: {
              kind: 'domain' as const,
              sourceType: 'creative_chapter_context',
              sourceId: result.context.chapter.chapterId,
              revision: `${String(sourceStart)}:${String(sourceEnd)}`,
              fingerprint: stableArgsHash(result.context),
            },
          },
          {
            label: 'Final Style Bible',
            kind: 'structured' as const,
            content: JSON.stringify(result.context.style.productionStyleBible),
            provenance: {
              kind: 'resource' as const,
              ...result.context.style.source,
            },
          },
        ],
        constraints: operationInput.constraints,
      },
    }
  })
}

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
  readonly requests: readonly CreativeWorkDelegationItem[]
  readonly projectId: string
  readonly userId: string
}): Promise<CreativeWorkTaskItem[]> {
  const needsVideoProduction = input.requests.some((request) => request.outputKind === 'video_prompt_set')
  if (!needsVideoProduction) {
    return input.requests.map((request) => ({
      ...request,
      productionContext: { video: null },
    }))
  }

  const videoRequests = input.requests.filter((request) => request.outputKind === 'video_prompt_set')
  for (const request of videoRequests) {
    const resourceReferences = request.context.sourceMaterials
      .map((source) => source.provenance)
      .filter((provenance) => provenance.kind === 'resource')
    const revisionIds = resourceReferences.map((reference) => reference.revisionId)
    const revisions = revisionIds.length > 0
      ? await prisma.creativeResourceRevision.findMany({
          where: { id: { in: revisionIds } },
          select: {
            id: true,
            resourceId: true,
            fingerprint: true,
            resource: {
              select: {
                userId: true,
                projectId: true,
                status: true,
                schemaId: true,
              },
            },
          },
        })
      : []
    const byRevisionId = new Map(revisions.map((revision) => [revision.id, revision]))
    const styleReferences = resourceReferences.filter((reference) => {
      const revision = byRevisionId.get(reference.revisionId)
      return revision?.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE
        && revision.resourceId === reference.resourceId
        && revision.fingerprint === reference.fingerprint
        && revision.resource.userId === input.userId
        && revision.resource.projectId === input.projectId
        && revision.resource.status === 'ready'
    })
    if (styleReferences.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_VIDEO_STYLE_BIBLE_REQUIRED',
        field: 'context.sourceMaterials',
        requestedValue: styleReferences.length,
        agentRetryableAfterCorrection: true,
      })
    }
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
  const aspectRatio = project.videoRatio?.trim() || ''
  if (!aspectRatio) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_VIDEO_RATIO_REQUIRED',
      field: 'videoRatio',
      agentRetryableAfterCorrection: true,
    })
  }
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
      return { ...request, productionContext: { video: null } }
    }
    const targetDurationSeconds = request.targetDurationSeconds
    if (
      targetDurationSeconds === undefined
      || !canComposeDuration(targetDurationSeconds, allowedSegmentDurationsSeconds)
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: targetDurationSeconds === undefined
          ? 'CREATIVE_VIDEO_TARGET_DURATION_REQUIRED'
          : 'CREATIVE_VIDEO_TARGET_DURATION_UNSUPPORTED',
        field: 'targetDurationSeconds',
        requestedValue: targetDurationSeconds ?? null,
        allowedValues: allowedSegmentDurationsSeconds,
        agentRetryableAfterCorrection: true,
      })
    }
    return {
      ...request,
      productionContext: {
        video: {
          aspectRatio,
          allowedSegmentDurationsSeconds,
          minSegmentDurationSeconds,
          maxSegmentDurationSeconds,
          styleBibleRequired: true as const,
        },
      },
    }
  })
}

export function createAssistantCreativeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    ...createAssistantCreativeBibleOperations(),
    ...createAssistantCreativeStyleOperations(),
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
        const requests = await resolveTaskRequests({
          requests: delegatedRequests,
          projectId: context.projectId,
          userId: context.userId,
        })
        const taskEpisodeId = input.delegation.source === 'chapters'
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
            episodeId: taskEpisodeId,
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
