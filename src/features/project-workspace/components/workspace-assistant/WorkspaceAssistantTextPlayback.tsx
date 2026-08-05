'use client'

import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const LOW_WATER_GRAPHEMES = 7
const PLAYBACK_INTERVAL_MS = 28
const LOW_WATER_INTERVAL_MS = 38
const MAX_FADE_GRAPHEMES = 2400
const TERMINAL_DRAIN_TICKS = 24

type WorkspaceAssistantTextPlayback = {
  readonly text: string
  readonly animating: boolean
}

function segmentGraphemes(text: string, locale: string): readonly string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (segment) => segment.segment)
}

function resolvePlaybackStep(backlog: number, running: boolean): number {
  if (!running) return Math.max(1, Math.ceil(backlog / TERMINAL_DRAIN_TICKS))
  if (backlog > 1000) return 16
  if (backlog > 400) return 8
  if (backlog > 120) return 4
  if (backlog > 48) return 2
  return 1
}

export function resolveWorkspaceAssistantTextPlaybackTick(params: {
  readonly displayedCount: number
  readonly targetLength: number
  readonly running: boolean
}): {
  readonly continuePlayback: boolean
  readonly intervalMs: number
  readonly nextDisplayedCount: number
} {
  const targetLength = Math.max(0, params.targetLength)
  const displayedCount = Math.min(Math.max(0, params.displayedCount), targetLength)
  const backlog = targetLength - displayedCount
  const nextDisplayedCount = backlog > 0
    ? Math.min(
        targetLength,
        displayedCount + resolvePlaybackStep(backlog, params.running),
      )
    : displayedCount
  const remaining = targetLength - nextDisplayedCount
  return {
    continuePlayback: params.running || remaining > 0,
    intervalMs: params.running && remaining <= LOW_WATER_GRAPHEMES
      ? LOW_WATER_INTERVAL_MS
      : PLAYBACK_INTERVAL_MS,
    nextDisplayedCount,
  }
}

export function useWorkspaceAssistantTextPlayback(params: {
  readonly text: string
  readonly running: boolean
}): WorkspaceAssistantTextPlayback {
  const locale = useLocale()
  const targetGraphemes = useMemo(
    () => segmentGraphemes(params.text, locale),
    [locale, params.text],
  )
  // 挂载即显示 canonical 全文,不重播历史动画。
  const [displayedCount, setDisplayedCount] = useState(() => targetGraphemes.length)
  const previousSourceRef = useRef(params.text)
  const displayedCountRef = useRef(displayedCount)
  const targetLengthRef = useRef(targetGraphemes.length)
  const runningRef = useRef(params.running)
  const timerRef = useRef<number | null>(null)
  const tickRef = useRef<() => void>(() => undefined)
  const commitDisplayedCount = useCallback((nextDisplayedCount: number) => {
    if (displayedCountRef.current === nextDisplayedCount) return
    displayedCountRef.current = nextDisplayedCount
    setDisplayedCount(nextDisplayedCount)
  }, [])

  displayedCountRef.current = displayedCount
  targetLengthRef.current = targetGraphemes.length
  runningRef.current = params.running

  // 挂载后的文本变化只有两种:前缀增长与非前缀替换。前缀增长一律视为流式
  // 输入(消息状态是否 running 不参与裁决 —— 控制流 merge 的正文以非
  // running 状态逐 chunk 增长),游标交给下方唯一的自维持 tick 时钟排空,
  // 此处绝不逐 chunk 派发 React state;非前缀替换意味着换成另一份 canonical
  // 文本,游标一次性跳到全文。
  useEffect(() => {
    const previousSource = previousSourceRef.current
    previousSourceRef.current = params.text
    if (params.text.startsWith(previousSource)) return
    commitDisplayedCount(targetGraphemes.length)
  }, [commitDisplayedCount, params.text, targetGraphemes.length])

  tickRef.current = () => {
    timerRef.current = null
    const tick = resolveWorkspaceAssistantTextPlaybackTick({
      displayedCount: displayedCountRef.current,
      targetLength: targetLengthRef.current,
      running: runningRef.current,
    })
    commitDisplayedCount(tick.nextDisplayedCount)
    if (!tick.continuePlayback) return
    timerRef.current = window.setTimeout(() => tickRef.current(), tick.intervalMs)
  }

  // Keep one self-sustaining clock per mounted text part. Incoming deltas only
  // update refs; they never cancel or restart the pending tick.
  useEffect(() => {
    if (timerRef.current !== null) return
    const tick = resolveWorkspaceAssistantTextPlaybackTick({
      displayedCount,
      targetLength: targetGraphemes.length,
      running: params.running,
    })
    if (!tick.continuePlayback) return
    timerRef.current = window.setTimeout(() => tickRef.current(), tick.intervalMs)
  })

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const boundedDisplayedCount = Math.min(displayedCount, targetGraphemes.length)
  return {
    text: targetGraphemes.slice(0, boundedDisplayedCount).join(''),
    animating: (
      params.running || boundedDisplayedCount < targetGraphemes.length
    ) && boundedDisplayedCount <= MAX_FADE_GRAPHEMES,
  }
}

/** Mirrors the markdown renderer's tail ramp so both surfaces stream alike. */
const STREAM_TAIL_LENGTH = 14
const STREAM_TAIL_MIN_OPACITY = 0.12
const STREAM_TAIL_MAX_BLUR_PX = 2.4

export function WorkspaceAssistantAnimatedPlainText(props: {
  readonly text: string
  readonly running: boolean
}) {
  const locale = useLocale()
  const playback = useWorkspaceAssistantTextPlayback(props)
  const graphemes = useMemo(
    () => segmentGraphemes(playback.text, locale),
    [locale, playback.text],
  )

  if (!playback.animating) return playback.text

  // Only the writing edge is decorated; everything before it is plain text, so
  // a long reply does not carry thousands of styled spans.
  const tailStart = Math.max(0, graphemes.length - STREAM_TAIL_LENGTH)
  const tailLength = graphemes.length - tailStart
  return (
    <>
      {graphemes.slice(0, tailStart).join('')}
      {graphemes.slice(tailStart).map((grapheme, index) => {
        const depth = (tailLength - index) / tailLength
        return (
          <span
            key={tailStart + index}
            className="assistant-stream-tail"
            style={{
              ['--assistant-stream-tail-opacity' as string]: (1 - (1 - STREAM_TAIL_MIN_OPACITY) * depth * depth).toFixed(3),
              ['--assistant-stream-tail-blur' as string]: `${(STREAM_TAIL_MAX_BLUR_PX * depth * depth).toFixed(2)}px`,
            }}
          >
            {grapheme}
          </span>
        )
      })}
    </>
  )
}
