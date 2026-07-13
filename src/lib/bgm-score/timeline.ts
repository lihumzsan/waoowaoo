import { createHash } from 'node:crypto'
import { MUSIC_SCORE_MAX_CUE_DURATION_SECONDS } from '@/lib/music-score/constraints'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'

export type BgmScoreCueWindow = {
  readonly cueId: string
  readonly index: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly durationSeconds: number
  readonly clips: readonly FinalRenderClipPlan[]
  readonly sourceClipOrders: readonly number[]
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
}

function cloneClipForCue(clip: FinalRenderClipPlan, durationSeconds: number): FinalRenderClipPlan {
  return { ...clip, durationSeconds }
}

function pushCueWindow(
  output: BgmScoreCueWindow[],
  startSeconds: number,
  durationSeconds: number,
  clips: readonly FinalRenderClipPlan[],
): void {
  if (durationSeconds <= 0) return
  const index = output.length + 1
  output.push({
    cueId: `cue-${String(index).padStart(3, '0')}`,
    index,
    startSeconds,
    endSeconds: startSeconds + durationSeconds,
    durationSeconds,
    clips,
    sourceClipOrders: Array.from(new Set(clips.map((clip) => clip.order))),
    shotIds: Array.from(new Set(clips.flatMap((clip) => clip.shotIds))),
    shotNumbers: Array.from(new Set(clips.flatMap((clip) => clip.shotNumbers))),
  })
}

export function buildBgmScoreCueWindows(
  clips: readonly FinalRenderClipPlan[],
  maxCueDurationSeconds = MUSIC_SCORE_MAX_CUE_DURATION_SECONDS,
): BgmScoreCueWindow[] {
  if (!Number.isFinite(maxCueDurationSeconds) || maxCueDurationSeconds <= 0) {
    throw new Error('BGM_SCORE_MAX_CUE_DURATION_INVALID')
  }
  const cues: BgmScoreCueWindow[] = []
  let cueStartSeconds = 0
  let cueDurationSeconds = 0
  let timelineCursorSeconds = 0
  let cueClips: FinalRenderClipPlan[] = []

  for (const clip of clips) {
    let remainingClipSeconds = clip.durationSeconds
    while (remainingClipSeconds > 0) {
      const pieceSeconds = Math.min(remainingClipSeconds, maxCueDurationSeconds - cueDurationSeconds)
      cueClips.push(cloneClipForCue(clip, pieceSeconds))
      cueDurationSeconds += pieceSeconds
      timelineCursorSeconds += pieceSeconds
      remainingClipSeconds -= pieceSeconds

      if (cueDurationSeconds >= maxCueDurationSeconds - 0.001) {
        pushCueWindow(cues, cueStartSeconds, cueDurationSeconds, cueClips)
        cueStartSeconds = timelineCursorSeconds
        cueDurationSeconds = 0
        cueClips = []
      }
    }
  }

  pushCueWindow(cues, cueStartSeconds, cueDurationSeconds, cueClips)
  return cues
}

export function buildBgmTimelineSignature(clips: readonly FinalRenderClipPlan[]): string {
  const payload = clips.map((clip) => ({
    order: clip.order,
    sourceKind: clip.sourceKind,
    panelId: clip.panelId,
    groupId: clip.groupId ?? null,
    shotIds: clip.shotIds,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
  }))
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24)
}
