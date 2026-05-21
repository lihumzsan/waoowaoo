'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { ProjectEditScript, ProjectPanel, ProjectStoryboard } from '@/types/project'

interface ArrangementBlockDraft {
  readonly id: string
  readonly shotNumbers: readonly number[]
}

interface ShotViewModel {
  readonly shotNumber: number
  readonly durationSec: number
  readonly title: string
  readonly description: string
  readonly imageUrl: string | null
}

interface VideoBlockArrangementModalProps {
  readonly editScript: ProjectEditScript
  readonly storyboards: readonly ProjectStoryboard[]
  readonly initialBlockIndex: number
  readonly onClose: () => void
  readonly onSubmit: (blocks: readonly { readonly shotNumbers: readonly number[] }[]) => Promise<void>
}

function parseCandidateImages(value: string | null | undefined): readonly string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function primaryPanelImageUrl(panel: ProjectPanel | null): string | null {
  if (!panel) return null
  return panel.media?.url
    ?? panel.imageUrl
    ?? parseCandidateImages(panel.candidateImages).find((url) => !url.startsWith('PENDING:'))
    ?? null
}

function buildInitialDraftBlocks(editScript: ProjectEditScript): readonly ArrangementBlockDraft[] {
  return editScript.videoBlocks.map((block, index) => ({
    id: `block:${index}:${block.shotNumbers.join(',')}`,
    shotNumbers: [...block.shotNumbers],
  }))
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function moveShotInBlocks(input: {
  readonly blocks: readonly ArrangementBlockDraft[]
  readonly sourceShotNumber: number
  readonly targetShotNumber: number
  readonly placement: 'before' | 'after'
}): readonly ArrangementBlockDraft[] {
  if (input.sourceShotNumber === input.targetShotNumber) return input.blocks
  const withoutSource = input.blocks
    .map((block) => ({
      ...block,
      shotNumbers: block.shotNumbers.filter((shotNumber) => shotNumber !== input.sourceShotNumber),
    }))
    .filter((block) => block.shotNumbers.length > 0)

  let inserted = false
  const nextBlocks = withoutSource.map((block) => {
    const targetIndex = block.shotNumbers.indexOf(input.targetShotNumber)
    if (targetIndex < 0) return block
    const insertIndex = input.placement === 'before' ? targetIndex : targetIndex + 1
    inserted = true
    return {
      ...block,
      shotNumbers: [
        ...block.shotNumbers.slice(0, insertIndex),
        input.sourceShotNumber,
        ...block.shotNumbers.slice(insertIndex),
      ],
    }
  })

  return inserted ? nextBlocks : input.blocks
}

function durationForBlock(block: ArrangementBlockDraft, durationByShotNumber: ReadonlyMap<number, number>): number {
  return block.shotNumbers.reduce((total, shotNumber) => total + (durationByShotNumber.get(shotNumber) ?? 0), 0)
}

export default function VideoBlockArrangementModal({
  editScript,
  storyboards,
  initialBlockIndex,
  onClose,
  onSubmit,
}: VideoBlockArrangementModalProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.videoBlockArrangement')
  const [draftBlocks, setDraftBlocks] = useState<readonly ArrangementBlockDraft[]>(() => buildInitialDraftBlocks(editScript))
  const [selectedShotNumber, setSelectedShotNumber] = useState<number | null>(null)
  const [draggedShotNumber, setDraggedShotNumber] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setDraftBlocks(buildInitialDraftBlocks(editScript))
    setSelectedShotNumber(null)
    setDraggedShotNumber(null)
    setErrorMessage(null)
  }, [editScript])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const panelByShotNumber = useMemo(() => {
    const panels = new Map<number, ProjectPanel>()
    storyboards.forEach((storyboard) => {
      const storyboardPanels = storyboard.panels ?? []
      storyboardPanels.forEach((panel) => {
        const shotNumber = panel.panelNumber ?? panel.panelIndex + 1
        if (!panels.has(shotNumber)) panels.set(shotNumber, panel)
      })
    })
    return panels
  }, [storyboards])

  const shotByNumber = useMemo(() => new Map(editScript.shots.map((shot) => [shot.shotNumber, shot])), [editScript.shots])
  const durationByShotNumber = useMemo(() => (
    new Map(editScript.shots.map((shot) => [shot.shotNumber, shot.durationSec]))
  ), [editScript.shots])

  const shotViewByNumber = useMemo(() => {
    const views = new Map<number, ShotViewModel>()
    editScript.shots.forEach((shot) => {
      const panel = panelByShotNumber.get(shot.shotNumber) ?? null
      const rawImageUrl = primaryPanelImageUrl(panel)
      views.set(shot.shotNumber, {
        shotNumber: shot.shotNumber,
        durationSec: shot.durationSec,
        title: t('shotTitle', { shot: shot.shotNumber }),
        description: panel?.description?.trim() || shot.visualAction,
        imageUrl: rawImageUrl ? toDisplayImageUrl(rawImageUrl) ?? rawImageUrl : null,
      })
    })
    return views
  }, [editScript.shots, panelByShotNumber, t])

  const invalidBlockIndexes = useMemo(() => {
    const invalid = new Set<number>()
    draftBlocks.forEach((block, index) => {
      const durationSec = durationForBlock(block, durationByShotNumber)
      if (durationSec > 15 || block.shotNumbers.length > 9) invalid.add(index)
    })
    return invalid
  }, [draftBlocks, durationByShotNumber])

  const hasChanges = useMemo(() => {
    if (draftBlocks.length !== editScript.videoBlocks.length) return true
    return draftBlocks.some((block, index) => !sameShotNumbers(block.shotNumbers, editScript.videoBlocks[index]?.shotNumbers ?? []))
  }, [draftBlocks, editScript.videoBlocks])

  const selectedShot = selectedShotNumber ? shotByNumber.get(selectedShotNumber) ?? null : null
  const activeMovingShotNumber = draggedShotNumber ?? selectedShotNumber
  const canSubmit = hasChanges && invalidBlockIndexes.size === 0 && !isSubmitting

  const moveShot = useCallback((targetShotNumber: number, placement: 'before' | 'after') => {
    const sourceShotNumber = draggedShotNumber ?? selectedShotNumber
    if (!sourceShotNumber) return
    setDraftBlocks((current) => moveShotInBlocks({
      blocks: current,
      sourceShotNumber,
      targetShotNumber,
      placement,
    }))
    setSelectedShotNumber(sourceShotNumber)
    setDraggedShotNumber(null)
    setErrorMessage(null)
  }, [draggedShotNumber, selectedShotNumber])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>, targetShotNumber: number, placement: 'before' | 'after') => {
    event.preventDefault()
    const sourceShotNumber = Number(event.dataTransfer.getData('text/plain')) || draggedShotNumber
    if (!sourceShotNumber) return
    setDraftBlocks((current) => moveShotInBlocks({
      blocks: current,
      sourceShotNumber,
      targetShotNumber,
      placement,
    }))
    setSelectedShotNumber(sourceShotNumber)
    setDraggedShotNumber(null)
    setErrorMessage(null)
  }, [draggedShotNumber])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    setErrorMessage(null)
    try {
      await onSubmit(draftBlocks.map((block) => ({ shotNumbers: block.shotNumbers })))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('submitFailed')
      setErrorMessage(message)
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, draftBlocks, onSubmit, t])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={t('close')} onClick={onClose} />
      <section className="relative flex h-[min(820px,92vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">{t('title')}</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">{t('summary', { blocks: draftBlocks.length, shots: editScript.shots.length })}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedShot ? (
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                {t('selectedShot', { shot: selectedShot.shotNumber })}
              </span>
            ) : null}
            <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50" onClick={onClose} aria-label={t('close')}>
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-slate-50/80 p-5">
          <div className="flex h-full min-w-max items-stretch gap-4">
            {draftBlocks.map((block, blockIndex) => {
              const durationSec = durationForBlock(block, durationByShotNumber)
              const invalid = invalidBlockIndexes.has(blockIndex)
              return (
                <article
                  key={block.id}
                  className={`flex w-72 shrink-0 flex-col rounded-[18px] border bg-white shadow-sm ${invalid ? 'border-red-300 ring-2 ring-red-100' : blockIndex === initialBlockIndex ? 'border-sky-300 ring-2 ring-sky-100' : 'border-slate-200'}`}
                >
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-950">{t('blockTitle', { block: blockIndex + 1 })}</h3>
                      <p className={`mt-0.5 text-xs font-medium ${invalid ? 'text-red-600' : 'text-slate-500'}`}>
                        {t('blockMeta', { shots: block.shotNumbers.length, duration: Number(durationSec.toFixed(1)) })}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${invalid ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {durationSec > 15 ? t('overLimit') : `${durationSec}s`}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 app-scrollbar">
                    {block.shotNumbers.map((shotNumber) => {
                      const shot = shotViewByNumber.get(shotNumber)
                      const selected = selectedShotNumber === shotNumber
                      const moving = activeMovingShotNumber !== null && activeMovingShotNumber !== shotNumber
                      return (
                        <div key={`${block.id}:${shotNumber}`} className="group relative">
                          {moving ? (
                            <button
                              type="button"
                              className="absolute -left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 opacity-0 shadow-sm transition hover:border-sky-300 hover:text-sky-700 group-hover:opacity-100"
                              aria-label={t('insertBefore', { shot: shotNumber })}
                              onClick={() => moveShot(shotNumber, 'before')}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => handleDrop(event, shotNumber, 'before')}
                            >
                              <AppIcon name="chevronLeft" className="h-4 w-4" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', String(shotNumber))
                              event.dataTransfer.effectAllowed = 'move'
                              setDraggedShotNumber(shotNumber)
                              setSelectedShotNumber(shotNumber)
                            }}
                            onDragEnd={() => setDraggedShotNumber(null)}
                            onClick={() => setSelectedShotNumber((current) => current === shotNumber ? null : shotNumber)}
                            className={`flex w-full items-center gap-3 rounded-[14px] border p-2 text-left transition ${selected ? 'border-amber-300 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                          >
                            <span className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-slate-100 text-xs font-semibold text-slate-400">
                              {shot?.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={shot.imageUrl} alt={shot.title} className="h-full w-full object-cover" />
                              ) : (
                                t('shotFallback', { shot: shotNumber })
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-950">
                                <AppIcon name="gripVertical" className="h-3.5 w-3.5 text-slate-400" />
                                {shot?.title ?? t('shotTitle', { shot: shotNumber })}
                              </span>
                              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500">{shot?.description ?? ''}</span>
                            </span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                              {shot?.durationSec ?? 0}s
                            </span>
                          </button>
                          {moving ? (
                            <button
                              type="button"
                              className="absolute -right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 opacity-0 shadow-sm transition hover:border-sky-300 hover:text-sky-700 group-hover:opacity-100"
                              aria-label={t('insertAfter', { shot: shotNumber })}
                              onClick={() => moveShot(shotNumber, 'after')}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => handleDrop(event, shotNumber, 'after')}
                            >
                              <AppIcon name="chevronRight" className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-100 px-6 py-4">
          <div className="min-w-0 text-xs font-medium">
            {errorMessage ? (
              <span className="text-red-600">{errorMessage}</span>
            ) : invalidBlockIndexes.size > 0 ? (
              <span className="text-red-600">{t('invalidSummary')}</span>
            ) : hasChanges ? (
              <span className="text-slate-500">{t('changedSummary')}</span>
            ) : (
              <span className="text-slate-500">{t('unchangedSummary')}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50" onClick={onClose}>
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-[14px] bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
              onClick={handleSubmit}
            >
              {isSubmitting ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="sparkles" className="h-4 w-4" />}
              {isSubmitting ? t('submitting') : t('submit')}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
