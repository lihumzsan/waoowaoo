import { prisma } from '@/lib/prisma'
import { editScriptStructureSchema, type EditScriptShot } from '@/lib/edit-script/types'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { BGM_DESIGN_FPS, BGM_DESIGN_SAMPLE_RATE, type BgmDesignClock } from './types'

export type BgmDesignScriptShotFact = {
  readonly chapterId: string
  readonly shotId: string
  readonly shotNumber: number
  readonly range: { readonly startFrame: number; readonly endFrameExclusive: number }
  readonly scene: EditScriptShot['scene']
  readonly shotPurpose: EditScriptShot['shotPurpose']
  readonly action: string
  readonly dialogue: readonly { readonly characterId: string; readonly line: string }[]
  readonly synchronousSound: string
}

export type BgmDesignPlanningInput = {
  readonly clock: BgmDesignClock
  readonly clips: readonly {
    readonly sourceId: string
    readonly order: number
    readonly range: { readonly startFrame: number; readonly endFrameExclusive: number }
    readonly shotIds: readonly string[]
    readonly shotNumbers: readonly number[]
    readonly description: string | null
    readonly synchronousSound: string | null
  }[]
  readonly scriptShots: readonly BgmDesignScriptShotFact[]
}

function ensureTimeline(clips: readonly FinalRenderClipPlan[]): void {
  if (clips.length === 0) throw new Error('BGM_DESIGN_TIMELINE_REQUIRED')
  const invalid = clips.find((clip) => !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0)
  if (invalid) throw new Error(`BGM_DESIGN_TIMELINE_DURATION_INVALID:${invalid.sourceId}`)
}

function allocateRanges(durations: readonly number[], startFrame: number, endFrameExclusive: number): readonly { startFrame: number; endFrameExclusive: number }[] {
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0)
  if (totalDuration <= 0) throw new Error('BGM_DESIGN_SCRIPT_DURATION_INVALID')
  let cursor = startFrame
  let cumulativeDuration = 0
  return durations.map((duration, index) => {
    cumulativeDuration += duration
    const end = index === durations.length - 1
      ? endFrameExclusive
      : startFrame + Math.round((endFrameExclusive - startFrame) * cumulativeDuration / totalDuration)
    if (end <= cursor) throw new Error('BGM_DESIGN_SCRIPT_FRAME_RANGE_INVALID')
    const range = { startFrame: cursor, endFrameExclusive: end }
    cursor = end
    return range
  })
}

export async function loadBgmDesignPlanningInput(input: {
  readonly episodeId: string
  readonly projectId: string
  readonly clips: readonly FinalRenderClipPlan[]
}): Promise<BgmDesignPlanningInput> {
  ensureTimeline(input.clips)
  const scripts = await prisma.projectEditScript.findMany({
    where: { episodeId: input.episodeId, projectId: input.projectId, status: 'ready' },
    select: { chapterId: true, corePlanJson: true, chapter: { select: { chapterIndex: true } } },
    orderBy: { chapter: { chapterIndex: 'asc' } },
  })
  if (scripts.length !== input.clips.length) {
    throw new Error(`BGM_DESIGN_SCRIPT_TIMELINE_MISMATCH:${scripts.length}:${input.clips.length}`)
  }
  const totalFrames = Math.round(input.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0) * BGM_DESIGN_FPS)
  if (totalFrames < 2) throw new Error('BGM_DESIGN_TIMELINE_TOO_SHORT')
  const clock: BgmDesignClock = { fps: BGM_DESIGN_FPS, sampleRate: BGM_DESIGN_SAMPLE_RATE, totalFrames }
  const clipRanges = allocateRanges(input.clips.map((clip) => clip.durationSeconds), 0, totalFrames)
  const clipFacts = input.clips.map((clip, index) => ({
    sourceId: clip.sourceId,
    order: clip.order,
    range: clipRanges[index] as { startFrame: number; endFrameExclusive: number },
    shotIds: [...clip.shotIds],
    shotNumbers: [...clip.shotNumbers],
    description: clip.description,
    synchronousSound: clip.synchronousSound,
  }))
  const scriptShots: BgmDesignScriptShotFact[] = []
  for (const [index, script] of scripts.entries()) {
    const parsed = editScriptStructureSchema.safeParse(script.corePlanJson)
    if (!parsed.success) throw new Error(`BGM_DESIGN_EDIT_SCRIPT_INVALID:${script.chapterId}`)
    const clip = input.clips[index]
    const clipRange = clipRanges[index]
    if (!clip || !clipRange || clip.sourceId !== script.chapterId) {
      throw new Error(`BGM_DESIGN_CHAPTER_ORDER_MISMATCH:${script.chapterId}:${clip?.sourceId ?? 'missing'}`)
    }
    const ranges = allocateRanges(parsed.data.shots.map((shot) => shot.durationSec), clipRange.startFrame, clipRange.endFrameExclusive)
    parsed.data.shots.forEach((shot, shotIndex) => {
      scriptShots.push({
        chapterId: script.chapterId,
        shotId: shot.shotId,
        shotNumber: shot.shotNumber,
        range: ranges[shotIndex] as { startFrame: number; endFrameExclusive: number },
        scene: shot.scene,
        shotPurpose: shot.shotPurpose,
        action: shot.action,
        dialogue: shot.dialogue,
        synchronousSound: shot.synchronousSound,
      })
    })
  }
  return { clock, clips: clipFacts, scriptShots }
}
