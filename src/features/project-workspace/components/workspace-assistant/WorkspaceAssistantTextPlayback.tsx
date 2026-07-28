'use client'

import { useLocale } from 'next-intl'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const LOW_WATER_GRAPHEMES = 7
const PLAYBACK_INTERVAL_MS = 28
const LOW_WATER_INTERVAL_MS = 38
const MAX_FADE_GRAPHEMES = 2400
const TERMINAL_DRAIN_TICKS = 24

type WorkspaceAssistantTextPlayback = {
  readonly text: string
  readonly animating: boolean
}

export type WorkspaceAssistantTextPlaybackCheckpoint = {
  readonly sourceText: string
  readonly displayedCount: number
  readonly started: boolean
  readonly streamed: boolean
}

type WorkspaceAssistantTextPlaybackInitialState = Omit<
  WorkspaceAssistantTextPlaybackCheckpoint,
  'sourceText'
>

type WorkspaceAssistantTextPlaybackRegistry = Map<
  string,
  WorkspaceAssistantTextPlaybackCheckpoint
>

const WorkspaceAssistantTextPlaybackRegistryContext = createContext<
  WorkspaceAssistantTextPlaybackRegistry | null
>(null)

export function WorkspaceAssistantTextPlaybackProvider(props: {
  readonly children: ReactNode
}) {
  const registryRef = useRef<WorkspaceAssistantTextPlaybackRegistry>(new Map())
  return (
    <WorkspaceAssistantTextPlaybackRegistryContext.Provider value={registryRef.current}>
      {props.children}
    </WorkspaceAssistantTextPlaybackRegistryContext.Provider>
  )
}

function segmentGraphemes(text: string, locale: string): readonly string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (segment) => segment.segment)
}

export function resolveWorkspaceAssistantTextPlaybackInitialState(params: {
  readonly sourceText: string
  readonly targetLength: number
  readonly running: boolean
  readonly checkpoint: WorkspaceAssistantTextPlaybackCheckpoint | null
}): WorkspaceAssistantTextPlaybackInitialState {
  return {
    displayedCount: params.targetLength,
    started: true,
    streamed: params.checkpoint?.streamed === true || params.running,
  }
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
  readonly playbackKey?: string | null
}): WorkspaceAssistantTextPlayback {
  const locale = useLocale()
  const registry = useContext(WorkspaceAssistantTextPlaybackRegistryContext)
  const targetGraphemes = useMemo(
    () => segmentGraphemes(params.text, locale),
    [locale, params.text],
  )
  const initialStateRef = useRef<WorkspaceAssistantTextPlaybackInitialState | null>(null)
  if (!initialStateRef.current) {
    initialStateRef.current = resolveWorkspaceAssistantTextPlaybackInitialState({
      sourceText: params.text,
      targetLength: targetGraphemes.length,
      running: params.running,
      checkpoint: params.playbackKey
        ? registry?.get(params.playbackKey) ?? null
        : null,
    })
  }
  const streamedRef = useRef(initialStateRef.current.streamed)
  const previousSourceRef = useRef(params.text)
  const [displayedCount, setDisplayedCount] = useState(
    initialStateRef.current.displayedCount,
  )
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

  useEffect(() => {
    if (params.running) streamedRef.current = true
  }, [params.running])

  useEffect(() => {
    const previousSource = previousSourceRef.current
    previousSourceRef.current = params.text
    if (params.text.startsWith(previousSource)) return
    commitDisplayedCount(targetGraphemes.length)
  }, [commitDisplayedCount, params.text, targetGraphemes.length])

  useEffect(() => {
    if (params.running || streamedRef.current) return
    commitDisplayedCount(targetGraphemes.length)
  }, [commitDisplayedCount, params.running, targetGraphemes.length])

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
  useEffect(() => {
    if (!registry || !params.playbackKey) return
    if (!params.running && boundedDisplayedCount >= targetGraphemes.length) {
      registry.delete(params.playbackKey)
      return
    }
    registry.set(params.playbackKey, {
      sourceText: params.text,
      displayedCount: boundedDisplayedCount,
      started: true,
      streamed: streamedRef.current,
    })
  }, [
    boundedDisplayedCount,
    params.playbackKey,
    params.running,
    params.text,
    registry,
    targetGraphemes.length,
  ])

  return {
    text: targetGraphemes.slice(0, boundedDisplayedCount).join(''),
    animating: (
      params.running || boundedDisplayedCount < targetGraphemes.length
    ) && boundedDisplayedCount <= MAX_FADE_GRAPHEMES,
  }
}

export function WorkspaceAssistantAnimatedPlainText(props: {
  readonly text: string
  readonly running: boolean
  readonly playbackKey: string
}) {
  const locale = useLocale()
  const playback = useWorkspaceAssistantTextPlayback(props)
  const graphemes = useMemo(
    () => segmentGraphemes(playback.text, locale),
    [locale, playback.text],
  )

  if (!playback.animating) return playback.text

  return (
    <>
      {graphemes.map((grapheme, index) => (
        <span
          key={index}
          className="animate-in fade-in duration-150 motion-reduce:animate-none"
        >
          {grapheme}
        </span>
      ))}
    </>
  )
}
