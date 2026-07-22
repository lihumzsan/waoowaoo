import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'

export const PROJECT_VIDEO_RATIO_VALUES = Object.freeze(Object.keys(ASPECT_RATIO_CONFIGS))

export function isProjectVideoRatio(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(ASPECT_RATIO_CONFIGS, value)
}

export function normalizeProjectVideoRatio(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_VIDEO_RATIO_INVALID',
      field: 'videoRatio',
    })
  }
  const normalized = value.trim()
  if (!isProjectVideoRatio(normalized)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_VIDEO_RATIO_INVALID',
      field: 'videoRatio',
      allowedValues: PROJECT_VIDEO_RATIO_VALUES,
      agentRetryableAfterCorrection: true,
    })
  }
  return normalized
}

export async function writeProjectVideoRatioInTransaction(input: {
  readonly transaction: Prisma.TransactionClient
  readonly projectId: string
  readonly videoRatio: unknown
}) {
  return await input.transaction.project.update({
    where: { id: input.projectId },
    data: { videoRatio: normalizeProjectVideoRatio(input.videoRatio) },
  })
}
