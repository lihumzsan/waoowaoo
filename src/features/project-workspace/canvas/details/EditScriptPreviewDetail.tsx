'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import type { WorkspaceCanvasEditScriptDetails } from '../node-canvas-types'

interface EditScriptPreviewDetailProps {
  readonly details: WorkspaceCanvasEditScriptDetails
  readonly onClose: () => void
}

interface PreviewShot {
  readonly shotId: string
  readonly shotNumber: number
  readonly durationSec: number
  readonly startSec: number
  readonly endSec: number
  readonly sceneName: string
  readonly action: string
  readonly characters: readonly string[]
  readonly keyObjects: readonly string[]
  readonly imagePrompt: string | null
  readonly sound: string
  readonly imageUrl: string | null
  readonly videoUrl: string | null
}

function DetailSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{title}</h3>
      {children}
    </section>
  )
}

export type PreviewShotMediaKind = 'video' | 'image' | 'text' | 'empty'

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(1))}s`
}

export function previewShotMediaKind(
  shot: (Partial<PreviewShot> & Pick<PreviewShot, 'action'>) | null,
): PreviewShotMediaKind {
  if (!shot) return 'empty'
  if (shot.videoUrl) return 'video'
  if (shot.imageUrl) return 'image'
  return shot.action.trim() ? 'text' : 'empty'
}

export function initialPreviewDetailsExpanded(): boolean {
  return true
}

function findActiveShot(shots: readonly PreviewShot[], elapsedSec: number): PreviewShot | null {
  if (shots.length === 0) return null
  const matched = shots.find((shot) => elapsedSec >= shot.startSec && elapsedSec < shot.endSec)
  return matched ?? shots[shots.length - 1] ?? null
}

function buildPreviewShots(details: WorkspaceCanvasEditScriptDetails): readonly PreviewShot[] {
  let cursor = 0
  return details.shots.map((shot) => {
    const startSec = cursor
    cursor += shot.durationSec
    return {
      shotId: shot.shotId,
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      startSec,
      endSec: cursor,
      sceneName: shot.sceneName,
      action: shot.action,
      characters: shot.characters,
      keyObjects: shot.keyObjects,
      imagePrompt: shot.imagePrompt ?? null,
      sound: shot.sound,
      imageUrl: shot.imageUrl ?? null,
      videoUrl: shot.videoUrl ?? null,
    }
  })
}

export default function EditScriptPreviewDetail({
  details,
  onClose,
}: EditScriptPreviewDetailProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.detail')
  const shots = useMemo(() => buildPreviewShots(details), [details])
  const totalDurationSec = shots.reduce((total, shot) => total + shot.durationSec, 0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(initialPreviewDetailsExpanded)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const activeShot = findActiveShot(shots, elapsedSec)
  const activeShotMediaKind = previewShotMediaKind(activeShot)
  const progressPercent = totalDurationSec > 0 ? Math.min(100, Math.max(0, (elapsedSec / totalDurationSec) * 100)) : 0

  useEffect(() => {
    if (!playing || totalDurationSec <= 0) return undefined
    const interval = window.setInterval(() => {
      setElapsedSec((current) => {
        const next = current + 0.1
        return next >= totalDurationSec ? totalDurationSec : next
      })
    }, 100)
    return () => window.clearInterval(interval)
  }, [playing, totalDurationSec])

  useEffect(() => {
    if (playing && totalDurationSec > 0 && elapsedSec >= totalDurationSec) {
      setPlaying(false)
    }
  }, [elapsedSec, playing, totalDurationSec])

  useEffect(() => {
    setElapsedSec(0)
    setPlaying(false)
    setDetailsExpanded(initialPreviewDetailsExpanded())
  }, [details])

  const togglePlayback = () => {
    if (totalDurationSec <= 0) return
    if (elapsedSec >= totalDurationSec) setElapsedSec(0)
    setPlaying((current) => !current)
  }

  const selectShot = (shot: PreviewShot) => {
    setElapsedSec(shot.startSec)
    setPlaying(false)
  }

  const modal = (
    <div
      className="fixed inset-0 z-[120] bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('sections.editScriptPreview')}
      onMouseDown={onClose}
    >
      <div
        className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.28)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--glass-text-tertiary)]">
              {t('sections.editScriptPreview')}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-[var(--glass-text-primary)]">
              {t('labels.editScriptPreviewTitle')}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white p-2 text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
            aria-label={t('actions.close')}
            onClick={onClose}
          >
            <AppIcon name="closeMd" className="h-4 w-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5">
          <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/5 bg-[#f8fafc] p-4">
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(280px,0.95fr)_minmax(280px,1.05fr)]">
              <div className="flex min-h-0 flex-col gap-3">
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
                  <div className="flex h-[calc(100%-58px)] min-h-[220px] items-center justify-center bg-black">
                    {activeShotMediaKind === 'video' && activeShot?.videoUrl ? (
                      <video
                        key={activeShot.videoUrl}
                        src={toDisplayImageUrl(activeShot.videoUrl) ?? activeShot.videoUrl}
                        controls
                        preload="metadata"
                        className="h-full w-full object-contain"
                      />
                    ) : activeShotMediaKind === 'image' && activeShot?.imageUrl ? (
                      <button
                        type="button"
                        className="h-full w-full cursor-zoom-in border-0 bg-transparent p-0"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          setPreviewImageUrl(activeShot.imageUrl)
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={toDisplayImageUrl(activeShot.imageUrl) ?? activeShot.imageUrl}
                          alt={t('labels.previewShotAlt', { number: activeShot.shotNumber })}
                          className="h-full w-full object-contain"
                        />
                      </button>
                    ) : activeShotMediaKind === 'text' && activeShot ? (
                      <div className="flex h-full w-full items-center justify-center px-8 text-center">
                        <div className="max-w-2xl space-y-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                            {t('empty.noPreviewMedia')}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-lg font-semibold leading-8 text-slate-100">
                            {activeShot.action}
                          </p>
                          <p className="text-sm leading-6 text-slate-400">{activeShot.sceneName}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                        <AppIcon name="clapperboard" className="h-8 w-8" />
                        <span className="text-xs font-semibold">{t('empty.noPreviewShot')}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 border-t border-white/10 bg-slate-900 px-3 py-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
                      <span>{formatSeconds(elapsedSec)} / {formatSeconds(totalDurationSec)}</span>
                      <span>{activeShot ? t('labels.previewShot', { number: activeShot.shotNumber }) : t('empty.noPreviewShot')}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={shots.length === 0}
                  onClick={togglePlayback}
                >
                  <AppIcon name={playing ? 'pause' : 'play'} className="h-4 w-4" />
                  {playing ? t('actions.pausePreview') : t('actions.playPreview')}
                </button>
              </div>

              <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
                <div className="grid shrink-0 grid-cols-3 gap-2">
                  <div className="min-w-0 rounded-md bg-white p-3 text-sm">
                    <p className="break-words text-xs font-semibold uppercase text-[var(--glass-text-tertiary)]">{t('fields.duration')}</p>
                    <p className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatSeconds(totalDurationSec)}</p>
                  </div>
                  <div className="min-w-0 rounded-md bg-white p-3 text-sm">
                    <p className="break-words text-xs font-semibold uppercase text-[var(--glass-text-tertiary)]">{t('fields.shotCount')}</p>
                    <p className="mt-1 font-semibold text-[var(--glass-text-primary)]">{shots.length}</p>
                  </div>
                  <div className="min-w-0 rounded-md bg-white p-3 text-sm">
                    <p className="break-words text-xs font-semibold uppercase text-[var(--glass-text-tertiary)]">{t('fields.currentShot')}</p>
                    <p className="mt-1 font-semibold text-[var(--glass-text-primary)]">{activeShot?.shotNumber ?? '-'}</p>
                  </div>
                </div>

                {activeShot ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex shrink-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase text-[var(--glass-text-tertiary)]">
                          {t('labels.previewShot', { number: activeShot.shotNumber })}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--glass-text-primary)]">
                          {formatSeconds(activeShot.startSec)} - {formatSeconds(activeShot.endSec)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[var(--glass-text-secondary)]">
                        {formatSeconds(activeShot.durationSec)}
                      </span>
                    </div>
                    <PromptBlock title={t('fields.action')} value={activeShot.action} emptyText={t('empty.noPreviewShot')} />
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
                      onClick={() => setDetailsExpanded((current) => !current)}
                    >
                      <AppIcon name={detailsExpanded ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                      {detailsExpanded ? t('actions.collapsePreviewDetails') : t('actions.expandPreviewDetails')}
                    </button>
                    {detailsExpanded ? (
                      <div
                        className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2"
                        {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
                      >
                        <div className="grid gap-3 md:grid-cols-2">
                          <PromptBlock title={t('fields.imagePrompt')} value={activeShot.imagePrompt} emptyText={t('empty.noImagePrompt')} />
                          <PromptBlock title={t('fields.scene')} value={activeShot.sceneName} emptyText={t('empty.noPreviewShot')} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <PromptBlock title={t('fields.characters')} value={activeShot.characters.join('\n')} emptyText={t('empty.noPreviewShot')} />
                          <PromptBlock title={t('fields.keyObjects')} value={activeShot.keyObjects.join('\n')} emptyText={t('empty.noPreviewShot')} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <PromptBlock title={t('fields.sound')} value={activeShot.sound} emptyText={t('empty.noPreviewShot')} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <div className="shrink-0">
            <DetailSection title={t('sections.editScriptTimeline')}>
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
              >
                {shots.map((shot) => {
                  const active = activeShot?.shotId === shot.shotId
                  return (
                    <button
                      key={shot.shotId}
                      type="button"
                      className={`min-w-[180px] rounded-lg border bg-white p-3 text-left transition ${active ? 'border-slate-950 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}
                      onClick={() => selectShot(shot)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('labels.previewShot', { number: shot.shotNumber })}</span>
                        <span className="text-xs text-[var(--glass-text-tertiary)]">{formatSeconds(shot.durationSec)}</span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--glass-text-secondary)]">{shot.action}</p>
                      <div className="mt-3 h-1 rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${active ? 'bg-slate-950' : 'bg-slate-300'}`} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </DetailSection>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return (
    <>
      {createPortal(modal, document.body)}
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </>
  )
}

function PromptBlock({
  title,
  value,
  emptyText,
}: {
  readonly title: string
  readonly value: string | null
  readonly emptyText: string
}) {
  const displayValue = value?.trim()
  return (
    <section className="space-y-1.5 rounded-md bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-[var(--glass-text-tertiary)]">{title}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--glass-text-secondary)]">
        {displayValue || <span className="text-[var(--glass-text-tertiary)]">{emptyText}</span>}
      </p>
    </section>
  )
}
