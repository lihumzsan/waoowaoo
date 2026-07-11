import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { normalizeString, submitOperationTask } from '@/lib/operations/submit-operation-task'

const EFFECTS_BILLABLE_LONG_RUNNING = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

export function createLlmTaskOperations(): ProjectAgentOperationRegistryDraft {
  return {
    ai_modify_appearance: defineOperation({
      id: 'ai_modify_appearance',
      summary: 'Submit AI modify appearance task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        characterId: z.string().min(1),
        appearanceId: z.string().min(1),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) =>
        submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_MODIFY_APPEARANCE,
          targetType: 'CharacterAppearance',
          targetId: input.appearanceId,
          operationId: 'ai_modify_appearance',
          source: ctx.source,
          payload: input as unknown as Record<string, unknown>,
          dedupeKey: `ai_modify_appearance:${input.appearanceId}`,
        }),
    }),
    ai_modify_prop: defineOperation({
      id: 'ai_modify_prop',
      summary: 'Submit AI modify prop task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        propId: z.string().min(1),
        variantId: z.string().optional(),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const propId = normalizeString((input as unknown as Record<string, unknown>).propId)
        const variantId = normalizeString((input as unknown as Record<string, unknown>).variantId) || undefined

        const prop = await prisma.projectLocation.findFirst({
          where: {
            id: propId,
            projectId: ctx.projectId,
            assetKind: 'prop',
          },
          select: {
            id: true,
            name: true,
          },
        })
        if (!prop) {
          throw new ApiError('NOT_FOUND')
        }

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_MODIFY_PROP,
          targetType: 'ProjectLocation',
          targetId: variantId || propId,
          operationId: 'ai_modify_prop',
          source: ctx.source,
          payload: {
            ...(input as unknown as Record<string, unknown>),
            propId,
            propName: prop.name,
            ...(variantId ? { variantId } : {}),
          },
          dedupeKey: `ai_modify_prop:${propId}:${variantId || 'default'}`,
        })
      },
    }),
  }
}
