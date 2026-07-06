import { prisma } from '@/lib/prisma'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import type { FinalRenderClipPlan } from './final-render-plan'

function readChapterShotRefs(input: {
  readonly chapterId: string
  readonly corePlanJson: unknown
}): {
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
} {
  const parsed = editScriptStructureSchema.safeParse(input.corePlanJson)
  if (!parsed.success) {
    throw new Error(`EPISODE_CHAPTER_EDIT_SCRIPT_INVALID:${input.chapterId}`)
  }
  return {
    shotIds: parsed.data.shots.map((shot) => shot.shotId),
    shotNumbers: parsed.data.shots.map((shot) => shot.shotNumber),
  }
}

export async function loadEpisodeChapterOutputClips(input: {
  readonly episodeId: string
  readonly projectId: string
}): Promise<FinalRenderClipPlan[]> {
  const chapters = await prisma.projectEditChapter.findMany({
    where: {
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
    },
    orderBy: { chapterIndex: 'asc' },
    include: {
      outputMedia: true,
      editScript: {
        select: {
          corePlanJson: true,
        },
      },
    },
  })
  if (chapters.length === 0) throw new Error(`EPISODE_CHAPTER_OUTPUTS_REQUIRED:${input.episodeId}`)
  return chapters.map((chapter, index): FinalRenderClipPlan => {
    if (chapter.renderStatus !== 'completed') {
      throw new Error(`EPISODE_CHAPTER_RENDER_NOT_COMPLETED:${chapter.id}:${chapter.renderStatus ?? 'null'}`)
    }
    if (!chapter.outputMedia) {
      throw new Error(`EPISODE_CHAPTER_OUTPUT_REQUIRED:${chapter.id}`)
    }
    const durationSeconds = typeof chapter.outputMedia.durationMs === 'number' && chapter.outputMedia.durationMs > 0
      ? chapter.outputMedia.durationMs / 1000
      : null
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`EPISODE_CHAPTER_DURATION_REQUIRED:${chapter.id}`)
    }
    const shotRefs = readChapterShotRefs({
      chapterId: chapter.id,
      corePlanJson: chapter.editScript?.corePlanJson ?? null,
    })
    return {
      panelId: chapter.id,
      groupId: null,
      sourceKind: 'panel',
      source: {
        storageKey: chapter.outputMedia.storageKey,
      },
      durationSeconds,
      order: index + 1,
      shotNumber: null,
      shotNumbers: shotRefs.shotNumbers,
      shotId: null,
      shotIds: shotRefs.shotIds,
      description: [chapter.title, chapter.summary]
        .map((value) => value?.trim() ?? '')
        .filter(Boolean)
        .join('\n') || null,
      sound: null,
    }
  })
}
