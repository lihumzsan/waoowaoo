import {
  createProjectAgentPlanSnapshot,
  projectAgentPlanInputSchema,
  projectAgentPlanSnapshotSchema,
  replaceProjectAgentPlanInTransaction,
} from '@/lib/project-agent/plan'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

export function createAssistantPlanOperations(): ProjectAgentOperationRegistryDraft {
  return {
    update_plan: defineOperation({
      id: 'update_plan',
      summary: 'Replace the current advisory progress plan for complex work. The plan is a visible model notebook only and never controls tools, Tasks, Workflows, Resources, or project state.',
      intent: 'plan',
      toolContractRevision: 'update_plan/v1',
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
