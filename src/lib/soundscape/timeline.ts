import { buildBgmTimelineSignature } from '@/lib/bgm-score/timeline'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import type { SoundscapePlan, SoundscapePlanSection } from './types'

export interface SoundscapeResolvedSection {
  readonly section: SoundscapePlanSection
  readonly index: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly durationSeconds: number
  readonly sourceClipOrders: readonly number[]
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
}

function ensureTimeline(clips: readonly FinalRenderClipPlan[]): void {
  if (clips.length === 0) throw new Error('SOUNDSCAPE_TIMELINE_EMPTY')
  const invalid = clips.find((clip) => !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0)
  if (invalid) throw new Error(`SOUNDSCAPE_TIMELINE_CLIP_DURATION_INVALID:${invalid.panelId}`)
}

export function buildSoundscapeTimelineSignature(clips: readonly FinalRenderClipPlan[]): string {
  return buildBgmTimelineSignature(clips)
}

function buildClipStartTimes(clips: readonly FinalRenderClipPlan[]): readonly number[] {
  const starts: number[] = []
  let cursor = 0
  for (const clip of clips) {
    starts.push(cursor)
    cursor += clip.durationSeconds
  }
  return starts
}

function findClipIndexForShotId(clips: readonly FinalRenderClipPlan[], shotId: string): number {
  const index = clips.findIndex((clip) => clip.shotIds.includes(shotId))
  if (index === -1) throw new Error(`SOUNDSCAPE_SHOT_ANCHOR_NOT_FOUND:${shotId}`)
  return index
}

function collectSectionShotIds(clips: readonly FinalRenderClipPlan[], fromIndex: number, toIndex: number): string[] {
  return Array.from(new Set(clips.slice(fromIndex, toIndex + 1).flatMap((clip) => clip.shotIds)))
}

function collectSectionShotNumbers(clips: readonly FinalRenderClipPlan[], fromIndex: number, toIndex: number): number[] {
  return Array.from(new Set(clips.slice(fromIndex, toIndex + 1).flatMap((clip) => clip.shotNumbers)))
}

export function resolveSoundscapeSectionTimeline(input: {
  readonly clips: readonly FinalRenderClipPlan[]
  readonly plan: SoundscapePlan
}): SoundscapeResolvedSection[] {
  ensureTimeline(input.clips)
  if (input.plan.decision === 'none_needed') return []

  const clipStarts = buildClipStartTimes(input.clips)
  return input.plan.sections.map((section, index) => {
    const fromIndex = findClipIndexForShotId(input.clips, section.fromShotId)
    const toIndex = findClipIndexForShotId(input.clips, section.toShotId)
    if (toIndex < fromIndex) {
      throw new Error(`SOUNDSCAPE_SHOT_ANCHOR_ORDER_INVALID:${section.fromShotId}:${section.toShotId}`)
    }

    const startSeconds = clipStarts[fromIndex]
    const toClip = input.clips[toIndex]
    if (startSeconds === undefined || !toClip) {
      throw new Error('SOUNDSCAPE_SHOT_ANCHOR_RESOLUTION_FAILED')
    }
    const endSeconds = clipStarts[toIndex] + toClip.durationSeconds
    const durationSeconds = endSeconds - startSeconds
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`SOUNDSCAPE_SECTION_DURATION_INVALID:${section.fromShotId}:${section.toShotId}`)
    }

    return {
      section,
      index,
      startSeconds,
      endSeconds,
      durationSeconds,
      sourceClipOrders: input.clips.slice(fromIndex, toIndex + 1).map((clip) => clip.order),
      shotIds: collectSectionShotIds(input.clips, fromIndex, toIndex),
      shotNumbers: collectSectionShotNumbers(input.clips, fromIndex, toIndex),
    }
  })
}
