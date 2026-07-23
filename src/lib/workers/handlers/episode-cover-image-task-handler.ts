import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getArtStylePrompt } from '@/lib/constants'
import { createScopedLogger } from '@/lib/logging/core'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { deleteMediaObjectIfUnreferenced } from '@/lib/media/unreferenced-cleanup'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { auditEpisodeCoverImage } from '@/lib/novel-promotion/episode-cover/audit'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_STATUS, type TaskJobData } from '@/lib/task/types'
import { deleteObject } from '@/lib/storage'
import { reportTaskProgress } from '../shared'
import {
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCosWithMetadata,
} from '../utils'
import {
  collectPanelReferenceImages,
  resolveNovelData,
} from './image-task-handler-shared'

const MAX_COVER_REFERENCE_IMAGES = 3
const logger = createScopedLogger({ module: 'worker.episode-cover' })

type EpisodeCoverPanel = {
  id: string
  panelIndex: number
  description: string | null
  imagePrompt: string | null
  location: string | null
  characters: string | null
  srtSegment: string | null
}

function compactText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return null
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`
}

function buildEpisodeContext(episode: {
  description: string | null
  novelText: string | null
  clips: Array<{
    summary: string
    content: string
    screenplay: string | null
  }>
  storyboards: Array<{ panels: EpisodeCoverPanel[] }>
}) {
  return JSON.stringify({
    episode_description: compactText(episode.description, 2_000),
    episode_story: compactText(episode.novelText, 10_000),
    clips: episode.clips.map((clip) => ({
      summary: compactText(clip.summary, 800),
      content: compactText(clip.content, 1_600),
      screenplay: compactText(clip.screenplay, 1_600),
    })),
    storyboard_panels: episode.storyboards.flatMap((storyboard) => (
      storyboard.panels.map((panel) => ({
        panel_index: panel.panelIndex,
        description: compactText(panel.description, 800),
        image_prompt: compactText(panel.imagePrompt, 800),
        location: panel.location,
        characters: panel.characters,
        source_text: compactText(panel.srtSegment, 800),
      }))
    )),
  }, null, 2)
}

async function collectEpisodeCoverReferences(
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  panels: EpisodeCoverPanel[],
) {
  const uniqueReferences = new Set<string>()

  for (const panel of panels) {
    const references = await collectPanelReferenceImages(projectData, {
      ...panel,
      sketchImageUrl: null,
    })
    for (const reference of references) {
      uniqueReferences.add(reference)
      if (uniqueReferences.size >= MAX_COVER_REFERENCE_IMAGES) break
    }
    if (uniqueReferences.size >= MAX_COVER_REFERENCE_IMAGES) break
  }

  return await normalizeReferenceImagesForGeneration(Array.from(uniqueReferences))
}

export async function handleEpisodeCoverImageTask(job: Job<TaskJobData>) {
  const episodeId = job.data.episodeId || job.data.targetId
  if (!episodeId) throw new Error('episodeId missing')

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId: job.data.projectId },
    },
    include: {
      clips: { orderBy: { createdAt: 'asc' } },
      storyboards: {
        orderBy: { createdAt: 'asc' },
        include: {
          panels: { orderBy: { panelIndex: 'asc' } },
        },
      },
    },
  })
  if (!episode) throw new Error('Episode not found')

  const projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)

  const aspectRatio = projectData.videoRatio || modelConfig.videoRatio
  if (!aspectRatio) throw new Error('Project videoRatio not configured')

  const panels = episode.storyboards.flatMap((storyboard) => storyboard.panels)
  const referenceImages = await collectEpisodeCoverReferences(projectData, panels)
  const style = getArtStylePrompt(modelConfig.artStyle, job.data.locale)
    || (job.data.locale === 'en' ? 'Follow the project visual style.' : '遵循项目视觉风格。')
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_EPISODE_COVER_IMAGE,
    locale: job.data.locale,
    variables: {
      episode_context: buildEpisodeContext(episode),
      aspect_ratio: aspectRatio,
      style,
    },
  })

  await reportTaskProgress(job, 20, { stage: 'generate_episode_cover' })
  const source = await resolveImageSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    prompt,
    options: {
      aspectRatio,
      referenceImages,
    },
    pollProgress: { start: 30, end: 88 },
  })

  const audited = await auditEpisodeCoverImage({
    userId: job.data.userId,
    projectId: job.data.projectId,
    imageSource: source,
    expectedAspectRatio: aspectRatio,
  })
  const media = await (async () => {
    let uploadedKey: string | null = null
    let candidateMedia: Awaited<ReturnType<typeof ensureMediaObjectFromStorageKey>> | null = null

    try {
      const uploaded = await uploadImageSourceToCosWithMetadata(audited.buffer, 'episode-cover', episode.id)
      uploadedKey = uploaded.key
      const candidate = await ensureMediaObjectFromStorageKey(uploaded.key, audited.metadata)
      candidateMedia = candidate

      await reportTaskProgress(job, 94, { stage: 'persist_episode_cover' })
      await prisma.$transaction(async (tx) => {
        const activeTask = await tx.task.findFirst({
          where: {
            id: job.data.taskId,
            projectId: job.data.projectId,
            status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
          },
          select: { id: true },
        })
        if (!activeTask) {
          throw new TaskTerminatedError(job.data.taskId)
        }
        await tx.novelPromotionEpisode.update({
          where: { id: episode.id },
          data: { coverImageMediaId: candidate.id },
        })
      }, { isolationLevel: 'Serializable' })
      return candidate
    } catch (taskError) {
      try {
        if (candidateMedia) {
          await deleteMediaObjectIfUnreferenced(candidateMedia.id)
        } else if (uploadedKey) {
          await deleteObject(uploadedKey)
        }
      } catch (cleanupError) {
        logger.warn({
          message: 'Failed to compensate Episode cover candidate',
          action: 'worker.episode-cover.cleanup_candidate_failed',
          projectId: job.data.projectId,
          taskId: job.data.taskId,
          details: {
            episodeId: episode.id,
            mediaId: candidateMedia?.id ?? null,
            storageKey: uploadedKey,
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          },
        })
      }
      throw taskError
    }
  })()

  if (episode.coverImageMediaId && episode.coverImageMediaId !== media.id) {
    try {
      await deleteMediaObjectIfUnreferenced(episode.coverImageMediaId)
    } catch (cleanupError) {
      logger.warn({
        message: 'Failed to clean superseded Episode cover',
        action: 'worker.episode-cover.cleanup_superseded_failed',
        projectId: job.data.projectId,
        taskId: job.data.taskId,
        details: {
          episodeId: episode.id,
          mediaId: episode.coverImageMediaId,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        },
      })
    }
  }

  return {
    episodeId: episode.id,
    coverImageMediaId: media.id,
    coverImageUrl: media.url,
  }
}
