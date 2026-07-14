import type { Prisma } from '@prisma/client'
import { revertAssetRender } from '@/lib/assets/services/asset-actions'

export type MutationRevertResult = {
  ok: true
  reverted: number
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function revertMutationEntry(entry: {
  transaction: Prisma.TransactionClient
  kind: string
  targetType: string
  targetId: string
  payload: unknown
  projectId: string
  userId: string
}): Promise<void> {
  if (entry.kind !== 'asset_render_revert') {
    throw new Error(`MUTATION_KIND_UNSUPPORTED:${entry.kind}`)
  }
  const payload = asRecord(entry.payload)
  const kind = readString(payload.kind)
  const assetId = readString(payload.assetId) || entry.targetId
  const appearanceId = readString(payload.appearanceId)
  if (kind !== 'character' && kind !== 'location') throw new Error('MUTATION_UNSUPPORTED_KIND')
  await revertAssetRender({
    kind,
    assetId,
    body: appearanceId ? { appearanceId } : {},
    access: {
      scope: 'project',
      userId: entry.userId,
      projectId: entry.projectId,
    },
  }, entry.transaction)
}

export async function revertMutationBatch(params: {
  transaction: Prisma.TransactionClient
  batchId: string
  projectId: string
  userId: string
}): Promise<MutationRevertResult> {
  const batch = await params.transaction.mutationBatch.findFirst({
    where: {
      id: params.batchId,
      projectId: params.projectId,
      userId: params.userId,
    },
    include: { entries: { orderBy: { createdAt: 'desc' } } },
  })
  if (!batch) throw new Error('MUTATION_BATCH_NOT_FOUND')
  if (batch.status === 'reverted') return { ok: true, reverted: 0 }

  let reverted = 0
  for (const entry of batch.entries) {
    await revertMutationEntry({
      transaction: params.transaction,
      kind: entry.kind,
      targetType: entry.targetType,
      targetId: entry.targetId,
      payload: entry.payload,
      projectId: params.projectId,
      userId: params.userId,
    })
    reverted += 1
  }
  await params.transaction.mutationBatch.update({
    where: { id: batch.id },
    data: { status: 'reverted', revertedAt: new Date(), revertError: null },
  })
  return { ok: true, reverted }
}
