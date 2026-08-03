'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
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

const FRAME_WIDTH = 340
const COMPOSE_PANEL_WIDTH = 480

/**
 * In-place creation, two steps at the double-clicked position:
 * 1. a compact type chooser (capabilities come from the server catalog);
 * 2. after picking a type, a placeholder media frame with a compose panel
 *    below it — the panel reuses the selected-card details panel shell.
 * The draft is pure UI state; nothing persists until the create Operation is
 * confirmed or an upload lands, and refreshing discards it when unsubmitted.
 */
export function WorkspaceCanvasCreateDock({
  position,
  capabilities,
  loading,
  loadFailed,
  projectAspectRatio,
  dismissible,
  onRetryCapabilities,
  onSubmit,
  onUpload,
  onClose,
}: {
  readonly position: { readonly x: number; readonly y: number }
  readonly capabilities: readonly WorkspaceCanvasCreateCapabilityView[]
  readonly loading: boolean
  readonly loadFailed: boolean
  readonly projectAspectRatio: string | null
  readonly dismissible: boolean
  readonly onRetryCapabilities: () => void
  readonly onSubmit: (request: WorkspaceCanvasCreateRequest) => void
  readonly onUpload: () => void
  readonly onClose: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.create')
  const [selectedKind, setSelectedKind] = useState<WorkspaceCanvasCreateCapabilityView['mediaKind'] | null>(null)
  const capability = useMemo(
    () => (selectedKind
      ? capabilities.find((candidate) => candidate.mediaKind === selectedKind) ?? null
      : null),
    [capabilities, selectedKind],
  )
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [countText, setCountText] = useState('')
  const [durationText, setDurationText] = useState('')
  const [voicePreviewText, setVoicePreviewText] = useState('')
  const dockRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dismissible) return
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || dockRef.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('pointerdown', closeOnOutsidePointerDown, true)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true)
  }, [dismissible, onClose])

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !dismissible) return
    event.stopPropagation()
    onClose()
  }

  if (!capability) {
    return (
      <div
        ref={dockRef}
        className="nodrag nopan pointer-events-auto absolute"
        style={{ transform: `translate(${position.x}px, ${position.y}px)`, width: 240, zIndex: 50 }}
        onClick={(event) => event.stopPropagation()}
        onMouseDownCapture={(event) => event.stopPropagation()}
        onKeyDown={closeOnEscape}
      >
        <div className="rounded-[18px] border border-slate-200 bg-white/96 p-2 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <div className="px-2 pb-1 pt-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
              {t('chooseTitle')}
            </span>
          </div>
          {loading ? (
            <span className="flex items-center gap-2 px-2 py-2 text-xs text-[var(--glass-text-secondary)]">
              <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
              {t('loading')}
            </span>
          ) : loadFailed ? (
            <span className="flex items-center gap-2 px-2 py-2 text-xs text-[var(--glass-text-secondary)]">
              {t('loadFailed')}
              <button
                type="button"
                className="font-medium text-[var(--glass-text-primary)] underline underline-offset-2"
                onClick={onRetryCapabilities}
              >
                {t('retry')}
              </button>
            </span>
          ) : (
            <div className="space-y-0.5">
              {capabilities.map((candidate) => (
                <button
                  key={candidate.operationId}
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-sm font-medium text-[var(--glass-text-primary)] transition hover:bg-slate-100"
                  onClick={() => setSelectedKind(candidate.mediaKind)}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-slate-100 text-[var(--glass-text-secondary)]">
                    <AppIcon name={MEDIA_ICON[candidate.mediaKind]} className="h-3.5 w-3.5" />
                  </span>
                  {t(`kind.${candidate.mediaKind}`)}
                </button>
              ))}
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-sm font-medium text-[var(--glass-text-primary)] transition hover:bg-slate-100"
                onClick={onUpload}
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-slate-100 text-[var(--glass-text-secondary)]">
                  <AppIcon name="upload" className="h-3.5 w-3.5" />
                </span>
                {t('kind.upload')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const mediaKind = capability.mediaKind
  const needsDuration = mediaKind === 'video' || mediaKind === 'music'
  const needsVoicePreview = mediaKind === 'voice'
  const durationRange = capability.inputLimits.durationSeconds ?? null
  const countMin = Math.max(1, capability.alternatives.min)
  const countMax = capability.alternatives.max
  const count = countText.trim() ? Number(countText) : countMin
  const durationSeconds = durationText.trim() ? Number(durationText) : null

  const valid = prompt.trim().length > 0
    && (
      capability.inputLimits.promptMaxLength === null
      || prompt.trim().length <= capability.inputLimits.promptMaxLength
    )
    && Number.isInteger(count)
    && count >= countMin
    && count <= countMax
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
    <div
      ref={dockRef}
      className="nodrag nopan pointer-events-auto absolute"
      style={{ transform: `translate(${position.x}px, ${position.y}px)`, width: FRAME_WIDTH, zIndex: 50 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
      onKeyDown={closeOnEscape}
    >
      <div className={`flex items-center justify-center rounded-[18px] border border-dashed border-slate-300 bg-white/70 text-[var(--glass-text-tertiary)] backdrop-blur-sm ${mediaKind === 'music' || mediaKind === 'voice' ? 'h-16' : 'aspect-video'}`}>
        <span className="flex flex-col items-center gap-1.5 px-4 text-center">
          <AppIcon name={MEDIA_ICON[mediaKind]} className="h-6 w-6" />
          <span className="text-[11px]">{t('frameHint')}</span>
        </span>
      </div>

      <form
        className="mt-3 space-y-2.5 rounded-[20px] border border-slate-200 bg-white/96 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl"
        style={{ width: COMPOSE_PANEL_WIDTH, marginLeft: (FRAME_WIDTH - COMPOSE_PANEL_WIDTH) / 2 }}
        onSubmit={submit}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-[var(--glass-text-secondary)] transition hover:bg-slate-100 hover:text-[var(--glass-text-primary)]"
            onClick={() => setSelectedKind(null)}
          >
            <AppIcon name="chevronLeft" className="h-3.5 w-3.5" />
            {t('back')}
          </button>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
            <AppIcon name={MEDIA_ICON[mediaKind]} className="h-3.5 w-3.5 text-[var(--glass-text-secondary)]" />
            {t(`kind.${mediaKind}`)}
          </span>
        </div>

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={capability.inputLimits.promptMaxLength ?? undefined}
          placeholder={needsVoicePreview ? t('voiceDescriptionPlaceholder') : t('promptPlaceholder')}
          className="glass-input-base w-full resize-y px-2.5 py-2 text-sm"
          autoFocus
        />

        {needsVoicePreview ? (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={191}
              placeholder={t('namePlaceholder')}
              className="glass-input-base w-full px-2.5 py-1.5 text-xs"
            />
            <textarea
              value={voicePreviewText}
              onChange={(event) => setVoicePreviewText(event.target.value)}
              rows={2}
              maxLength={capability.inputLimits.previewTextMaxLength ?? undefined}
              placeholder={t('voicePreviewPlaceholder')}
              className="glass-input-base w-full resize-y px-2.5 py-1.5 text-xs"
            />
          </>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-[var(--glass-text-secondary)]">
          {countMax > 1 ? (
            <label className="flex items-center gap-1.5">
              <span>{t('count')}</span>
              <input
                type="number"
                min={countMin}
                max={countMax}
                step={1}
                value={countText || String(countMin)}
                onChange={(event) => setCountText(event.target.value)}
                className="glass-input-base w-14 px-2 py-1 text-xs"
                title={t('countRange', { min: countMin, max: countMax })}
              />
            </label>
          ) : null}
          {needsDuration ? (
            <label className="flex items-center gap-1.5">
              <span>{t('duration')}</span>
              <input
                type="number"
                min={durationRange?.min}
                max={durationRange?.max}
                step={1}
                value={durationText}
                onChange={(event) => setDurationText(event.target.value)}
                placeholder={t('durationPlaceholder')}
                className="glass-input-base w-16 px-2 py-1 text-xs"
                title={durationRange
                  ? t('durationRange', { min: durationRange.min, max: durationRange.max })
                  : t('durationHelp')}
              />
            </label>
          ) : null}
          {(mediaKind === 'image' || mediaKind === 'video') && projectAspectRatio ? (
            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] ring-1 ring-slate-200">
              {projectAspectRatio}
            </span>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
            onClick={onUpload}
          >
            <AppIcon name="upload" className="h-3.5 w-3.5" />
            {t('kind.upload')}
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="glass-btn-base glass-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {t('submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
