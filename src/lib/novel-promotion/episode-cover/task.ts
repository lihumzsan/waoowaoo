import type { Locale } from '@/i18n/routing'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'

export async function submitEpisodeCoverTask(params: {
  userId: string
  locale: Locale
  projectId: string
  episodeId: string
  mode: 'auto' | 'manual'
  requestId?: string | null
}) {
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: params.episodeId,
      novelPromotionProject: { projectId: params.projectId },
    },
    select: {
      id: true,
      coverImageMediaId: true,
    },
  })
  if (!episode) throw new ApiError('NOT_FOUND')

  if (params.mode === 'auto' && episode.coverImageMediaId) {
    return {
      success: true,
      async: false,
      skipped: true,
      reason: 'cover_exists' as const,
      coverImageMediaId: episode.coverImageMediaId,
    }
  }

  return await submitTask({
    userId: params.userId,
    locale: params.locale,
    requestId: params.requestId || null,
    projectId: params.projectId,
    episodeId: episode.id,
    type: TASK_TYPE.IMAGE_EPISODE_COVER,
    targetType: 'NovelPromotionEpisode',
    targetId: episode.id,
    maxAttempts: 2,
    payload: withTaskUiPayload({
      episodeId: episode.id,
      trigger: params.mode,
    }, {
      intent: episode.coverImageMediaId ? 'regenerate' : 'generate',
      hasOutputAtStart: !!episode.coverImageMediaId,
    }),
    dedupeKey: `${TASK_TYPE.IMAGE_EPISODE_COVER}:${episode.id}`,
  })
}
