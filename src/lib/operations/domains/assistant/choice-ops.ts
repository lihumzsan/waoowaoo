import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { defineOperation } from '@/lib/operations/define-operation'
import type {
  ProjectAgentOperationDefinition,
  ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import {
  assertProjectAgentChoiceCommitmentsMatchCard,
  buildProjectAgentChoiceCardFromAuthoring,
  parseProjectAgentChoiceCommitmentInputJson,
  projectAgentChoiceCardAuthoringSchema,
  projectAgentChoiceSubjectRequestSchema,
  resolveProjectAgentChoiceSubject,
  type ProjectAgentChoiceCommitment,
  type ProjectAgentChoiceCommitmentRequest,
} from '@/lib/project-agent/choice-offer'
import { prepareProjectAgentChoiceExecutionHandoff } from '@/lib/project-agent/execution-handoff'
import { prisma } from '@/lib/prisma'

const requestChoiceInputSchema = z.object({
  subject: projectAgentChoiceSubjectRequestSchema
    .describe('Required top-level field alongside card. Use {kind:"none"} when no mutable fact is being reviewed. Never place subject inside card.'),
  card: projectAgentChoiceCardAuthoringSchema
    .describe('Required top-level Choice content. Put an optional commitment directly on its confirmation or exact option; the server adds all identities and canonical references.'),
}).strict()

const requestChoiceOutputSchema = z.object({
  emitted: z.literal(true),
  cardId: z.string().trim().min(1),
}).strict()

type RequestChoiceInput = z.infer<typeof requestChoiceInputSchema>

const EFFECTS_NONE = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

function requireChoiceInvocationIdentity(context: {
  readonly runId?: string | null
  readonly executionSegmentId?: string | null
  readonly toolCallId?: string | null
}): { runId: string; executionSegmentId: string; toolCallId: string } {
  const runId = context.runId?.trim() || ''
  const executionSegmentId = context.executionSegmentId?.trim() || ''
  const toolCallId = context.toolCallId?.trim() || ''
  if (!runId) throw new Error('PROJECT_AGENT_CHOICE_RUN_ID_REQUIRED')
  if (!executionSegmentId) throw new Error('PROJECT_AGENT_CHOICE_EXECUTION_SEGMENT_ID_REQUIRED')
  if (!toolCallId) throw new Error('PROJECT_AGENT_CHOICE_TOOL_CALL_ID_REQUIRED')
  return { runId, executionSegmentId, toolCallId }
}

function createChoiceCardId(params: {
  runId: string
  executionSegmentId: string
  toolCallId: string
  input: RequestChoiceInput
}): string {
  const digest = createHash('sha256')
    .update(params.runId)
    .update('\n')
    .update(params.executionSegmentId)
    .update('\n')
    .update(params.toolCallId)
    .update('\n')
    .update(JSON.stringify(params.input))
    .digest('hex')
  return `choice_${digest}`
}

async function validateChoiceCommitments(
  requests: readonly ProjectAgentChoiceCommitmentRequest[],
): Promise<ProjectAgentChoiceCommitment[]> {
  if (requests.length === 0) return []
  // Delayed import avoids making the operation registry construct itself while
  // its generic Choice operation is being registered.
  const { createProjectAgentOperationRegistry } = await import('@/lib/operations/registry')
  const registry = createProjectAgentOperationRegistry()
  return requests.map((request) => {
    const target = registry[request.operationId] as ProjectAgentOperationDefinition | undefined
    if (!target) {
      throw new Error(`PROJECT_AGENT_CHOICE_COMMIT_OPERATION_NOT_FOUND:${request.operationId}`)
    }
    if (target.choiceCommit?.enabled !== true) {
      throw new Error(`PROJECT_AGENT_CHOICE_COMMIT_OPERATION_FORBIDDEN:${request.operationId}`)
    }
    const frozenInput = parseProjectAgentChoiceCommitmentInputJson(request.inputJson)
    const parsed = target.inputSchema.safeParse(frozenInput)
    if (!parsed.success) {
      throw new Error(`PROJECT_AGENT_CHOICE_COMMIT_INPUT_INVALID:${request.operationId}`)
    }
    return {
      when: request.when,
      operationId: request.operationId,
      input: frozenInput,
    }
  })
}

export function createAssistantChoiceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    request_choice: defineOperation({
      id: 'request_choice',
      summary: 'Ask the user exactly one current question using a model-authored Choice card. Author the complete card copy and options in the conversation language. Titles, descriptions, and button labels must describe only this decision and must never promise a downstream step such as "confirm and generate". Use commitments only when this answer may atomically invoke one explicitly Choice-eligible operation; otherwise pass an empty array. This operation neither prescribes nor starts a later workflow.',
      intent: 'query',
      toolExposure: 'direct',
      // The SDK Session keeps the original authored call and its receipt so a
      // later canonical choice_response can still resolve option ids to their
      // model-authored labels. Re-issuing would ask the same question again.
      modelResultRetention: 'irreplaceable',
      effects: EFFECTS_NONE,
      agentFlow: { suspendsFor: 'choice' },
      confirmation: { kind: 'none', required: false },
      inputSchema: requestChoiceInputSchema,
      outputSchema: requestChoiceOutputSchema,
      execute: async (context, input) => {
        const identity = requireChoiceInvocationIdentity({
          runId: context.context.runId,
          executionSegmentId: context.context.executionSegmentId,
          toolCallId: context.toolCallId,
        })
        if (!context.executionFence) {
          throw new Error('PROJECT_AGENT_CHOICE_EXECUTION_FENCE_REQUIRED')
        }
        if (context.executionFence.runFence.runId !== identity.runId) {
          throw new Error(`PROJECT_AGENT_CHOICE_RUN_FENCE_MISMATCH:${identity.runId}`)
        }
        const authored = buildProjectAgentChoiceCardFromAuthoring({
          authoring: input.card,
          cardId: createChoiceCardId({ ...identity, input }),
          toolCallId: identity.toolCallId,
        })
        const card = authored.card
        const commitments = await validateChoiceCommitments(authored.commitments)
        assertProjectAgentChoiceCommitmentsMatchCard({ card, commitments })
        const subject = await prisma.$transaction(async (tx) => (
          await resolveProjectAgentChoiceSubject({
            tx,
            projectId: context.projectId,
            userId: context.userId,
            request: input.subject,
            card,
            commitments,
          })
        ))
        const handoff = await prepareProjectAgentChoiceExecutionHandoff({
          executionFence: context.executionFence,
          executionSegmentId: identity.executionSegmentId,
          projectId: context.projectId,
          userId: context.userId,
          episodeId: context.context.episodeId ?? null,
          locale: context.context.locale ?? null,
          assistantId: 'workspace-command',
          operationId: 'request_choice',
          toolCallId: identity.toolCallId,
          card,
          subject,
          commitments,
          modelArguments: input as unknown as Prisma.InputJsonValue,
        })
        return requestChoiceOutputSchema.parse({
          emitted: true,
          cardId: handoff.card.cardId,
        })
      },
    }),
  }
}
