import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'

export async function deleteProjectOwnedCreativeResourceLineage(params: {
  projectId: string
  transaction: Prisma.TransactionClient
}): Promise<void> {
  const externalDependent = await params.transaction.creativeResourceLineage.findFirst({
    where: {
      inputResource: {
        is: { projectId: params.projectId },
      },
      NOT: {
        outputResource: {
          is: { projectId: params.projectId },
        },
      },
    },
    select: { id: true },
  })
  if (externalDependent) {
    throw new ApiError('CONFLICT', {
      code: 'PROJECT_RESOURCE_EXTERNAL_LINEAGE_CONFLICT',
    })
  }

  await params.transaction.creativeResourceLineage.deleteMany({
    where: {
      outputResource: {
        is: { projectId: params.projectId },
      },
    },
  })
}
