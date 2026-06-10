import { prisma } from '@/lib/prisma'

export type EditAssetRequirementKind = 'character' | 'location' | 'prop'

export async function markEditAssetRequirementsCompletedForTargets(input: {
  readonly projectId: string
  readonly kind: EditAssetRequirementKind
  readonly targetIds: readonly string[]
}): Promise<void> {
  const targetIds = Array.from(new Set(input.targetIds.filter((id) => id.trim().length > 0)))
  if (targetIds.length === 0) return

  await prisma.projectEditAssetRequirement.updateMany({
    where: {
      projectId: input.projectId,
      kind: input.kind,
      targetId: { in: targetIds },
    },
    data: {
      status: 'completed',
      errorMessage: null,
    },
  })
}
