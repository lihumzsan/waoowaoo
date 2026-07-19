import { aisdk } from '@openai/agents-extensions/ai-sdk'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import {
  CREATIVE_WORK_OUTPUT_KINDS,
  creativeWorkOutputSchemas,
  creativeWorkRequestSchema,
  isCreativeWorkerError,
  runCreativeWorker,
  type CreativeWorkerEventListener,
} from '@/lib/creative-worker'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  writeOperationDataPart,
  type ProjectAgentOperationContext,
  type ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import type { ProjectAgentSubagentPartData } from '@/lib/project-agent/types'
import {
  resolveProjectAgentAssistantModelKey,
  resolveProjectAgentLanguageModel,
} from '@/lib/project-agent/model'

const creativeWorkOutputSchema = z.discriminatedUnion('kind', [
  creativeWorkOutputSchemas.screenplay_draft,
  creativeWorkOutputSchemas.story_analysis,
  creativeWorkOutputSchemas.continuity_analysis,
  creativeWorkOutputSchemas.asset_prompt_set,
  creativeWorkOutputSchemas.video_prompt_set,
  creativeWorkOutputSchemas.music_direction,
  creativeWorkOutputSchemas.creative_review,
])

const creativeWorkerResultSchema = z.object({
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  output: creativeWorkOutputSchema,
  skillTrace: z.array(z.object({
    ordinal: z.number().int().positive(),
    source: z.enum(['required', 'tool']),
    skillId: z.string().trim().min(1),
    version: z.string().trim().min(1),
    uri: z.string().trim().min(1),
    checksum: z.string().trim().min(1),
    contentChars: z.number().int().nonnegative(),
  }).strict()),
  metrics: z.object({
    discoveryCalls: z.number().int().nonnegative(),
    readCalls: z.number().int().nonnegative(),
    skillContentChars: z.number().int().nonnegative(),
  }).strict(),
  budgets: z.object({
    maxTurns: z.number().int().positive(),
    maxDiscoveryCalls: z.number().int().positive(),
    maxReadCalls: z.number().int().positive(),
    maxSkillContentChars: z.number().int().positive(),
    maxSingleSkillResourceChars: z.number().int().positive(),
    maxInputChars: z.number().int().positive(),
    maxOutputChars: z.number().int().positive(),
  }).strict(),
}).strict().superRefine((result, context) => {
  if (result.output.kind !== result.outputKind) {
    context.addIssue({
      code: 'custom',
      message: 'CREATIVE_WORK_OUTPUT_KIND_MISMATCH',
      path: ['output'],
    })
  }
})

const EFFECTS_CREATIVE_REASONING = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: true,
  longRunning: false,
} as const

function createCreativeWorkerEventListener(
  context: ProjectAgentOperationContext,
): CreativeWorkerEventListener | undefined {
  if (context.source !== 'assistant-panel') return undefined
  const runId = context.context.runId?.trim() || ''
  const activityId = context.activityId?.trim() || ''
  const toolCallId = context.toolCallId?.trim() || ''
  const runFence = context.executionFence?.runFence ?? null
  if (!runId || !activityId || !toolCallId || !runFence) {
    throw new Error('CREATIVE_WORK_SUBAGENT_EVENT_IDENTITY_REQUIRED')
  }
  let sequence = 0
  return async (event) => {
    sequence += 1
    const part: ProjectAgentSubagentPartData = {
      subagentId: activityId,
      runId,
      activityId,
      toolCallId,
      sequence,
      occurredAt: new Date().toISOString(),
      event,
    }
    await appendProjectAgentEvents({
      scope: {
        projectId: context.projectId,
        userId: context.userId,
        episodeId: context.context.episodeId ?? null,
        assistantId: 'workspace-command',
      },
      events: [{
        runFence,
        idempotencyKey: `subagent-progressed:${activityId}:${String(sequence)}`,
        event: {
          kind: 'subagent.progressed',
          runId,
          activityId,
          subagentEvent: part,
        },
      }],
    })
    writeOperationDataPart<ProjectAgentSubagentPartData>(
      context.writer,
      'data-agent-subagent-event',
      part,
    )
  }
}

export function createAssistantCreativeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    delegate_creative_work: defineOperation({
      id: 'delegate_creative_work',
      summary: 'Delegate one bounded professional creative reasoning task to a stateless Worker. The Worker can only discover and read registered Creative Skills; it cannot read the project, call business Operations, create Tasks, persist Resources, approve charges, or change state. Supply every required fact and exact source revision in the request, then inspect the structured result and use existing Operations for any real project action.',
      intent: 'query',
      effects: EFFECTS_CREATIVE_REASONING,
      inputSchema: creativeWorkRequestSchema,
      outputSchema: creativeWorkerResultSchema,
      execute: async (context, input) => {
        const onEvent = createCreativeWorkerEventListener(context)
        const assistantModelKey = await resolveProjectAgentAssistantModelKey(context.userId)
        const resolved = await resolveProjectAgentLanguageModel({
          userId: context.userId,
          assistantModelKey,
          openRouterSessionId: buildAiExecutionSessionId({
            kind: 'project-agent',
            userId: context.userId,
            projectId: context.projectId,
            episodeId: context.context.episodeId ?? null,
            assistantId: 'creative-worker',
            action: input.outputKind,
            modelKey: assistantModelKey,
          }),
        })

        try {
          const result = await runCreativeWorker({
            model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
            locale: resolveOperationLocale(context.context),
            signal: context.executionFence?.signal ?? context.request.signal,
            request: input,
            ...(onEvent ? { onEvent } : {}),
          })
          return {
            ...result,
            skillTrace: [...result.skillTrace],
          }
        } catch (error) {
          if (!isCreativeWorkerError(error)) throw error
          throw new ApiError('EXTERNAL_ERROR', {
            code: error.code,
            message: error.message,
            ...error.details,
          })
        }
      },
    }),
  }
}
