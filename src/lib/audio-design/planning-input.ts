import { prisma } from '@/lib/prisma'
import { editScriptStructureSchema, type EditScriptShot } from '@/lib/edit-script/types'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { AUDIO_DESIGN_FPS, AUDIO_DESIGN_SAMPLE_RATE, type AudioDesignClock } from './types'

export type AudioDesignScriptShotFact = {
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

export type AudioDesignPlanningInput = {
  readonly clock: AudioDesignClock
  readonly clips: readonly {
    readonly sourceId: string
    readonly order: number
    readonly range: { readonly startFrame: number; readonly endFrameExclusive: number }
    readonly shotIds: readonly string[]
    readonly shotNumbers: readonly number[]
    readonly description: string | null
    readonly synchronousSound: string | null
  }[]
  readonly scriptShots: readonly AudioDesignScriptShotFact[]
  readonly soundWorldBoundaryFrames: readonly number[]
}

function ensureTimeline(clips: readonly FinalRenderClipPlan[]): void {
  if (clips.length === 0) throw new Error('AUDIO_DESIGN_TIMELINE_REQUIRED')
  const invalid = clips.find((clip) => !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0)
  if (invalid) throw new Error(`AUDIO_DESIGN_TIMELINE_DURATION_INVALID:${invalid.sourceId}`)
}

function allocateRanges(durations: readonly number[], startFrame: number, endFrameExclusive: number): readonly { startFrame: number; endFrameExclusive: number }[] {
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0)
  if (totalDuration <= 0) throw new Error('AUDIO_DESIGN_SCRIPT_DURATION_INVALID')
  let cursor = startFrame
  let cumulativeDuration = 0
  return durations.map((duration, index) => {
    cumulativeDuration += duration
    const end = index === durations.length - 1
      ? endFrameExclusive
      : startFrame + Math.round((endFrameExclusive - startFrame) * cumulativeDuration / totalDuration)
    if (end <= cursor) throw new Error('AUDIO_DESIGN_SCRIPT_FRAME_RANGE_INVALID')
    const range = { startFrame: cursor, endFrameExclusive: end }
    cursor = end
    return range
  })
}

export async function loadAudioDesignPlanningInput(input: {
  readonly episodeId: string
  readonly projectId: string
  readonly clips: readonly FinalRenderClipPlan[]
}): Promise<AudioDesignPlanningInput> {
  ensureTimeline(input.clips)
  const scripts = await prisma.projectEditScript.findMany({
    where: { episodeId: input.episodeId, projectId: input.projectId, status: 'ready' },
    select: { chapterId: true, corePlanJson: true, chapter: { select: { chapterIndex: true } } },
    orderBy: { chapter: { chapterIndex: 'asc' } },
  })
  if (scripts.length !== input.clips.length) {
    throw new Error(`AUDIO_DESIGN_SCRIPT_TIMELINE_MISMATCH:${scripts.length}:${input.clips.length}`)
  }
  const totalFrames = Math.round(input.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0) * AUDIO_DESIGN_FPS)
  if (totalFrames < 2) throw new Error('AUDIO_DESIGN_TIMELINE_TOO_SHORT')
  const clock: AudioDesignClock = { fps: AUDIO_DESIGN_FPS, sampleRate: AUDIO_DESIGN_SAMPLE_RATE, totalFrames }
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
  const scriptShots: AudioDesignScriptShotFact[] = []
  for (const [index, script] of scripts.entries()) {
    const parsed = editScriptStructureSchema.safeParse(script.corePlanJson)
    if (!parsed.success) throw new Error(`AUDIO_DESIGN_EDIT_SCRIPT_INVALID:${script.chapterId}`)
    const clip = input.clips[index]
    const clipRange = clipRanges[index]
    if (!clip || !clipRange || clip.sourceId !== script.chapterId) {
      throw new Error(`AUDIO_DESIGN_CHAPTER_ORDER_MISMATCH:${script.chapterId}:${clip?.sourceId ?? 'missing'}`)
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
  const soundWorldBoundaryFrames = [0]
  for (let index = 1; index < scriptShots.length; index += 1) {
    const previous = scriptShots[index - 1]
    const current = scriptShots[index]
    if (!previous || !current) continue
    const sceneChanged = previous.scene.locationId !== current.scene.locationId
      || previous.scene.subScene !== current.scene.subScene
    if (sceneChanged || previous.chapterId !== current.chapterId) soundWorldBoundaryFrames.push(current.range.startFrame)
  }
  return { clock, clips: clipFacts, scriptShots, soundWorldBoundaryFrames }
}

export function assertAudioDesignUsesScriptBoundaries(input: {
  readonly soundWorldBoundaryFrames: readonly number[]
  readonly soundWorlds: readonly { readonly worldId: string; readonly range: { readonly startFrame: number } }[]
}): void {
  const allowed = new Set(input.soundWorldBoundaryFrames)
  const invalid = input.soundWorlds.find((world) => !allowed.has(world.range.startFrame))
  if (invalid) throw new Error(`AUDIO_SOUND_WORLD_BOUNDARY_NOT_IN_SCRIPT:${invalid.worldId}:${invalid.range.startFrame}`)
}
