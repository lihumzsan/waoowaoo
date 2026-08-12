'use client'

import {
  useMessage,
  type ReasoningMessagePartProps,
} from '@assistant-ui/react'
import { useTranslations } from 'next-intl'
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
type SetWorkspaceAssistantRunningSurface = (key: string, active: boolean) => void
const WorkspaceAssistantRunningSurfaceSetterContext = createContext<SetWorkspaceAssistantRunningSurface | null>(null)
const WorkspaceAssistantRunningSurfaceCountContext = createContext(0)

/**
 * AR-04G: exactly one active-turn indicator. The registry only represents the
 * turn currently in flight — surfaces register per message identity and only
 * from the last thread message, and the registry is deterministically cleared
 * whenever a new turn begins (`activeTurn` rising edge). Historical messages
 * with non-terminal parts can therefore never suppress the wait dots.
 */
export function WorkspaceAssistantRunningSurfaceProvider({
  activeTurn,
  children,
}: {
  readonly activeTurn: boolean
  readonly children: ReactNode
}) {
  const [activeSurfaceKeys, setActiveSurfaceKeys] = useState<ReadonlySet<string>>(() => new Set())
  const setRunningSurface = useCallback<SetWorkspaceAssistantRunningSurface>((key, active) => {
    setActiveSurfaceKeys((current) => {
      const alreadyActive = current.has(key)
      if (alreadyActive === active) return current
      const next = new Set(current)
      if (active) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  useLayoutEffect(() => {
    if (!activeTurn) return
    setActiveSurfaceKeys((current) => current.size === 0 ? current : new Set())
  }, [activeTurn])
  const activeSurfaceCount = activeTurn ? activeSurfaceKeys.size : 0

  return (
    <WorkspaceAssistantRunningSurfaceSetterContext.Provider value={setRunningSurface}>
      <WorkspaceAssistantRunningSurfaceCountContext.Provider value={activeSurfaceCount}>
        {children}
      </WorkspaceAssistantRunningSurfaceCountContext.Provider>
    </WorkspaceAssistantRunningSurfaceSetterContext.Provider>
  )
}

/**
 * Registers a running surface for the current turn. The registration key is
 * namespaced by the owning message identity, and registration is gated to the
 * last thread message so replayed history never counts as a live surface.
 */
export function useWorkspaceAssistantRunningSurface(key: string, active: boolean): void {
  const setRunningSurface = useContext(WorkspaceAssistantRunningSurfaceSetterContext)
  const messageId = useMessage((state) => state.id)
  const isLastMessage = useMessage((state) => state.isLast)
  const scopedKey = `${messageId}:${key}`
  const effectiveActive = active && isLastMessage
  useLayoutEffect(() => {
    if (!setRunningSurface) return
    setRunningSurface(scopedKey, effectiveActive)
    return () => setRunningSurface(scopedKey, false)
  }, [effectiveActive, scopedKey, setRunningSurface])
}

export function useWorkspaceAssistantHasRunningSurface(): boolean {
  return useContext(WorkspaceAssistantRunningSurfaceCountContext) > 0
}

// Beautiful UI Loading State: a 3×3 pixel grid whose chevron wavefront drives
// right, paired with a live elapsed timer. The local clock is the liveness
// proof — it cannot fail to arrive the way provider progress events can.
const WAIT_PIXEL_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

function useWaitElapsedLabel(): string {
  const [deciseconds, setDeciseconds] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setDeciseconds((current) => current + 1), 100)
    return () => window.clearInterval(timer)
  }, [])
  const total = deciseconds / 10
  if (total < 60) return `${total.toFixed(1)}s`
  return `${String(Math.floor(total / 60))}m ${(total % 60).toFixed(1)}s`
}

export function WorkspaceAssistantWaitDots() {
  const elapsed = useWaitElapsedLabel()
  return (
    <div
      className="flex min-h-6 items-center gap-2.5 text-[var(--bui-ink)]"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {WAIT_PIXEL_DELAYS.map((delay, index) => (
          <span
            key={index}
            className="wa-bui-pixel size-[4px] rounded-[1px] bg-[var(--bui-ink)]"
            style={{
              opacity: 0.15,
              animation: `wa-bui-pixel-on 650ms ease-in-out ${String(delay)}ms infinite`,
            }}
          />
        ))}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-[var(--bui-ink-3)]">
        {elapsed}
      </span>
    </div>
  )
}

export function HiddenWorkspaceAssistantReasoning() {
  return null
}

// 流式期间 run 尚未完成,不会进入 RunTraceGroup,所以「思考中」状态必须由本组件自己表达:
// 视觉严格复刻 Beautiful UI ThinkingState 的 Reasoning 变体——星形图标 + 运行时扫光标题,
// 展开正文以段落行挂在带动画高度的发丝线左轨上,收起/展开用 grid-rows 过渡。
export function WorkspaceAssistantReasoningPart({
  text,
  status,
}: ReasoningMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const running = status.type === 'running'
  const runningSurfaceId = useId()
  useWorkspaceAssistantRunningSurface(`reasoning:${runningSurfaceId}`, running && text.trim().length > 0)
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const previousRunning = useRef(running)
  const traceRef = useRef<HTMLDivElement>(null)
  const [lineHeight, setLineHeight] = useState(0)
  const rows = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const expanded = manualExpanded ?? running

  useEffect(() => {
    if (previousRunning.current === running) return
    previousRunning.current = running
    setManualExpanded(null)
  }, [running])

  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight)
  }, [expanded, rows.length, text])

  if (!text.trim()) return null

  return (
    <div className="flex w-full flex-col">
      {/* header — Beautiful UI ThinkingState */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? running))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-[8px] px-1.5 py-1 transition-colors duration-100 hover:bg-[var(--bui-hover-2)]"
      >
        {/* eslint-disable-next-line no-restricted-syntax -- Beautiful UI's copied star glyph, preserved exactly. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill={running ? 'var(--bui-ink-2)' : 'var(--bui-ink-3)'} aria-hidden="true">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {running ? (
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--bui-ink-3) 35%, var(--bui-ink) 50%, var(--bui-ink-3) 65%)',
              backgroundSize: '200% 100%',
              animation: 'wa-bui-shimmer 1.4s linear infinite',
            }}
          >
            {t('reasoning.running')}
          </span>
        ) : (
          <span
            className="text-[13px] font-medium whitespace-nowrap text-[var(--bui-ink-2)]"
            style={{ animation: 'wa-bui-fade-in 350ms ease-out both' }}
          >
            {t('reasoning.completed')}
          </span>
        )}
        {/* eslint-disable-next-line no-restricted-syntax -- Beautiful UI's copied chevron glyph, preserved exactly. */}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bui-ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* expandable trace */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden="true"
              className="absolute left-[3px] w-px bg-[var(--bui-line)]"
              style={{
                top: -8,
                height: lineHeight ? lineHeight - 2 : 0,
                transition: 'height 500ms cubic-bezier(0.23,1,0.32,1)',
              }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {rows.map((row, index) => (
                <div
                  key={`${String(index)}:${row.slice(0, 24)}`}
                  className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left"
                  style={{ animation: `wa-bui-fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${String(index * 120)}ms both` }}
                >
                  <span className="min-w-0 whitespace-normal text-[12.5px] leading-relaxed text-[var(--bui-ink-2)]">
                    {row}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
