'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  ProjectAgentPlanItem,
  ProjectAgentPlanSnapshot,
} from '@/lib/project-agent/plan'

interface PlanPopoverPosition {
  readonly bottom: number
  readonly left: number
  readonly maxHeight: number
  readonly width: number
}

function PlanStatusIcon({
  item,
  isRunActive,
}: {
  item: ProjectAgentPlanItem
  isRunActive: boolean
}) {
  if (item.status === 'completed') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--glass-text-primary)] text-white">
        <AppIcon name="check" className="h-2.5 w-2.5" aria-hidden="true" />
      </span>
    )
  }
  if (item.status === 'in_progress') {
    return (
      <span
        className={`inline-flex h-4 w-4 shrink-0 rounded-full border-2 text-[var(--glass-text-secondary)] ${
          isRunActive
            ? 'animate-spin border-current/20 border-t-current'
            : 'border-current/45'
        }`}
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 rounded-full border border-current text-[var(--glass-text-secondary)]"
      aria-hidden="true"
    />
  )
}

function resolveCurrentPlanIndex(plan: ProjectAgentPlanSnapshot): number {
  const inProgressIndex = plan.plan.findIndex((item) => item.status === 'in_progress')
  if (inProgressIndex >= 0) return inProgressIndex
  const pendingIndex = plan.plan.findIndex((item) => item.status === 'pending')
  if (pendingIndex >= 0) return pendingIndex
  return Math.max(0, plan.plan.length - 1)
}

export function WorkspaceAssistantPlanCard({
  plan,
  isRunActive,
}: {
  plan: ProjectAgentPlanSnapshot
  isRunActive: boolean
}) {
  const t = useTranslations('assistantAgent')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PlanPopoverPosition | null>(null)
  const total = plan.plan.length
  const currentIndex = resolveCurrentPlanIndex(plan)
  const currentItem = plan.plan[currentIndex]
  const completed = plan.plan.filter((item) => item.status === 'completed').length

  const clearCloseTimer = useCallback(() => {
    if (!closeTimerRef.current) return
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const updatePosition = useCallback(() => {
    const container = containerRef.current
    const trigger = triggerRef.current
    if (!container || !trigger) return
    const containerRect = container.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const viewportPadding = 12
    const width = Math.min(containerRect.width, window.innerWidth - viewportPadding * 2)
    const centeredLeft = containerRect.left + containerRect.width / 2 - width / 2
    const left = Math.min(
      Math.max(viewportPadding, centeredLeft),
      window.innerWidth - width - viewportPadding,
    )
    setPosition({
      bottom: window.innerHeight - triggerRect.top + 12,
      left,
      maxHeight: Math.max(120, triggerRect.top - 24),
      width,
    })
  }, [])

  const showPopover = useCallback(() => {
    clearCloseTimer()
    updatePosition()
    setOpen(true)
  }, [clearCloseTimer, updatePosition])

  const hidePopoverSoon = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => setOpen(false), 90)
  }, [clearCloseTimer])

  useEffect(() => {
    if (!open) return
    const handleViewportChange = () => updatePosition()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open, updatePosition])

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

  if (!currentItem || total === 0) return null

  const popover = open && position ? (
    <div
      ref={popoverRef}
      id="workspace-assistant-plan-status"
      role="tooltip"
      className="fixed z-[100] overflow-y-auto rounded-[22px] border border-[var(--glass-stroke-base)] bg-white px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
      style={{
        bottom: `${String(position.bottom)}px`,
        left: `${String(position.left)}px`,
        maxHeight: `${String(position.maxHeight)}px`,
        width: `${String(position.width)}px`,
      }}
      onMouseEnter={showPopover}
      onMouseLeave={hidePopoverSoon}
    >
      <ol className="space-y-3">
        {plan.plan.map((item, index) => (
          <li
            key={`${index}:${item.step}`}
            className="flex items-start gap-3 text-sm leading-5 text-[var(--glass-text-secondary)]"
          >
            <span className="mt-0.5">
              <PlanStatusIcon item={item} isRunActive={isRunActive} />
            </span>
            <span className={`min-w-0 flex-1 break-words ${item.status === 'completed' ? 'text-[var(--glass-text-tertiary)] line-through' : ''}`}>
              {item.step}
            </span>
          </li>
        ))}
      </ol>
    </div>
  ) : null

  return (
    <div
      ref={containerRef}
      className="pointer-events-none relative z-20 flex justify-center pb-2"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={open ? 'workspace-assistant-plan-status' : undefined}
        aria-expanded={open}
        aria-label={`${t('plan.title')} · ${t('plan.completedProgress', { completed, total })}`}
        className="pointer-events-auto inline-flex min-w-0 max-w-full items-center gap-2.5 rounded-[22px] border border-[var(--glass-stroke-base)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--glass-text-secondary)] shadow-[0_2px_10px_rgba(15,23,42,0.03)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-text-secondary)]/20"
        onMouseEnter={showPopover}
        onMouseLeave={hidePopoverSoon}
        onFocus={showPopover}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget
          if (nextTarget instanceof Node && popoverRef.current?.contains(nextTarget)) return
          hidePopoverSoon()
        }}
        onClick={() => {
          if (open) {
            setOpen(false)
          } else {
            showPopover()
          }
        }}
      >
        <PlanStatusIcon item={currentItem} isRunActive={isRunActive} />
        <span className="min-w-0 truncate">{t('plan.completedProgress', { completed, total })}</span>
      </button>
      {typeof document !== 'undefined' ? createPortal(popover, document.body) : null}
    </div>
  )
}
