'use client'

import { useLocale } from 'next-intl'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const START_BUFFER_GRAPHEMES = 12
const LOW_WATER_GRAPHEMES = 7
const PREBUFFER_TIMEOUT_MS = 260
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
  const [started, setStarted] = useState(initialStateRef.current.started)

  useEffect(() => {
    if (params.running) streamedRef.current = true
  }, [params.running])

  useEffect(() => {
    const previousSource = previousSourceRef.current
    previousSourceRef.current = params.text
    if (params.text.startsWith(previousSource)) return
    setDisplayedCount(targetGraphemes.length)
    setStarted(true)
  }, [params.text, targetGraphemes.length])

  useEffect(() => {
    if (params.running || streamedRef.current) return
    setDisplayedCount(targetGraphemes.length)
    setStarted(true)
  }, [params.running, targetGraphemes.length])

  const backlog = Math.max(0, targetGraphemes.length - displayedCount)
  const hasBacklog = backlog > 0

  useEffect(() => {
    if (started || !hasBacklog) return
    if (backlog >= START_BUFFER_GRAPHEMES || !params.running) {
      setStarted(true)
    }
  }, [backlog, hasBacklog, params.running, started])

  useEffect(() => {
    if (started || !hasBacklog || !params.running) return
    const timer = window.setTimeout(() => setStarted(true), PREBUFFER_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [hasBacklog, params.running, started])

  useEffect(() => {
    if (!started || backlog <= 0) return
    const interval = params.running && backlog <= LOW_WATER_GRAPHEMES
      ? LOW_WATER_INTERVAL_MS
      : PLAYBACK_INTERVAL_MS
    const step = resolvePlaybackStep(backlog, params.running)
    const timer = window.setTimeout(() => {
      setDisplayedCount((current) => Math.min(
        targetGraphemes.length,
        current + step,
      ))
    }, interval)
    return () => window.clearTimeout(timer)
  }, [backlog, params.running, started, targetGraphemes.length])

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
      started,
      streamed: streamedRef.current,
    })
  }, [
    boundedDisplayedCount,
    params.playbackKey,
    params.running,
    params.text,
    registry,
    started,
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
