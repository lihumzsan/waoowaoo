import { z } from 'zod'
import { planAssetModifyTask } from '@/lib/assets/services/asset-actions'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import type { OperationPlan } from '@/lib/operations/planning'
import { normalizeString, omitOperationControls, type ProjectAssetImageKind } from './shared'

export const modifyCharacterImageInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  characterId: z.string().min(1),
}).passthrough()

export const modifyLocationImageInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  locationId: z.string().min(1),
}).passthrough()

export async function planAssetImageModificationOperation(params: {
  ctx: ProjectAgentOperationContext
  input: Record<string, unknown>
  operationId: string
  kind: ProjectAssetImageKind
}): Promise<OperationPlan> {
  const assetId = params.kind === 'character'
    ? normalizeString(params.input.characterId)
    : normalizeString(params.input.locationId)

  if (!assetId) {
    throw new Error('PROJECT_AGENT_ASSET_ID_REQUIRED')
  }

  const body: Record<string, unknown> = {
    ...omitOperationControls(params.input),
    ...(params.kind === 'character' ? { characterId: assetId } : { locationId: assetId }),
  }

  const planned = await planAssetModifyTask({
    request: params.ctx.request,
    kind: params.kind,
    assetId,
    body,
    access: {
      scope: 'project',
      userId: params.ctx.userId,
      projectId: params.ctx.projectId,
    },
  })

  const appearanceId = params.kind === 'character' ? normalizeString(body.appearanceId) : ''
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId,
      assetKind: params.kind,
      appearanceId: appearanceId || null,
      mutationTargetType: params.kind === 'character' ? 'ProjectCharacter' : 'ProjectLocation',
      mutationTargetId: assetId,
    },
  }
}
