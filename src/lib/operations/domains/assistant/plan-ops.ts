import {
  createProjectAgentPlanSnapshot,
  PROJECT_AGENT_PLAN_STATUSES,
  projectAgentPlanInputSchema,
  projectAgentPlanSnapshotSchema,
  replaceProjectAgentPlanInTransaction,
} from '@/lib/project-agent/plan'
import { defineOperation } from '@/lib/operations/define-operation'
import type {
  ProjectAgentOperationRegistryDraft,
  ProjectAgentToolInputSchema,
} from '@/lib/operations/types'

const UPDATE_PLAN_TOOL_INPUT_SCHEMA = {
  type: 'object',
  description: 'Replace the current advisory work plan. Use this only for complex or multi-step work. Keep steps concise, keep at most one item in_progress, and update immediately after progress changes. When every item is completed, the server closes the plan automatically; pass an empty plan to close it explicitly. This plan is a notebook: it does not execute work, unlock tools, create tasks, or determine project state.',
  properties: {
    explanation: {
      type: ['string', 'null'],
      maxLength: 500,
      description: 'A brief reason for creating or revising the plan, or null when no explanation is needed.',
    },
    plan: {
      type: 'array',
      maxItems: 12,
      description: 'The complete replacement plan. Completing every item or passing [] closes the current plan.',
      items: {
        type: 'object',
        properties: {
          step: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
            description: 'One concise, concrete work step.',
          },
          status: {
            type: 'string',
            enum: [...PROJECT_AGENT_PLAN_STATUSES],
          },
        },
        required: ['step', 'status'],
        additionalProperties: false,
      },
    },
  },
  required: ['explanation', 'plan'],
  additionalProperties: false,
} as const satisfies ProjectAgentToolInputSchema

export function createAssistantPlanOperations(): ProjectAgentOperationRegistryDraft {
  return {
    update_plan: defineOperation({
      id: 'update_plan',
      summary: 'Replace the current advisory progress plan for complex work. The plan is a visible model notebook only and never controls tools, Tasks, Workflows, Resources, or project state.',
      intent: 'plan',
      toolExposure: 'direct',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      toolInputSchema: UPDATE_PLAN_TOOL_INPUT_SCHEMA,
      inputSchema: projectAgentPlanInputSchema,
      outputSchema: projectAgentPlanSnapshotSchema,
      executeInTransaction: async (context, input, transaction) => {
        const snapshot = createProjectAgentPlanSnapshot(input)
        await replaceProjectAgentPlanInTransaction(transaction, {
          projectId: context.projectId,
          userId: context.userId,
          episodeId: context.context.episodeId ?? null,
          assistantId: 'workspace-command',
        }, snapshot)
        return snapshot
      },
    }),
  }
}
