'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { readProjectEditScriptRequestErrorCode } from '@/lib/query/project-edit-script-error'
import type { ProjectEditScript, ProjectPanel, ProjectStoryboard } from '@/types/project'
import { workspaceCanvasScrollableRegionProps } from './canvas-scroll-lock'

const MAX_SEGMENT_DURATION_SEC = 15
const MAX_SEGMENT_SHOT_COUNT = 9

type BoundaryMoveDirection = 'left' | 'right'

interface ArrangementSegmentDraft {
  readonly id: string
  readonly shotNumbers: readonly number[]
  readonly continuity: string
}

interface ShotViewModel {
  readonly shotNumber: number
  readonly durationSec: number
  readonly title: string
  readonly description: string
  readonly imageUrl: string | null
}

interface GenerationSegmentArrangementModalProps {
  readonly editScript: ProjectEditScript
  readonly storyboards: readonly ProjectStoryboard[]
  readonly initialSegmentIndex: number
  readonly onClose: () => void
  readonly onSubmit: (segments: readonly { readonly shotNumbers: readonly number[]; readonly continuity: string }[]) => Promise<void>
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

function buildInitialDraftSegments(editScript: ProjectEditScript): readonly ArrangementSegmentDraft[] {
  return editScript.generationSegments.map((segment, index) => ({
    id: `segment:${index}:${segment.shotNumbers.join(',')}`,
    shotNumbers: [...segment.shotNumbers],
    continuity: segment.continuity,
  }))
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function durationForSegment(segment: ArrangementSegmentDraft, durationByShotNumber: ReadonlyMap<number, number>): number {
  return segment.shotNumbers.reduce((total, shotNumber) => total + (durationByShotNumber.get(shotNumber) ?? 0), 0)
}

function targetSegmentIndex(segmentIndex: number, direction: BoundaryMoveDirection): number {
  return direction === 'left' ? segmentIndex - 1 : segmentIndex + 1
}

function boundaryShotNumber(segment: ArrangementSegmentDraft, direction: BoundaryMoveDirection): number | null {
  if (segment.shotNumbers.length === 0) return null
  return direction === 'left'
    ? segment.shotNumbers[0] ?? null
    : segment.shotNumbers[segment.shotNumbers.length - 1] ?? null
}

function canMoveBoundaryShot(input: {
  readonly segments: readonly ArrangementSegmentDraft[]
  readonly segmentIndex: number
  readonly direction: BoundaryMoveDirection
  readonly durationByShotNumber: ReadonlyMap<number, number>
}): boolean {
  const sourceSegment = input.segments[input.segmentIndex]
  if (!sourceSegment || sourceSegment.shotNumbers.length === 0) return false

  const targetIndex = targetSegmentIndex(input.segmentIndex, input.direction)
  const targetSegment = input.segments[targetIndex]
  if (!targetSegment || targetSegment.shotNumbers.length >= MAX_SEGMENT_SHOT_COUNT) return false

  const shotNumber = boundaryShotNumber(sourceSegment, input.direction)
  if (shotNumber === null) return false

  const nextTargetDuration = durationForSegment(targetSegment, input.durationByShotNumber)
    + (input.durationByShotNumber.get(shotNumber) ?? 0)
  return nextTargetDuration <= MAX_SEGMENT_DURATION_SEC
}

function moveBoundaryShot(input: {
  readonly segments: readonly ArrangementSegmentDraft[]
  readonly segmentIndex: number
  readonly direction: BoundaryMoveDirection
  readonly durationByShotNumber: ReadonlyMap<number, number>
}): readonly ArrangementSegmentDraft[] {
  const sourceSegment = input.segments[input.segmentIndex]
  if (!sourceSegment) return input.segments
  const shotNumber = boundaryShotNumber(sourceSegment, input.direction)
  if (shotNumber === null || !canMoveBoundaryShot(input)) return input.segments

  const targetIndex = targetSegmentIndex(input.segmentIndex, input.direction)
  return input.segments.map((segment, index) => {
    if (index === input.segmentIndex) {
      return {
        ...segment,
        shotNumbers: input.direction === 'left'
          ? segment.shotNumbers.slice(1)
          : segment.shotNumbers.slice(0, -1),
      }
    }
    if (index === targetIndex) {
      return {
        ...segment,
        shotNumbers: input.direction === 'left'
          ? [...segment.shotNumbers, shotNumber]
          : [shotNumber, ...segment.shotNumbers],
      }
    }
    return segment
  }).filter((segment) => segment.shotNumbers.length > 0)
}

function clampSegmentIndex(index: number, segmentCount: number): number {
  if (segmentCount <= 0) return 0
  return Math.min(Math.max(index, 0), segmentCount - 1)
}

function arrangementSubmitErrorMessage(
  error: unknown,
  translate: ReturnType<typeof useTranslations>,
): string {
  const code = readProjectEditScriptRequestErrorCode(error)
  if (code === 'EDIT_SCRIPT_GENERATION_SEGMENT_LOCKED_BY_RUNNING_VIDEO') {
    return translate('runningVideoGroup')
  }
  if (code === 'EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID' || code === 'EDIT_SCRIPT_GENERATION_SEGMENT_NOT_CONTINUOUS') {
    return translate('orderInvalid')
  }
  if (code === 'EDIT_SCRIPT_GENERATION_SEGMENT_COVERAGE_INVALID') {
    return translate('durationExceeded')
  }
  if (code === 'EDIT_SCRIPT_GENERATION_SEGMENT_DURATION_EXCEEDED') {
    return translate('durationExceeded')
  }
  return error instanceof Error ? error.message : translate('submitFailed')
}

export default function GenerationSegmentArrangementModal({
  editScript,
  storyboards,
  initialSegmentIndex,
  onClose,
  onSubmit,
}: GenerationSegmentArrangementModalProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.generationSegmentArrangement')
  const [draftSegments, setDraftSegments] = useState<readonly ArrangementSegmentDraft[]>(() => buildInitialDraftSegments(editScript))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  useEffect(() => {
    setDraftSegments(buildInitialDraftSegments(editScript))
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
        description: panel?.description?.trim() || shot.action,
        imageUrl: rawImageUrl ? toDisplayImageUrl(rawImageUrl) ?? rawImageUrl : null,
      })
    })
    return views
  }, [editScript.shots, panelByShotNumber, t])

  const focusedSegmentIndex = useMemo(
    () => clampSegmentIndex(initialSegmentIndex, draftSegments.length),
    [draftSegments.length, initialSegmentIndex],
  )

  const visibleSegmentIndexes = useMemo(() => {
    const startIndex = Math.max(0, focusedSegmentIndex - 1)
    const endIndex = Math.min(draftSegments.length - 1, focusedSegmentIndex + 1)
    const indexes: number[] = []
    for (let index = startIndex; index <= endIndex; index += 1) indexes.push(index)
    return indexes
  }, [draftSegments.length, focusedSegmentIndex])

  const visibleShotCount = useMemo(() => (
    visibleSegmentIndexes.reduce((total, segmentIndex) => total + (draftSegments[segmentIndex]?.shotNumbers.length ?? 0), 0)
  ), [draftSegments, visibleSegmentIndexes])

  const invalidSegmentIndexes = useMemo(() => {
    const invalid = new Set<number>()
    draftSegments.forEach((segment, index) => {
      const durationSec = durationForSegment(segment, durationByShotNumber)
      if (durationSec > MAX_SEGMENT_DURATION_SEC || segment.shotNumbers.length > MAX_SEGMENT_SHOT_COUNT) invalid.add(index)
    })
    return invalid
  }, [draftSegments, durationByShotNumber])

  const hasChanges = useMemo(() => {
    if (draftSegments.length !== editScript.generationSegments.length) return true
    return draftSegments.some((segment, index) => {
      const sourceSegment = editScript.generationSegments[index]
      return !sameShotNumbers(segment.shotNumbers, sourceSegment?.shotNumbers ?? [])
        || segment.continuity !== (sourceSegment?.continuity ?? '')
    })
  }, [draftSegments, editScript.generationSegments])

  const canSubmit = hasChanges && invalidSegmentIndexes.size === 0 && !isSubmitting

  const moveShot = useCallback((segmentIndex: number, direction: BoundaryMoveDirection) => {
    setDraftSegments((current) => moveBoundaryShot({
      segments: current,
      segmentIndex,
      direction,
      durationByShotNumber,
    }))
    setErrorMessage(null)
  }, [durationByShotNumber])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    setErrorMessage(null)
    try {
      await onSubmit(draftSegments.map((segment) => ({
        shotNumbers: segment.shotNumbers,
        continuity: segment.continuity,
      })))
    } catch (error: unknown) {
      setErrorMessage(arrangementSubmitErrorMessage(error, t))
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, draftSegments, onSubmit, t])

  const modal = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={t('close')} onClick={onClose} />
      <section className="relative flex h-[min(820px,92vh)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">{t('title')}</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {t('localSummary', { blocks: visibleSegmentIndexes.length, shots: visibleShotCount })}
            </p>
          </div>
          <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50" onClick={onClose} aria-label={t('close')}>
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 p-5 app-scrollbar"
          {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {visibleSegmentIndexes.map((segmentIndex) => {
              const segment = draftSegments[segmentIndex]
              if (!segment) return null
              const durationSec = durationForSegment(segment, durationByShotNumber)
              const invalid = invalidSegmentIndexes.has(segmentIndex)
              const isFocused = segmentIndex === focusedSegmentIndex
              return (
                <article
                  key={segment.id}
                  className={`flex min-h-[480px] flex-col rounded-[18px] border bg-white shadow-sm ${invalid ? 'border-red-300 ring-2 ring-red-100' : isFocused ? 'border-sky-300 ring-2 ring-sky-100' : 'border-slate-200'}`}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-950">{t('blockTitle', { block: segmentIndex + 1 })}</h3>
                        {isFocused ? (
                          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{t('currentBlock')}</span>
                        ) : null}
                      </div>
                      <p className={`mt-1 text-xs font-medium ${invalid ? 'text-red-600' : 'text-slate-500'}`}>
                        {t('blockMeta', { shots: segment.shotNumbers.length, duration: Number(durationSec.toFixed(1)) })}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${invalid ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {durationSec > MAX_SEGMENT_DURATION_SEC ? t('overLimit') : t('durationShort', { duration: Number(durationSec.toFixed(1)) })}
                    </span>
                  </div>

                  <div
                    className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 app-scrollbar"
                    {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
                  >
                    {segment.shotNumbers.map((shotNumber, shotIndex) => {
                      const shot = shotViewByNumber.get(shotNumber)
                      const isFirstShot = shotIndex === 0
                      const isLastShot = shotIndex === segment.shotNumbers.length - 1
                      const canMoveLeft = isFirstShot && canMoveBoundaryShot({
                        segments: draftSegments,
                        segmentIndex,
                        direction: 'left',
                        durationByShotNumber,
                      })
                      const canMoveRight = isLastShot && canMoveBoundaryShot({
                        segments: draftSegments,
                        segmentIndex,
                        direction: 'right',
                        durationByShotNumber,
                      })
                      return (
                        <div key={`${segment.id}:${shotNumber}`} className="relative overflow-hidden rounded-[12px] border border-slate-200 bg-white shadow-sm">
                          <div className="relative aspect-video bg-slate-100">
                            {shot?.imageUrl ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in border-0 bg-transparent p-0"
                                onClick={() => setPreviewImageUrl(shot.imageUrl)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={shot.imageUrl} alt={shot.title} className="h-full w-full object-cover" />
                              </button>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-semibold text-slate-400">
                                {t('shotFallback', { shot: shotNumber })}
                              </div>
                            )}
                            {isFirstShot && segmentIndex > 0 ? (
                              <button
                                type="button"
                                className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
                                aria-label={t('moveLeftShot', { shot: shotNumber })}
                                title={canMoveLeft ? t('moveLeftShot', { shot: shotNumber }) : t('moveUnavailable')}
                                disabled={!canMoveLeft}
                                onClick={() => moveShot(segmentIndex, 'left')}
                              >
                                <AppIcon name="chevronLeft" className="h-4 w-4" />
                              </button>
                            ) : null}
                            {isLastShot && segmentIndex < draftSegments.length - 1 ? (
                              <button
                                type="button"
                                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
                                aria-label={t('moveRightShot', { shot: shotNumber })}
                                title={canMoveRight ? t('moveRightShot', { shot: shotNumber }) : t('moveUnavailable')}
                                disabled={!canMoveRight}
                                onClick={() => moveShot(segmentIndex, 'right')}
                              >
                                <AppIcon name="chevronRight" className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                          <div className="min-w-0 p-2">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-slate-950">{shot?.title ?? t('shotTitle', { shot: shotNumber })}</span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                {t('durationShort', { duration: shot?.durationSec ?? 0 })}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{shot?.description ?? ''}</p>
                          </div>
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
            ) : invalidSegmentIndexes.size > 0 ? (
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
