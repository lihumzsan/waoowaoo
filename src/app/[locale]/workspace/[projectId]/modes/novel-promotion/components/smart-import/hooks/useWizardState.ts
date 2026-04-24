'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import { detectEpisodeMarkers, type EpisodeMarkerResult } from '@/lib/episode-marker-detector'
import { countWords } from '@/lib/word-count'
import {
  useListProjectEpisodes,
  useSaveProjectEpisodesBatch,
  useSplitProjectEpisodes,
  useSplitProjectEpisodesByMarkers,
} from '@/lib/query/hooks'
import type { DeleteConfirmState, SplitEpisode, WizardStage } from '../types'

type TranslateValues = Record<string, string | number | Date>
type Translate = (key: string, values?: TranslateValues) => string

interface UseWizardStateParams {
  projectId: string
  importStatus?: string | null
  onImportComplete: (episodes: SplitEpisode[], triggerGlobalAnalysis?: boolean) => void
  t: Translate
  initialRawContent?: string
}

export function useWizardState({
  projectId,
  importStatus,
  onImportComplete,
  t,
  initialRawContent,
}: UseWizardStateParams) {
  const initialStage: WizardStage = importStatus === 'pending' ? 'preview' : 'select'
  const [stage, setStage] = useState<WizardStage>(initialStage)
  const [rawContent, setRawContent] = useState(initialRawContent || '')
  const [episodes, setEpisodes] = useState<SplitEpisode[]>([])
  const [selectedEpisode, setSelectedEpisode] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
    show: false,
    index: -1,
    title: '',
  })
  const [markerResult, setMarkerResult] = useState<EpisodeMarkerResult | null>(null)
  const [showMarkerConfirm, setShowMarkerConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  const listProjectEpisodesMutation = useListProjectEpisodes(projectId)
  const splitProjectEpisodesMutation = useSplitProjectEpisodes(projectId)
  const splitProjectEpisodesByMarkersMutation = useSplitProjectEpisodesByMarkers(projectId)
  const saveProjectEpisodesBatchMutation = useSaveProjectEpisodesBatch(projectId)

  const loadSavedEpisodes = useCallback(async () => {
    try {
      const data = await listProjectEpisodesMutation.mutateAsync()
      if (data.episodes && data.episodes.length > 0) {
        const loadedEpisodes: SplitEpisode[] = data.episodes.map(
          (
            ep: {
              episodeNumber?: number
              name?: string
              description?: string
              novelText?: string
            },
            idx: number,
          ) => ({
            number: ep.episodeNumber || idx + 1,
            title: ep.name || t('episode', { num: idx + 1 }),
            summary: ep.description || '',
            content: ep.novelText || '',
            wordCount: countWords(ep.novelText || ''),
          }),
        )
        setEpisodes(loadedEpisodes)
        setStage('preview')
      }
    } catch (err) {
      _ulogError('[SmartImport] failed to load saved episodes', err)
    }
  }, [listProjectEpisodesMutation, t])

  useEffect(() => {
    if (importStatus === 'pending' && episodes.length === 0) {
      void loadSavedEpisodes()
    }
  }, [episodes.length, importStatus, loadSavedEpisodes])

  const performAISplit = useCallback(async () => {
    setShowMarkerConfirm(false)
    setStage('analyzing')
    setError(null)

    try {
      _ulogInfo('[SmartImport] starting AI episode split')
      const data = await splitProjectEpisodesMutation.mutateAsync({ content: rawContent, async: true })
      const splitEpisodes = data.episodes || []
      setEpisodes(splitEpisodes)
      _ulogInfo('[SmartImport] AI split ready for preview; database will update only after confirmation')
      setStage('preview')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('errors.analyzeFailed')
      setError(message || t('errors.analyzeFailed'))
      setStage('select')
    }
  }, [rawContent, splitProjectEpisodesMutation, t])

  const handleAnalyze = useCallback(async () => {
    _ulogInfo('[SmartImport] handleAnalyze called')
    _ulogInfo('[SmartImport] rawContent length:', rawContent.length)
    _ulogInfo('[SmartImport] projectId:', projectId)

    if (!rawContent.trim()) {
      setError(t('errors.uploadFirst'))
      return
    }

    const detection = detectEpisodeMarkers(rawContent)
    _ulogInfo('[SmartImport] marker detection result', {
      hasMarkers: detection.hasMarkers,
      markerType: detection.markerType,
      confidence: detection.confidence,
      matchCount: detection.matches.length,
      previewSplitsCount: detection.previewSplits.length,
    })

    if (detection.hasMarkers) {
      setMarkerResult(detection)
      setShowMarkerConfirm(true)
      return
    }

    _ulogInfo('[SmartImport] no markers detected, using AI split')
    await performAISplit()
  }, [performAISplit, projectId, rawContent, t])

  const autoAnalyzeTriggered = useRef(false)
  useEffect(() => {
    if (initialRawContent && !autoAnalyzeTriggered.current && stage === 'select') {
      autoAnalyzeTriggered.current = true
      void handleAnalyze()
    }
  })

  const handleMarkerSplit = useCallback(async () => {
    if (!markerResult) return

    setShowMarkerConfirm(false)
    setStage('analyzing')
    setError(null)

    try {
      const data = await splitProjectEpisodesByMarkersMutation.mutateAsync({ content: rawContent })
      const splitEpisodes = data.episodes || []
      setEpisodes(splitEpisodes)
      _ulogInfo('[SmartImport] marker split ready for preview; database will update only after confirmation')
      setStage('preview')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('errors.analyzeFailed')
      setError(message || t('errors.analyzeFailed'))
      setStage('select')
    }
  }, [markerResult, rawContent, splitProjectEpisodesByMarkersMutation, t])

  const updateEpisodeTitle = useCallback((index: number, title: string) => {
    setEpisodes((prev) => prev.map((ep, i) => (i === index ? { ...ep, title } : ep)))
  }, [])

  const updateEpisodeSummary = useCallback((index: number, summary: string) => {
    setEpisodes((prev) => prev.map((ep, i) => (i === index ? { ...ep, summary } : ep)))
  }, [])

  const updateEpisodeNumber = useCallback((index: number, number: number) => {
    setEpisodes((prev) => prev.map((ep, i) => (i === index ? { ...ep, number } : ep)))
  }, [])

  const updateEpisodeContent = useCallback((index: number, content: string) => {
    setEpisodes((prev) =>
      prev.map((ep, i) => (i === index ? { ...ep, content, wordCount: countWords(content) } : ep)),
    )
  }, [])

  const deleteEpisode = useCallback((index: number) => {
    setEpisodes((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, i) => i !== index)
      setSelectedEpisode((current) => (current >= next.length ? Math.max(0, next.length - 1) : current))
      return next
    })
  }, [])

  const addEpisode = useCallback(() => {
    setEpisodes((prev) => {
      const newEpisode: SplitEpisode = {
        number: prev.length + 1,
        title: `${t('preview.newEpisode')} ${prev.length + 1}`,
        summary: '',
        content: '',
        wordCount: 0,
      }
      const next = [...prev, newEpisode]
      setSelectedEpisode(next.length - 1)
      return next
    })
  }, [t])

  const openDeleteConfirm = useCallback((index: number, title: string) => {
    setDeleteConfirm({ show: true, index, title })
  }, [])

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirm({ show: false, index: -1, title: '' })
  }, [])

  const confirmDeleteEpisode = useCallback(() => {
    if (deleteConfirm.index >= 0) {
      deleteEpisode(deleteConfirm.index)
    }
    closeDeleteConfirm()
  }, [closeDeleteConfirm, deleteConfirm.index, deleteEpisode])

  const handleConfirm = useCallback(
    async (triggerGlobalAnalysis = false) => {
      setSaving(true)
      setError(null)

      try {
        await saveProjectEpisodesBatchMutation.mutateAsync({
          episodes: episodes.map((ep) => ({
            name: ep.title,
            description: ep.summary,
            novelText: ep.content,
          })),
          mode: 'append',
          importStatus: 'completed',
          triggerGlobalAnalysis,
        })

        _ulogInfo('[SmartImport] episodes saved after confirmation', { triggerGlobalAnalysis })
        onImportComplete(episodes, triggerGlobalAnalysis)
      } catch (err: unknown) {
        _ulogError('[SmartImport] failed to save episodes', err)
        const message = err instanceof Error ? err.message : t('errors.saveFailed')
        setError(message || t('errors.saveFailed'))
      } finally {
        setSaving(false)
      }
    },
    [episodes, onImportComplete, saveProjectEpisodesBatchMutation, t],
  )

  return {
    stage,
    setStage,
    rawContent,
    setRawContent,
    episodes,
    selectedEpisode,
    setSelectedEpisode,
    error,
    saving,
    markerResult,
    showMarkerConfirm,
    deleteConfirm,
    handleAnalyze,
    performAISplit,
    handleMarkerSplit,
    setShowMarkerConfirm,
    setMarkerResult,
    updateEpisodeTitle,
    updateEpisodeSummary,
    updateEpisodeNumber,
    updateEpisodeContent,
    addEpisode,
    openDeleteConfirm,
    closeDeleteConfirm,
    confirmDeleteEpisode,
    handleConfirm,
  }
}
