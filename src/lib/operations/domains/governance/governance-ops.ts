import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { revertMutationBatch } from '@/lib/mutation-batch/revert'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

export function createGovernanceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    revert_mutation_batch: defineOperation({
      id: 'revert_mutation_batch',
      summary: 'Revert (undo) a mutation batch by id.',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_workspace',
        billable: false,
        destructive: true,
        overwrite: true,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: {
        required: true,
        summary: '将撤回一次批量变更（可能删除或覆盖已有内容）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        batchId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => revertMutationBatch({
        transaction,
        batchId: input.batchId,
        projectId: ctx.projectId,
        userId: ctx.userId,
      }),
    }),

    revert_mutation_batch_by_id: defineOperation({
      id: 'revert_mutation_batch_by_id',
      summary: 'Revert (undo) a mutation batch by id without requiring the caller to know its projectId.',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_workspace',
        billable: false,
        destructive: true,
        overwrite: true,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: {
        required: true,
        summary: '将撤回一次批量变更（可能删除或覆盖已有内容）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        batchId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const batch = await transaction.mutationBatch.findUnique({
          where: { id: input.batchId },
          select: { id: true, projectId: true, userId: true },
        })
        if (!batch) throw new ApiError('NOT_FOUND')
        if (batch.userId !== ctx.userId) throw new ApiError('FORBIDDEN')

        return await revertMutationBatch({
          transaction,
          batchId: batch.id,
          projectId: batch.projectId,
          userId: ctx.userId,
        })
      },
    }),
  }
}
