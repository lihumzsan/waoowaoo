import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { HUMAN_VISUAL_SAFETY_POLICY } from '@/lib/ai-prompts'
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

const creativeWorkDelegationOutputSchema =
  refineTaskBatchSubmitOperationOutputSchema(
    z
      .object({
        success: z.literal(true),
        async: z.literal(true),
        batchKey: z.string().trim().min(1),
        total: z.number().int().positive(),
        taskIds: z.array(z.string().trim().min(1)).min(1),
        results: z
          .array(
            z
              .object({
                refId: z.string().trim().min(1),
                taskId: z.string().trim().min(1),
                taskType: z.literal(TASK_TYPE.CREATIVE_WORK),
                targetType: z.literal('CreativeWork'),
                targetId: z.string().trim().min(1),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
  )

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
  turnId?: string | null
  callId?: string | null
}): { turnId: string; callId: string } {
  const turnId = input.turnId?.trim() || ''
  const callId = input.callId?.trim() || ''
  if (!turnId || !callId)
    throw new Error('CREATIVE_WORK_INVOCATION_IDENTITY_REQUIRED')
  return { turnId, callId }
}

function resolveEpisodeId(
  input: string | undefined,
  contextEpisodeId: unknown,
): string {
  const episodeId =
    input?.trim() ||
    (typeof contextEpisodeId === 'string' ? contextEpisodeId.trim() : '')
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
  const buildChapterRequestBase = (
    result: (typeof compiled)[number],
    index: number,
  ) => {
    const requestedChapter = operationInput.chapters[index]
    if (
      !requestedChapter ||
      requestedChapter.chapterId !== result.context.chapter.chapterId
    ) {
      throw new Error(
        `CREATIVE_WORK_CHAPTER_CONTEXT_ORDER_MISMATCH:${String(index)}`,
      )
    }
    const sourceStart = result.context.source.sourceStart
    const sourceEnd = result.context.source.sourceEnd
    return {
      requestKey: requestedChapter.requestKey,
      goal: `${operationInput.goal}\nChapter ${String(result.context.chapter.chapterIndex + 1)}: ${result.context.chapter.title}`,
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
  }
  const requests: CreativeWorkDelegationItem[] =
    operationInput.outputKind === 'video_prompt_set'
      ? compiled.map((result, index) => {
          const requestedChapter = operationInput.chapters[index]
          if (!requestedChapter) {
            throw new Error(
              `CREATIVE_WORK_CHAPTER_CONTEXT_ORDER_MISMATCH:${String(index)}`,
            )
          }
          return {
            ...buildChapterRequestBase(result, index),
            outputKind: 'video_prompt_set',
            durationIntent: requestedChapter.durationIntent,
          }
        })
      : compiled.map((result, index) => ({
          ...buildChapterRequestBase(result, index),
          outputKind: operationInput.outputKind,
          durationIntent: operationInput.chapters[index]?.durationIntent,
        }))
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
  const resourceIds = [
    ...new Set(
      input.requests.flatMap((request) =>
        request.context.sourceMaterials.flatMap((source) =>
          source.kind === 'resource' ? [source.resourceId] : [],
        ),
      ),
    ),
  ]
  const resources =
    resourceIds.length > 0
      ? await prisma.creativeResource.findMany({
          where: {
            id: { in: resourceIds },
            userId: input.userId,
            status: 'ready',
            materializedAt: { not: null },
            OR: [
              { projectId: input.projectId },
              {
                scopeKind: 'user',
                scopeId: input.userId,
                projectId: null,
                episodeId: null,
              },
            ],
          },
          select: {
            id: true,
            contentText: true,
            contentJson: true,
            sourceType: true,
            sourceId: true,
            prompt: true,
            media: {
              select: {
                mimeType: true,
                width: true,
                height: true,
                durationMs: true,
              },
            },
            name: true,
            mediaType: true,
            schemaId: true,
            creativeData: true,
            projectId: true,
            episodeId: true,
          },
        })
      : []
  if (resources.length !== resourceIds.length) {
    const found = new Set(resources.map((resource) => resource.id))
    const missing =
      resourceIds.find((resourceId) => !found.has(resourceId)) ?? 'unknown'
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_WORK_RESOURCE_NOT_FOUND',
      field: 'sourceMaterials.resourceId',
      resourceId: missing,
      agentRetryableAfterCorrection: true,
    })
  }
  const resourceById = new Map(
    resources.map((resource) => [resource.id, resource]),
  )
  return input.requests.map((request) => {
    const usedResourceIds = new Set<string>()
    const resourceSchemas: Array<{ resourceId: string; schemaId: string }> = []
    const sourceMaterials = request.context.sourceMaterials.map((source) => {
      if (source.kind === 'inline') {
        return {
          label: source.label,
          kind: source.mediaType,
          content: source.content,
          provenance: source.provenance,
        }
      }
      const resourceId = source.resourceId
      if (usedResourceIds.has(resourceId)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_WORK_RESOURCE_DUPLICATE',
          field: 'sourceMaterials.resourceId',
          resourceId,
          agentRetryableAfterCorrection: true,
        })
      }
      usedResourceIds.add(resourceId)
      const resource = resourceById.get(resourceId)
      if (!resource)
        throw new Error(`CREATIVE_WORK_RESOURCE_MISSING:${resourceId}`)
      if (!isCreativeResourceMediaType(resource.mediaType)) {
        throw new Error(
          `CREATIVE_WORK_RESOURCE_MEDIA_TYPE_INVALID:${resourceId}`,
        )
      }
      resourceSchemas.push({ resourceId, schemaId: resource.schemaId })
      const kind =
        resource.contentJson !== null
          ? ('structured' as const)
          : resource.contentText !== null
            ? ('text' as const)
            : resource.mediaType
      const content =
        resource.contentJson !== null
          ? JSON.stringify(resource.contentJson)
          : resource.contentText !== null
            ? resource.contentText
            : JSON.stringify({
                name: resource.name,
                schemaId: resource.schemaId,
                prompt: resource.prompt,
                creativeData: resource.creativeData,
                media: resource.media,
                domainSource:
                  resource.sourceType && resource.sourceId
                    ? {
                        sourceType: resource.sourceType,
                        sourceId: resource.sourceId,
                      }
                    : null,
              })
      return {
        label: resource.name,
        kind,
        content,
        provenance: { kind: 'resource' as const, resourceId },
      }
    })
    const manuallySuppliedDirection = resourceSchemas.find(
      (source) =>
        source.schemaId === CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    )
    if (
      request.outputKind !== 'creative_direction' &&
      manuallySuppliedDirection
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_DIRECTION_MANUAL_REFERENCE_FORBIDDEN',
        field: 'sourceMaterials',
        resourceId: manuallySuppliedDirection.resourceId,
        agentRetryableAfterCorrection: true,
      })
    }
    const outputDefinition = readCreativeWorkOutputDefinition(
      request.outputKind,
    )
    for (const requiredSchemaId of outputDefinition.requiredSourceSchemaIds) {
      const matchingSources = resourceSchemas.filter(
        (source) => source.schemaId === requiredSchemaId,
      )
      if (matchingSources.length !== 1) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_WORK_REQUIRED_RESOURCE_SOURCE_INVALID',
          field: 'sourceMaterials',
          outputKind: request.outputKind,
          requiredSchemaId,
          actualCount: matchingSources.length,
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

type HydratedCreativeWorkDelegationItem<
  Item extends CreativeWorkDelegationItem,
> = Item extends CreativeWorkDelegationItem
  ? Omit<Item, 'context'> & { context: CreativeWorkHydratedRequest['context'] }
  : never

type CreativeWorkHydratedItem =
  HydratedCreativeWorkDelegationItem<CreativeWorkDelegationItem>
type CreativeWorkTaskItem = CreativeWorkTaskRequest & {
  readonly requestKey: string
}

function applyHumanVisualSafetyPolicy(
  request: CreativeWorkHydratedItem,
): CreativeWorkHydratedItem {
  if (!readCreativeWorkOutputDefinition(request.outputKind).requiresHumanVisualSafety) {
    return request
  }
  return {
    ...request,
    context: {
      ...request.context,
      constraints: [
        HUMAN_VISUAL_SAFETY_POLICY,
        ...request.context.constraints.filter(
          (constraint) => constraint !== HUMAN_VISUAL_SAFETY_POLICY,
        ),
      ],
    },
  }
}

function canComposeDuration(
  target: number,
  options: readonly number[],
): boolean {
  const reachable = new Uint8Array(target + 1)
  reachable[0] = 1
  for (let duration = 1; duration <= target; duration += 1) {
    reachable[duration] = options.some(
      (option) => duration >= option && reachable[duration - option] === 1,
    )
      ? 1
      : 0
  }
  return reachable[target] === 1
}

const MUSIC_DIRECTION_MAX_CUES = 8

async function resolveMusicProductionContext(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<CreativeWorkTaskItem['productionContext']['music']> {
  const modelKey = await resolveSystemModelKey({
    userId: input.userId,
    projectId: input.projectId,
    purpose: 'music',
  })
  const music = resolveBuiltinCapabilitiesByModelKey('music', modelKey)?.music
  const durationRange = music?.durationSecondsRange
  if (!music || !durationRange) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CAPABILITY_MODEL_UNSUPPORTED',
      field: 'requests',
      modelKey,
    })
  }
  return {
    // The cue prompt budget is the configured music model's wire limit; the
    // schema max is only the outer bound when a provider publishes none.
    promptMaxCharacters: music.promptMaxChars ?? 2_000,
    minCueDurationSeconds: Math.ceil(durationRange.min),
    maxCueDurationSeconds: Math.floor(durationRange.max),
    maxCues: MUSIC_DIRECTION_MAX_CUES,
  }
}

async function resolveTaskRequests(input: {
  readonly requests: readonly CreativeWorkHydratedItem[]
  readonly projectId: string
  readonly userId: string
  readonly adoptedCreativeDirection: AdoptedCreativeDirectionSnapshot | null
}): Promise<CreativeWorkTaskItem[]> {
  const requests = input.requests.map(applyHumanVisualSafetyPolicy)
  const musicContext = requests.some(
    (request) => request.outputKind === 'music_direction',
  )
    ? await resolveMusicProductionContext(input)
    : null
  const needsVideoProduction = requests.some(
    (request) => request.outputKind === 'video_prompt_set',
  )
  if (!needsVideoProduction) {
    return requests.map((request) => ({
      ...request,
      creativeDirection: projectAdoptedCreativeDirection({
        snapshot: input.adoptedCreativeDirection,
        outputKind: request.outputKind,
      }),
      productionContext: {
        video: null,
        music: request.outputKind === 'music_direction' ? musicContext : null,
      },
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
    throw new ApiError('NOT_FOUND', {
      code: 'PROJECT_NOT_FOUND',
      field: 'projectId',
    })
  }
  const aspectRatio = requireProjectVideoRatio(project.videoRatio).value
  const videoCapabilities = resolveBuiltinCapabilitiesByModelKey(
    'video',
    videoModelKey,
  )?.video
  // The reference ceilings are the same capability facts create_video enforces.
  // Without them the Worker can only guess how many labels a Segment may carry.
  const maxReferenceImages = videoCapabilities?.maxReferenceImages ?? 1
  const maxReferenceAudios = videoCapabilities?.maxReferenceAudios ?? 0
  const rawDurationOptions = videoCapabilities?.durationOptions ?? []
  const allowedSegmentDurationsSeconds = Array.from(
    new Set(
      rawDurationOptions.filter(
        (duration): duration is number =>
          Number.isInteger(duration) &&
          duration > 0 &&
          duration <= CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS,
      ),
    ),
  ).sort((left, right) => left - right)
  const minSegmentDurationSeconds = allowedSegmentDurationsSeconds[0]
  const maxSegmentDurationSeconds = allowedSegmentDurationsSeconds.at(-1)
  if (
    minSegmentDurationSeconds === undefined ||
    maxSegmentDurationSeconds === undefined
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_DURATION_CAPABILITY_REQUIRED',
      field: 'durationSeconds',
    })
  }

  return requests.map((request) => {
    if (request.outputKind !== 'video_prompt_set') {
      return {
        ...request,
        creativeDirection: projectAdoptedCreativeDirection({
          snapshot: input.adoptedCreativeDirection,
          outputKind: request.outputKind,
        }),
        productionContext: {
          video: null,
          music: request.outputKind === 'music_direction' ? musicContext : null,
        },
      }
    }
    const durationIntent = request.durationIntent
    if (
      durationIntent.mode === 'fixed' &&
      !canComposeDuration(
        durationIntent.seconds,
        allowedSegmentDurationsSeconds,
      )
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
          maxReferenceImages,
          maxReferenceAudios,
        },
        music: null,
      },
    }
  })
}

export function createAssistantCreativeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    delegate_creative_work: defineOperation({
      id: 'delegate_creative_work',
      summary:
        'Delegate one or more bounded professional creative reasoning requests to background Subagents. Set delegation.source=requests with a one-or-more requests list for caller-supplied contexts, or delegation.source=chapters to compile persisted Chapter contexts server-side. Every request becomes one independent Creative Task; its output kind binds exactly one professional Skill, while frozen project resources remain context rather than Skills. The Worker returns structured advice until a normal project Operation adopts or executes it.',
      intent: 'act',
      effects: EFFECTS_CREATIVE_TASK,
      assistantWriteAuthority: {
        kind: 'temporal_operation_execution',
        contractRevision: 'delegate_creative_work:v1',
        followUpPolicy: 'after_all_terminal',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: creativeWorkDelegationInputSchema,
      outputSchema: creativeWorkDelegationOutputSchema,
      execute: async (context, input) => {
        const identity = requireInvocationIdentity({
          turnId: context.context.turnId,
          callId: context.toolCallId,
        })
        const delegatedRequests = await resolveDelegationRequests({
          operationInput: input.delegation,
          projectId: context.projectId,
          userId: context.userId,
          contextEpisodeId: context.context.episodeId,
        })
        const adoptedCreativeDirection =
          await readAdoptedCreativeDirectionSnapshot({
            projectId: context.projectId,
            userId: context.userId,
          })
        const requests = await resolveTaskRequests({
          requests: delegatedRequests,
          projectId: context.projectId,
          userId: context.userId,
          adoptedCreativeDirection,
        })
        const invocationEpisodeId =
          input.delegation.source === 'chapters'
            ? resolveEpisodeId(undefined, context.context.episodeId)
            : (context.context.episodeId ?? null)
        const requestKeys = new Set<string>()
        for (const request of requests) {
          if (requestKeys.has(request.requestKey)) {
            throw new Error(
              `CREATIVE_WORK_REQUEST_KEY_DUPLICATE:${request.requestKey}`,
            )
          }
          requestKeys.add(request.requestKey)
        }

        const modelKey = await resolveSystemModelKey({
          userId: context.userId,
          projectId: context.projectId,
          purpose: 'analysis',
        })
        const batchKey = context.operationExecutionId
          ? `creative_work:${context.operationExecutionId}`
          : createTaskBatchKey('creative_work')
        const locale = resolveOperationLocale(context.context)
        const submitted = await submitOperationTaskBatch(
          requests.map((item) => {
            const { requestKey, ...request } = item
            const inputFingerprint = buildCreativeWorkInputFingerprint({
              request: item,
              modelKey,
            })
            const targetId = inputFingerprint
            const lifecycleProjection = {
              requestKey,
              outputKind: request.outputKind,
              goal: request.goal,
              events: [
                {
                  sequence: 1,
                  occurredAt: new Date().toISOString(),
                  event: {
                    kind: 'started' as const,
                    outputKind: request.outputKind,
                    goal: request.goal,
                  },
                },
              ],
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
              requestId: context.requestId,
              userId: context.userId,
              projectId: context.projectId,
              episodeId:
                readCreativeWorkOutputDefinition(request.outputKind)
                  .resourceScope === 'project'
                  ? null
                  : invocationEpisodeId,
              type: TASK_TYPE.CREATIVE_WORK,
              targetType: 'CreativeWork',
              targetId,
              operationId: 'delegate_creative_work',
              source: context.source,
              operationExecutionId: context.operationExecutionId,
              operationExecutionTransaction:
                context.operationExecutionTransaction,
              followUpBatchBinding: context.followUpBatchBinding,
              payload,
              dedupeKey: `creative_work:${identity.turnId}:${identity.callId}:${requestKey}:${inputFingerprint}`,
              locale,
              decoratePayload: false,
            }
          }),
        )

        const results = requests.map((request, index) => {
          const task = submitted[index]
          if (!task)
            throw new Error(
              `CREATIVE_WORK_TASK_RESULT_MISSING:${request.requestKey}`,
            )
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
        writeOperationDataPart<TaskBatchSubmittedPartData>(
          context.writer,
          'data-task-batch-submitted',
          {
            operationId: 'delegate_creative_work',
            total: output.total,
            taskTotal: output.total,
            targetTotal: output.total,
            taskIds: output.taskIds,
            results: output.results,
          },
        )
        return output
      },
    }),
  }
}
