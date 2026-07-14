import type { FinalRenderClipPlan } from './final-render-plan'

export type FinalRenderErrorLocale = 'zh' | 'en'

export type MissingFinalRenderVideo = {
  readonly sourceKind: FinalRenderClipPlan['sourceKind']
  readonly sourceId: string
  readonly segmentId: string | null
  readonly shotNumbers: readonly number[]
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeFinalRenderErrorLocale(value: string | null | undefined): FinalRenderErrorLocale {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function compressShotNumbers(shotNumbers: readonly number[]): string {
  const uniqueNumbers = [...new Set(shotNumbers)]
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right)
  if (uniqueNumbers.length === 0) return ''

  const ranges: string[] = []
  const firstNumber = uniqueNumbers[0] ?? 0
  let rangeStart = firstNumber
  let previous = firstNumber
  for (let index = 1; index < uniqueNumbers.length; index += 1) {
    const current = uniqueNumbers[index] ?? previous
    if (current === previous + 1) {
      previous = current
      continue
    }
    ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`)
    rangeStart = current
    previous = current
  }
  ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`)
  return ranges.join(', ')
}

function missingVideoLabel(input: MissingFinalRenderVideo, locale: FinalRenderErrorLocale): string {
  const shotNumbersText = compressShotNumbers(input.shotNumbers)
  if (locale === 'zh') {
    const target = input.sourceKind === 'videoSegment' ? '视频分段' : '章节视频'
    return shotNumbersText ? `${target}（镜头 ${shotNumbersText}）` : target
  }
  const target = input.sourceKind === 'videoSegment' ? 'video segment' : 'chapter video'
  return shotNumbersText ? `${target} (shots ${shotNumbersText})` : target
}

function formatMissingVideoMessage(input: {
  readonly missingVideos: readonly MissingFinalRenderVideo[]
  readonly locale: FinalRenderErrorLocale
}): string {
  const labels = input.missingVideos.map((item) => missingVideoLabel(item, input.locale))
  const joinedLabels = input.locale === 'zh' ? labels.join('、') : labels.join(', ')
  if (input.locale === 'zh') {
    return `AI 剪辑缺少可用视频：${joinedLabels}。请先生成这些视频后再剪辑。`
  }
  return `AI final edit is missing usable videos: ${joinedLabels}. Generate these videos before rendering the final edit.`
}

class FinalRenderMissingVideoError extends Error {
  readonly code = 'INVALID_PARAMS'
  readonly details: {
    readonly reason: 'FINAL_VIDEO_RENDER_MISSING_VIDEO'
    readonly missingVideos: readonly MissingFinalRenderVideo[]
  }

  constructor(input: {
    readonly missingVideos: readonly MissingFinalRenderVideo[]
    readonly locale: FinalRenderErrorLocale
  }) {
    super(formatMissingVideoMessage(input))
    this.name = 'FinalRenderMissingVideoError'
    this.details = {
      reason: 'FINAL_VIDEO_RENDER_MISSING_VIDEO',
      missingVideos: input.missingVideos,
    }
  }
}

function hasClipSource(clip: FinalRenderClipPlan): boolean {
  if (typeof clip.source === 'string') return Boolean(clip.source.trim())
  return Boolean(readString(clip.source.url) || readString(clip.source.storageKey))
}

function toMissingFinalRenderVideo(clip: FinalRenderClipPlan): MissingFinalRenderVideo {
  return {
    sourceKind: clip.sourceKind,
    sourceId: clip.sourceId,
    segmentId: clip.segmentId,
    shotNumbers: clip.shotNumbers,
  }
}

export function assertFinalRenderClipsHaveSources(input: {
  readonly clips: readonly FinalRenderClipPlan[]
  readonly locale: FinalRenderErrorLocale
}): void {
  const missingVideos = input.clips
    .filter((clip) => !hasClipSource(clip))
    .map(toMissingFinalRenderVideo)
  if (missingVideos.length === 0) return
  throw new FinalRenderMissingVideoError({
    missingVideos,
    locale: input.locale,
  })
}
