'use client'

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import { submitFromEnterKey } from '@/lib/ui/keyboard-submit'

interface WorkspaceAssistantComposerProps {
  readonly value: string
  readonly error: string | null
  readonly pending: boolean
  readonly assistantPermissionMode: AssistantPermissionMode
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onAssistantPermissionModeChange: (mode: AssistantPermissionMode) => void
}

const PERMISSION_MENU_WIDTH = 320
const PERMISSION_MENU_GAP = 6
const PERMISSION_MODES: readonly AssistantPermissionMode[] = ['ask', 'auto']

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ')
}

/**
 * Maps raw send-failure payloads (API error JSON, transport errors) to a
 * user-readable explanation. A failed send must be unmissable: the user's
 * message bubble stays in the thread without a reply, so a silent or truncated
 * error reads as "the assistant died".
 */
function resolveComposerErrorMessageKey(error: string): 'panel.sendErrorBusy' | 'panel.sendErrorGeneric' {
  return error.includes('PROJECT_AGENT_RUN_ACTIVE')
    ? 'panel.sendErrorBusy'
    : 'panel.sendErrorGeneric'
}

export function WorkspaceAssistantComposer({
  value,
  error,
  pending,
  assistantPermissionMode,
  onChange,
  onSubmit,
  onAssistantPermissionModeChange,
}: WorkspaceAssistantComposerProps) {
  const t = useTranslations('assistantAgent')
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const permissionModeLabel = t(`panel.permissionMode${assistantPermissionMode === 'ask' ? 'Ask' : 'Auto'}`)

  const updateMenuPlacement = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const left = Math.max(8, Math.min(rect.left, viewportWidth - PERMISSION_MENU_WIDTH - 8))

    setMenuStyle({
      position: 'fixed',
      left,
      bottom: viewportHeight - rect.top + PERMISSION_MENU_GAP,
      width: PERMISSION_MENU_WIDTH,
    })
  }, [])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
  }, [])

  const openMenu = useCallback(() => {
    updateMenuPlacement()
    setMenuOpen(true)
  }, [updateMenuPlacement])

  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenu, menuOpen])

  useLayoutEffect(() => {
    if (!menuOpen) return
    updateMenuPlacement()
    window.addEventListener('resize', updateMenuPlacement)
    window.addEventListener('scroll', updateMenuPlacement, true)
    return () => {
      window.removeEventListener('resize', updateMenuPlacement)
      window.removeEventListener('scroll', updateMenuPlacement, true)
    }
  }, [menuOpen, updateMenuPlacement])

  const selectPermissionMode = (mode: AssistantPermissionMode) => {
    if (mode !== assistantPermissionMode) {
      onAssistantPermissionModeChange(mode)
    }
    closeMenu()
  }

  return (
    <div>
      <div className="flex flex-col rounded-[14px] px-3.5 pb-2 pt-2">
        <textarea
          rows={2}
          value={value}
          disabled={pending}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('panel.composerPlaceholder')}
          onKeyDown={(event) => {
            submitFromEnterKey(event, () => { void onSubmit() })
          }}
          className="min-h-10 max-h-[7rem] w-full resize-none overflow-y-auto bg-transparent pr-1 text-sm leading-5 text-[var(--glass-text-primary)] outline-none [field-sizing:content] placeholder:text-[var(--glass-text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-1 flex h-8 shrink-0 items-center justify-between gap-2">
          <button
            ref={triggerRef}
            type="button"
            aria-label={t('panel.permissionModeToggle', { mode: permissionModeLabel })}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuOpen ? menuId : undefined}
            title={t('panel.permissionModeMenuTitle')}
            onClick={() => {
              if (menuOpen) closeMenu()
              else openMenu()
            }}
            className="glass-selection-control inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none"
          >
            <AppIcon name={assistantPermissionMode === 'ask' ? 'lock' : 'bolt'} className="h-3 w-3" aria-hidden="true" />
            <span>{permissionModeLabel}</span>
            <AppIcon name="chevronDown" className={cx('h-3 w-3 text-[var(--glass-text-tertiary)] transition-transform', menuOpen && 'rotate-180')} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('panel.send')}
            disabled={!value.trim() || pending}
            onClick={() => { void onSubmit() }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[var(--glass-text-primary)] text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AppIcon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="glass-surface-modal z-[9999] rounded-xl border border-[var(--glass-stroke-base)] p-2 shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
          style={menuStyle}
        >
          <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-[var(--glass-text-tertiary)]">
            {t('panel.permissionModeMenuTitle')}
          </div>
          {PERMISSION_MODES.map((mode) => {
            const selected = assistantPermissionMode === mode
            const suffix = mode === 'ask' ? 'Ask' : 'Auto'
            return (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => selectPermissionMode(mode)}
                className={cx(
                  'glass-selection-control group flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left',
                  selected
                    ? 'bg-[var(--glass-bg-surface-strong)] text-[var(--glass-text-primary)]'
                    : 'text-[var(--glass-text-secondary)]',
                )}
              >
                <AppIcon name={mode === 'ask' ? 'lock' : 'bolt'} className="mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold leading-4">{t(`panel.permissionMode${suffix}`)}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-[var(--glass-text-tertiary)]">
                    {t(`panel.permissionModeDescription${suffix}`)}
                  </span>
                </span>
                {selected ? <AppIcon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
      {error ? (
        <div
          role="alert"
          className="mt-1.5 rounded-lg bg-[var(--glass-tone-danger-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-danger-fg)]"
        >
          <p className="font-medium">{t(resolveComposerErrorMessageKey(error))}</p>
          <p className="mt-0.5 break-all text-[11px] leading-4 opacity-75">{error}</p>
        </div>
      ) : null}
    </div>
  )
}
