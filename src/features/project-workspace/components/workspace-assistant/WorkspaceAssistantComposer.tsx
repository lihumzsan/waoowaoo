'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'

interface WorkspaceAssistantComposerProps {
  readonly value: string
  readonly error: string | null
  readonly pending: boolean
  readonly assistantPermissionMode: AssistantPermissionMode
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onAssistantPermissionModeChange: (mode: AssistantPermissionMode) => void
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
  const nextPermissionMode: AssistantPermissionMode = assistantPermissionMode === 'ask' ? 'auto' : 'ask'
  const permissionModeLabel = t(`panel.permissionMode${assistantPermissionMode === 'ask' ? 'Ask' : 'Auto'}`)

  return (
    <div className="relative">
      <textarea
        rows={1}
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('panel.composerPlaceholder')}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          void onSubmit()
        }}
        className="max-h-[5.5rem] min-h-[4.25rem] w-full resize-none overflow-y-auto rounded-[14px] bg-[var(--glass-bg-muted)] px-3.5 pb-10 pt-2 pr-12 text-sm leading-5 text-[var(--glass-text-primary)] outline-none [field-sizing:content] placeholder:text-[var(--glass-text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        aria-label={t('panel.permissionModeToggle', { mode: permissionModeLabel })}
        title={t(`panel.permissionModeDescription${assistantPermissionMode === 'ask' ? 'Ask' : 'Auto'}`)}
        onClick={() => onAssistantPermissionModeChange(nextPermissionMode)}
        className="absolute bottom-1.5 left-1.5 inline-flex h-8 items-center gap-1.5 rounded-[11px] border border-[var(--glass-stroke-base)] bg-white/90 px-2.5 text-xs font-medium text-[var(--glass-text-secondary)] transition hover:bg-white hover:text-[var(--glass-text-primary)]"
      >
        <AppIcon name={assistantPermissionMode === 'ask' ? 'lock' : 'bolt'} className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{permissionModeLabel}</span>
      </button>
      <button
        type="button"
        aria-label={t('panel.send')}
        disabled={!value.trim() || pending}
        onClick={() => { void onSubmit() }}
        className="absolute bottom-1.5 right-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[var(--glass-text-primary)] text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <AppIcon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {error ? (
        <p className="mt-1 min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
