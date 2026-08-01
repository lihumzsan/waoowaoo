'use client'

import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type {
  WorkspaceCanvasCreateCapabilityView,
  WorkspaceCanvasCreateRequest,
} from '../contracts/workspace-canvas-interactions'

const MEDIA_ICON: Readonly<Record<WorkspaceCanvasCreateCapabilityView['mediaKind'], AppIconName>> = {
  image: 'image',
  video: 'video',
  music: 'audioWave',
  voice: 'mic',
}

export interface WorkspaceCanvasCreateAnchor {
  readonly client: { readonly x: number; readonly y: number }
  readonly flow: { readonly x: number; readonly y: number }
}

export function WorkspaceCanvasCreateMenu({
  anchor,
  capabilities,
  loading,
  loadFailed,
  onRetry,
  onSelect,
  onUpload,
  onClose,
}: {
  readonly anchor: WorkspaceCanvasCreateAnchor
  readonly capabilities: readonly WorkspaceCanvasCreateCapabilityView[]
  readonly loading: boolean
  readonly loadFailed: boolean
  readonly onRetry: () => void
  readonly onSelect: (capability: WorkspaceCanvasCreateCapabilityView) => void
  readonly onUpload: () => void
  readonly onClose: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.create')
  if (typeof document === 'undefined') return null
  const left = Math.min(anchor.client.x, window.innerWidth - 232)
  const top = Math.min(anchor.client.y, window.innerHeight - 320)

  return createPortal(
    <div className="fixed inset-0 z-[110]" onMouseDown={onClose}>
      <div
        role="menu"
        aria-label={t('menuTitle')}
        className="fixed w-52 overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 p-1.5 shadow-2xl backdrop-blur-xl"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
          {t('menuTitle')}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-[var(--glass-text-secondary)]">
            <AppIcon name="loader" className="h-4 w-4 animate-spin" />
            {t('loading')}
          </div>
        ) : loadFailed ? (
          <div className="space-y-2 px-2.5 py-2 text-xs text-[var(--glass-text-secondary)]">
            <p>{t('loadFailed')}</p>
            <button
              type="button"
              className="font-medium text-[var(--glass-text-primary)] underline underline-offset-2"
              onClick={onRetry}
            >
              {t('retry')}
            </button>
          </div>
        ) : capabilities.map((capability) => (
          <button
            key={capability.operationId}
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-[var(--glass-text-primary)] hover:bg-[var(--glass-bg-hover)]"
            onClick={() => onSelect(capability)}
          >
            <AppIcon name={MEDIA_ICON[capability.mediaKind]} className="h-4 w-4 text-[var(--glass-text-tertiary)]" />
            {t(`kind.${capability.mediaKind}`)}
          </button>
        ))}
        <div className="my-1 h-px bg-[var(--glass-stroke-soft)]" />
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-[var(--glass-text-primary)] hover:bg-[var(--glass-bg-hover)]"
          onClick={onUpload}
        >
          <AppIcon name="upload" className="h-4 w-4 text-[var(--glass-text-tertiary)]" />
          {t('kind.upload')}
        </button>
      </div>
    </div>,
    document.body,
  )
}

export function WorkspaceCanvasCreateModal({
  capability,
  position,
  projectAspectRatio,
  onSubmit,
  onClose,
}: {
  readonly capability: WorkspaceCanvasCreateCapabilityView
  readonly position: WorkspaceCanvasCreateRequest['position']
  readonly projectAspectRatio: string | null
  readonly onSubmit: (request: WorkspaceCanvasCreateRequest) => void
  readonly onClose: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.create')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(Math.max(1, capability.alternatives.min))
  const [durationText, setDurationText] = useState('')
  const [voicePreviewText, setVoicePreviewText] = useState('')
  const durationSeconds = durationText.trim() ? Number(durationText) : null
  const needsDuration = capability.mediaKind === 'video' || capability.mediaKind === 'music'
  const needsVoicePreview = capability.mediaKind === 'voice'
  const durationRange = capability.inputLimits.durationSeconds
  const valid = prompt.trim().length > 0
    && (
      capability.inputLimits.promptMaxLength === null
      || prompt.trim().length <= capability.inputLimits.promptMaxLength
    )
    && count >= capability.alternatives.min
    && count <= capability.alternatives.max
    && (!needsDuration || (
      durationRange !== null
      && Number.isInteger(durationSeconds)
      && (durationSeconds ?? 0) >= durationRange.min
      && (durationSeconds ?? 0) <= durationRange.max
    ))
    && (!needsVoicePreview || (
      name.trim().length > 0
      && voicePreviewText.trim().length > 0
      && (
        capability.inputLimits.previewTextMaxLength === null
        || voicePreviewText.trim().length <= capability.inputLimits.previewTextMaxLength
      )
    ))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    onSubmit({
      capability,
      name: name.trim(),
      prompt: prompt.trim(),
      count,
      durationSeconds,
      voicePreviewText: voicePreviewText.trim(),
      position,
    })
  }

  return (
    <GlassModalShell
      open
      onClose={onClose}
      title={t('title', { kind: t(`kind.${capability.mediaKind}`) })}
      description={t('description')}
      size="sm"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="workspace-canvas-create-form" disabled={!valid} className="glass-btn-base glass-btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {t('continue')}
          </button>
        </div>
      )}
    >
      <form id="workspace-canvas-create-form" className="space-y-4" onSubmit={submit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={191}
            placeholder={t('namePlaceholder')}
            className="glass-input-base w-full px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">
            {needsVoicePreview ? t('voiceDescription') : t('prompt')}
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            maxLength={capability.inputLimits.promptMaxLength ?? undefined}
            required
            placeholder={needsVoicePreview ? t('voiceDescriptionPlaceholder') : t('promptPlaceholder')}
            className="glass-input-base w-full resize-y px-3 py-2 text-sm"
          />
        </label>
        {needsVoicePreview ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('voicePreviewText')}</span>
            <textarea
              value={voicePreviewText}
              onChange={(event) => setVoicePreviewText(event.target.value)}
              rows={3}
              maxLength={capability.inputLimits.previewTextMaxLength ?? undefined}
              required
              placeholder={t('voicePreviewPlaceholder')}
              className="glass-input-base w-full resize-y px-3 py-2 text-sm"
            />
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('count')}</span>
            <input
              type="number"
              min={capability.alternatives.min}
              max={capability.alternatives.max}
              step={1}
              value={count}
              onChange={(event) => setCount(
                Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : capability.alternatives.min,
              )}
              className="glass-input-base w-full px-3 py-2 text-sm"
            />
            <span className="block text-[10px] text-[var(--glass-text-tertiary)]">
              {t('countRange', { min: capability.alternatives.min, max: capability.alternatives.max })}
            </span>
          </label>
          {needsDuration ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('duration')}</span>
              <input
                type="number"
                min={durationRange?.min}
                max={durationRange?.max}
                step={1}
                value={durationText}
                onChange={(event) => setDurationText(event.target.value)}
                required
                placeholder={t('durationPlaceholder')}
                className="glass-input-base w-full px-3 py-2 text-sm"
              />
              <span className="block text-[10px] text-[var(--glass-text-tertiary)]">
                {durationRange
                  ? t('durationRange', { min: durationRange.min, max: durationRange.max })
                  : t('durationHelp')}
              </span>
            </label>
          ) : null}
        </div>
        {(capability.mediaKind === 'image' || capability.mediaKind === 'video') ? (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <span className="text-xs text-[var(--glass-text-secondary)]">{t('projectRatio')}</span>
            <span className="text-xs font-semibold text-[var(--glass-text-primary)]">
              {projectAspectRatio ?? t('projectRatioUnset')}
            </span>
          </div>
        ) : null}
      </form>
    </GlassModalShell>
  )
}
