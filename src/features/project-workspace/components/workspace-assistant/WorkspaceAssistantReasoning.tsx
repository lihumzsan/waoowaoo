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
import { AppIcon } from '@/components/ui/icons'
import { MarkdownTextPart } from './MarkdownTextPart'
import {
  resolveWorkspaceAssistantRunTraceView,
  WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY,
} from './workspace-assistant-run-trace'

const WorkspaceAssistantRunTraceGroupContext = createContext(false)
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

function WorkspaceAssistantReasoningDisclosure({
  running,
  failed = false,
  label,
  children,
}: {
  readonly running: boolean
  readonly failed?: boolean
  readonly label: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(running)
  const wasRunning = useRef(running)

  useEffect(() => {
    if (running) setOpen(true)
    else if (wasRunning.current) setOpen(false)
    wasRunning.current = running
  }, [running])

  return (
    <section className="text-sm text-[var(--glass-text-tertiary)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 py-0.5 text-left"
      >
        {running ? (
          <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : failed ? (
          <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-danger-fg)]" aria-hidden="true" />
        ) : (
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white" aria-hidden="true">
            <AppIcon name="check" className="h-2.5 w-2.5" />
          </span>
        )}
        <span className={running ? 'assistant-shimmer-text font-medium' : undefined}>{label}</span>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="mt-2 space-y-3">{children}</div> : null}
    </section>
  )
}

export function WorkspaceAssistantWaitDots() {
  return (
    <div
      className="assistant-thinking-indicator flex min-h-6 items-center text-[var(--glass-text-secondary)]"
      role="status"
      aria-live="polite"
    >
      <span className="assistant-thinking-minimal" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>

      <style>{`
        .assistant-thinking-minimal {
          display: inline-flex;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          gap: 5px;
          width: 25px;
        }

        .assistant-thinking-minimal span {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: currentColor;
          animation: assistant-thinking-minimal-pulse 1.2s ease-in-out infinite;
        }

        .assistant-thinking-minimal span:nth-child(2) {
          animation-delay: 160ms;
        }

        .assistant-thinking-minimal span:nth-child(3) {
          animation-delay: 320ms;
        }

        @keyframes assistant-thinking-minimal-pulse {
          0%, 72%, 100% {
            opacity: 0.32;
            transform: scale(0.82);
          }
          36% {
            opacity: 1;
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
  )
}

export function HiddenWorkspaceAssistantReasoning() {
  return null
}

// 流式期间 run 尚未完成,不会进入 RunTraceGroup,所以「思考中」状态必须由本组件自己表达:
// 运行时标题扫光并展开正文,结束后自动折叠成一行,正文用缩进和次级文字颜色与助手正文区分。
export function WorkspaceAssistantReasoningPart({
  text,
  status,
}: ReasoningMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const inRunTraceGroup = useContext(WorkspaceAssistantRunTraceGroupContext)
  const running = status.type === 'running'
  const runningSurfaceId = useId()
  useWorkspaceAssistantRunningSurface(`reasoning:${runningSurfaceId}`, running && text.trim().length > 0)
  const [open, setOpen] = useState(running)
  const [touched, setTouched] = useState(false)
  const previousRunning = useRef(running)

  useEffect(() => {
    if (previousRunning.current === running) return
    previousRunning.current = running
    if (!touched) setOpen(running)
  }, [running, touched])

  if (!text.trim()) return null

  const content = (
    <div className="pl-3 leading-6 text-[var(--glass-text-secondary)]">
      <MarkdownTextPart text={text} status={status} />
    </div>
  )

  if (inRunTraceGroup) return content

  return (
    <section className="text-sm text-[var(--glass-text-tertiary)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setTouched(true)
          setOpen((current) => !current)
        }}
        className="flex w-full items-center gap-2 py-0.5 text-left"
      >
        {running ? (
          <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : null}
        <span className={`text-xs font-medium ${running ? 'assistant-shimmer-text' : ''}`}>
          {running ? t('reasoning.running') : t('reasoning.completed')}
        </span>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="mt-1">{content}</div>
      ) : null}
    </section>
  )
}

export function WorkspaceAssistantRunTraceGroup({
  groupKey,
  children,
}: {
  readonly groupKey: string | undefined
  readonly indices: number[]
  readonly children?: ReactNode
}) {
  const t = useTranslations('assistantAgent')
  const toolCallCount = useMessage((state) => (
    resolveWorkspaceAssistantRunTraceView(state.content).visibleToolCallCount
  ))
  const runStatus = useMessage((state) => (
    resolveWorkspaceAssistantRunTraceView(state.content).runStatus
  ))

  if (groupKey !== WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY) return <>{children}</>

  const failed = runStatus === 'failed' || runStatus === 'cancelled'
  const label = toolCallCount > 0
    ? t(
        runStatus === 'running'
          ? 'reasoning.executionRunning'
          : failed
            ? 'reasoning.executionFailed'
            : 'reasoning.executionCompleted',
        { count: toolCallCount },
      )
    : failed
      ? t('reasoning.failed')
      : t('reasoning.completed')

  return (
    <WorkspaceAssistantReasoningDisclosure
      running={runStatus === 'running'}
      failed={failed}
      label={label}
    >
      <WorkspaceAssistantRunTraceGroupContext.Provider value>
        <div className="space-y-3">
          {children}
        </div>
      </WorkspaceAssistantRunTraceGroupContext.Provider>
    </WorkspaceAssistantReasoningDisclosure>
  )
}
