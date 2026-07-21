import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import type { OperationPlan } from './planning'

const PROJECT_VIDEO_RATIO_CONFIRMATION_METADATA_KEY = 'projectVideoRatioConfirmation'

function containsProjectImageOrVideoTask(plan: OperationPlan): boolean {
  return plan.tasks.some((task) => (
    task.billingInfo.billable === true
      && (task.billingInfo.apiType === 'image' || task.billingInfo.apiType === 'video')
  ))
}

/**
 * Freezes the user-confirmed project frame into every image/video plan. This is
 * the single planning boundary shared by Agent and API callers, so no task,
 * approval, retry, or replay can bypass confirmation or reuse an older version.
 */
export async function enforceProjectVideoRatioConfirmation(
  plan: OperationPlan,
): Promise<OperationPlan> {
  if (plan.projectId === GLOBAL_ASSET_PROJECT_ID || !containsProjectImageOrVideoTask(plan)) {
    return plan
  }

  const project = await prisma.project.findFirst({
    where: {
      id: plan.projectId,
      userId: plan.userId,
    },
    select: {
      videoRatio: true,
      videoRatioConfirmedAt: true,
      videoRatioConfirmationVersion: true,
    },
  })
  if (!project) throw new ApiError('NOT_FOUND')

  const videoRatio = project.videoRatio?.trim() || null
  if (
    !videoRatio
    || !project.videoRatioConfirmedAt
    || project.videoRatioConfirmationVersion < 1
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_VIDEO_RATIO_CONFIRMATION_REQUIRED',
      field: 'videoRatio',
      videoRatio,
      confirmationVersion: project.videoRatioConfirmationVersion,
      agentRetryableAfterCorrection: true,
    })
  }

  return {
    ...plan,
    metadata: {
      ...(plan.metadata ?? {}),
      [PROJECT_VIDEO_RATIO_CONFIRMATION_METADATA_KEY]: {
        videoRatio,
        version: project.videoRatioConfirmationVersion,
      },
    },
  }
}
