import { z } from 'zod'
import {
  buildCreativeWorkInputFingerprint,
  creativeWorkDelegationInputSchema,
  creativeWorkTaskPayloadSchema,
  listCreativeWorkDelegationItems,
  resolveCreativeWorkDelegationInput,
  type CreativeWorkDelegationItem,
  type ResolvedCreativeWorkDelegationInput,
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
import {
  resolveProjectAgentAssistantModelKey,
} from '@/lib/project-agent/model'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import { createTaskBatchKey } from '@/lib/task/batch'
import { TASK_TYPE } from '@/lib/task/types'
import { createAssistantCreativeBibleOperations } from './creative-bible-ops'

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
  readonly operationInput: ResolvedCreativeWorkDelegationInput
  readonly projectId: string
  readonly userId: string
  readonly contextEpisodeId: unknown
}): Promise<CreativeWorkDelegationItem[]> {
  const operationInput = input.operationInput
  if (operationInput.kind !== 'chapter_batch') {
    return listCreativeWorkDelegationItems(operationInput)
  }
  const chapterBatch = operationInput.chapterBatch
  const compiled = await compileEpisodeChapterContexts({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: resolveEpisodeId(chapterBatch.episodeId ?? undefined, input.contextEpisodeId),
    chapterIds: chapterBatch.chapters.map((chapter) => chapter.chapterId),
    referencedAssets: chapterBatch.referencedAssets,
    maxCharsPerChapter: chapterBatch.maxCharsPerChapter,
  })
  return compiled.map((result, index) => {
    const requestedChapter = chapterBatch.chapters[index]
    if (!requestedChapter || requestedChapter.chapterId !== result.context.chapter.chapterId) {
      throw new Error(`CREATIVE_WORK_CHAPTER_CONTEXT_ORDER_MISMATCH:${String(index)}`)
    }
    const sourceStart = result.context.source.sourceStart
    const sourceEnd = result.context.source.sourceEnd
    return {
      requestKey: requestedChapter.requestKey,
      outputKind: chapterBatch.outputKind,
      goal: `${chapterBatch.goal}\nChapter ${String(result.context.chapter.chapterIndex + 1)}: ${result.context.chapter.title}`,
      context: {
        userRequest: chapterBatch.userRequest,
        sourceMaterials: [{
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
        }],
        constraints: chapterBatch.constraints,
      },
    }
  })
}

export function createAssistantCreativeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    ...createAssistantCreativeBibleOperations(),
    delegate_creative_work: defineOperation({
      id: 'delegate_creative_work',
      summary: 'Delegate bounded professional creative reasoning requests to background Subagents. Every request becomes one independent Creative Task; the Worker can only discover and read registered Creative Skills, and its structured result is advice until a normal project Operation adopts or executes it. Use kind=single for one request, kind=batch for caller-supplied independent contexts, or kind=chapter_batch to compile persisted Chapter contexts server-side without copying every long context through the Primary Agent.',
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
        const delegation = resolveCreativeWorkDelegationInput(input)
        const requests = await resolveDelegationRequests({
          operationInput: delegation,
          projectId: context.projectId,
          userId: context.userId,
          contextEpisodeId: context.context.episodeId,
        })
        const taskEpisodeId = delegation.kind === 'chapter_batch'
          ? resolveEpisodeId(delegation.chapterBatch.episodeId ?? undefined, context.context.episodeId)
          : context.context.episodeId ?? null
        const requestKeys = new Set<string>()
        for (const request of requests) {
          if (requestKeys.has(request.requestKey)) {
            throw new Error(`CREATIVE_WORK_REQUEST_KEY_DUPLICATE:${request.requestKey}`)
          }
          requestKeys.add(request.requestKey)
        }

        const modelKey = await resolveProjectAgentAssistantModelKey(context.userId)
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
