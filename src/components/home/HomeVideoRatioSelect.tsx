'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon, RatioPreviewIcon } from '@/components/ui/icons'
import {
  PROJECT_VIDEO_RATIOS,
  type ProjectVideoRatio,
} from '@/lib/projects/video-ratio'

const PANEL_WIDTH = 620
const PANEL_MAX_HEIGHT = 124
const MIN_COMFORTABLE_PANEL_HEIGHT = 112
const VIEWPORT_EDGE_GAP = 16

interface HomeVideoRatioSelectProps {
  readonly value: ProjectVideoRatio
  readonly onChange: (next: ProjectVideoRatio) => void
  readonly disabled?: boolean
}

export default function HomeVideoRatioSelect({
  value,
  onChange,
  disabled = false,
}: HomeVideoRatioSelectProps) {
  const t = useTranslations('home')
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const spaceAbove = Math.max(0, rect.top - VIEWPORT_EDGE_GAP)
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - VIEWPORT_EDGE_GAP)
    const shouldOpenUpward =
      (spaceBelow < MIN_COMFORTABLE_PANEL_HEIGHT && spaceAbove > spaceBelow)
      || (spaceBelow < PANEL_MAX_HEIGHT && spaceAbove >= PANEL_MAX_HEIGHT)
    const availableSpace = shouldOpenUpward ? spaceAbove : spaceBelow
    const maxHeight = Math.max(0, Math.min(PANEL_MAX_HEIGHT, Math.floor(availableSpace)))
    const width = Math.min(PANEL_WIDTH, viewportWidth - VIEWPORT_EDGE_GAP * 2)
    const maxLeft = viewportWidth - width - VIEWPORT_EDGE_GAP
    const left = Math.max(VIEWPORT_EDGE_GAP, Math.min(rect.left, maxLeft))

    setPanelStyle({
      position: 'fixed',
      left,
      width,
      maxHeight,
      ...(shouldOpenUpward
        ? { bottom: viewportHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) return

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [isOpen, updatePlacement])

  const handleToggle = () => {
    if (disabled) return
    if (isOpen) {
      setIsOpen(false)
      return
    }
    updatePlacement()
    setIsOpen(true)
  }

  return (
    <div ref={triggerRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t('aspectRatioCurrent', { ratio: value })}
        className="flex h-10 items-center gap-2 rounded-full pl-2.5 pr-2 text-[13px] font-medium transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color: isOpen ? '#0f1117' : 'rgba(15,17,23,0.66)' }}
      >
        <RatioPreviewIcon
          ratio={value}
          size={15}
          selected={isOpen}
          variant="muted"
          fit="height"
          radiusClassName="rounded-[4px]"
        />
        {value}
        <AppIcon
          name="chevronDown"
          className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label={t('aspectRatio')}
              aria-orientation="horizontal"
              className="glass-surface-modal z-[9999] flex flex-col overflow-hidden rounded-[20px] p-1.5 shadow-[0_12px_40px_-8px_rgba(15,17,23,0.24)]"
              style={panelStyle}
            >
              <div className="px-2.5 pb-1.5 pt-2 text-[11px] font-semibold tracking-wide text-[var(--glass-text-tertiary)]">
                {t('aspectRatio')}
              </div>

              <div className="app-scrollbar flex min-h-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden pb-0.5">
                {PROJECT_VIDEO_RATIOS.map((option) => {
                  const selected = option === value
                  return (
                    <button
                      key={option}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(option)
                        setIsOpen(false)
                      }}
                      className={`relative flex min-w-[78px] flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-center transition-colors duration-200 ${
                        selected
                          ? 'bg-[color-mix(in_srgb,var(--glass-accent-from)_9%,transparent)]'
                          : 'hover:bg-[rgba(15,17,23,0.035)]'
                      }`}
                    >
                      <span className="flex h-8 w-full flex-shrink-0 items-center justify-center">
                        <RatioPreviewIcon
                          ratio={option}
                          size={32}
                          selected={selected}
                          variant="muted"
                          radiusClassName="rounded-[4px]"
                        />
                      </span>

                      <span className={`text-[13px] font-bold ${selected ? 'text-[var(--glass-tone-info-fg)]' : 'text-[var(--glass-text-primary)]'}`}>
                        {option}
                      </span>

                      {selected ? (
                        <AppIcon name="check" className="absolute right-1.5 top-1.5 h-3 w-3 text-[var(--glass-tone-info-fg)]" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
