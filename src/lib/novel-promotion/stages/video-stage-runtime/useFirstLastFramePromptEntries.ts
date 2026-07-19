'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VideoDurationBinding, VideoPanel } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import { buildDefaultFirstLastFramePrompt } from '@/lib/novel-promotion/panel-continuity'
import type { FirstLastFramePromptReason } from '@/lib/novel-promotion/first-last-frame-prompt'
import { useGenerateFirstLastFramePrompt } from '@/lib/query/mutations/useVideoMutations'
import {
  applyPromptResult,
  buildFirstLastFrameSmartDurationBinding,
  buildFirstLastFramePromptSourceSignature,
  canStartPromptOperation,
  clearSupersededPromptOperation,
  confirmDurationPersistenceForPromptEntry,
  createPersistedPromptEntry,
  isPromptResultCurrent,
  markSavedUserPromptReady,
  projectPromptTaskState,
  resolvePromptEntryReadiness,
  shouldApplyFirstLastFrameSmartDurationBinding,
  shouldApplyPromptResult,
  shouldAutoEnsurePrompt,
  shouldProjectPromptTaskSnapshot,
  type FirstLastFramePromptEntry,
} from './first-last-frame-prompt-entry'
import { createPromptAutoEnsureQueue, type PromptAutoEnsureQueue } from './prompt-auto-ensure-queue'

interface PromptTaskStates {
  isFetching: boolean
  getTaskState: (key: string) => {
    phase?: string | null
    lastError?: { message?: string | null } | null
  } | null
}

interface UseFirstLastFramePromptEntriesParams {
  projectId: string
  episodeId: string
  allPanels: VideoPanel[]
  linkedPanels: Map<string, boolean>
  visiblePanelKeys?: ReadonlySet<string>
  promptTaskStates: PromptTaskStates
  onUpdatePrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field: 'firstLastFramePrompt',
  ) => Promise<void>
}

export function useFirstLastFramePromptEntries({
  projectId,
  episodeId,
  allPanels,
  linkedPanels,
  visiblePanelKeys,
  promptTaskStates,
  onUpdatePrompt,
}: UseFirstLastFramePromptEntriesParams) {
  const [promptEntries, setPromptEntries] = useState<Map<string, FirstLastFramePromptEntry>>(new Map())
  const [durationRevision, setDurationRevision] = useState(0)
  const ensureMutation = useGenerateFirstLastFramePrompt(projectId)
  const autoEnsureQueueRef = useRef<PromptAutoEnsureQueue | null>(null)
  const ensuredSignaturesRef = useRef(new Map<string, string>())
  const requestRevisionsRef = useRef(new Map<string, number>())
  const activeOperationsRef = useRef(new Set<string>())
  const locallySettledPanelsRef = useRef(new Set<string>())
  const persistedDurationOverridesRef = useRef(new Map<string, VideoDurationBinding>())
  const promptEntriesRef = useRef(promptEntries)
  promptEntriesRef.current = promptEntries
  const linkedPanelsRef = useRef(linkedPanels)
  linkedPanelsRef.current = linkedPanels

  const getPanelPair = useCallback((panelKey: string) => {
    const index = allPanels.findIndex(
      (panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey,
    )
    if (index < 0 || index >= allPanels.length - 1) return null
    return { firstPanel: allPanels[index], lastPanel: allPanels[index + 1] }
  }, [allPanels])

  const buildSourceSignature = useCallback((
    firstPanel: VideoPanel,
    lastPanel: VideoPanel,
    explicitDurationOverride?: VideoDurationBinding,
  ) => {
    const panelKey = `${firstPanel.storyboardId}-${firstPanel.panelIndex}`
    const durationOverride = explicitDurationOverride
      || persistedDurationOverridesRef.current.get(panelKey)
    const firstSource = firstPanel.firstLastFramePromptFingerprintSource
      ? { ...firstPanel.firstLastFramePromptFingerprintSource, ...(durationOverride ? { videoDurationBinding: durationOverride } : {}) }
      : {
        id: firstPanel.panelId,
        imageUrl: firstPanel.imageUrl,
        description: firstPanel.textPanel?.description,
        imagePrompt: firstPanel.textPanel?.imagePrompt,
        videoPrompt: firstPanel.textPanel?.video_prompt,
        shotType: firstPanel.textPanel?.shot_type,
        cameraMove: firstPanel.textPanel?.camera_move,
        location: firstPanel.textPanel?.location,
        videoDurationBinding: durationOverride || firstPanel.videoDurationBinding,
        duration: firstPanel.textPanel?.duration,
      }
    return buildFirstLastFramePromptSourceSignature(
      firstSource,
      lastPanel.firstLastFramePromptFingerprintSource || {
        id: lastPanel.panelId,
        imageUrl: lastPanel.imageUrl,
        description: lastPanel.textPanel?.description,
        imagePrompt: lastPanel.textPanel?.imagePrompt,
        videoPrompt: lastPanel.textPanel?.video_prompt,
        shotType: lastPanel.textPanel?.shot_type,
        cameraMove: lastPanel.textPanel?.camera_move,
        location: lastPanel.textPanel?.location,
      },
    )
  }, [])

  const buildDerivedEntry = useCallback((firstPanel: VideoPanel, lastPanel: VideoPanel): FirstLastFramePromptEntry => ({
    value: buildDefaultFirstLastFramePrompt({
      firstPanel: {
        id: firstPanel.panelId,
        panelIndex: firstPanel.panelIndex,
        description: firstPanel.textPanel?.description,
        imagePrompt: firstPanel.textPanel?.imagePrompt,
        videoPrompt: firstPanel.textPanel?.video_prompt,
        shotType: firstPanel.textPanel?.shot_type,
        cameraMove: firstPanel.textPanel?.camera_move,
        location: firstPanel.textPanel?.location,
        srtSegment: firstPanel.textPanel?.text_segment,
      },
      lastPanel: {
        id: lastPanel.panelId,
        panelIndex: lastPanel.panelIndex,
        description: lastPanel.textPanel?.description,
        imagePrompt: lastPanel.textPanel?.imagePrompt,
        videoPrompt: lastPanel.textPanel?.video_prompt,
        shotType: lastPanel.textPanel?.shot_type,
        cameraMove: lastPanel.textPanel?.camera_move,
        location: lastPanel.textPanel?.location,
        srtSegment: lastPanel.textPanel?.text_segment,
      },
    }),
    origin: 'derived',
    dirty: false,
    status: 'idle',
    sourceFingerprint: buildSourceSignature(firstPanel, lastPanel),
  }), [buildSourceSignature])

  const currentSignaturesRef = useRef(new Map<string, string>())
  const currentSignatures = useMemo(() => {
    void durationRevision
    const signatures = new Map<string, string>()
    for (let index = 0; index < allPanels.length - 1; index += 1) {
      const firstPanel = allPanels[index]
      const panelKey = `${firstPanel.storyboardId}-${firstPanel.panelIndex}`
      signatures.set(panelKey, buildSourceSignature(firstPanel, allPanels[index + 1]))
    }
    return signatures
  // The override map is intentionally held in a ref; a successful persistence bumps this revision.
  }, [allPanels, buildSourceSignature, durationRevision])
  currentSignaturesRef.current = currentSignatures

  useEffect(() => {
    setPromptEntries((previous) => {
      const next = new Map(previous)
      const existingPanelKeys = new Set<string>()
      for (const panel of allPanels) {
        const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
        existingPanelKeys.add(panelKey)
        const persisted = createPersistedPromptEntry({
          prompt: panel.firstLastFramePrompt,
          editedByUser: panel.firstLastFramePromptEditedByUser,
          sourceFingerprint: panel.firstLastFramePromptSourceFingerprint,
        })
        const current = next.get(panelKey)
        if (persisted && (!current || (!current.dirty && current.status === 'idle' && (
          current.value !== persisted.value
          || current.sourceFingerprint !== persisted.sourceFingerprint
        )))) next.set(panelKey, persisted)
      }
      for (const key of next.keys()) {
        if (!existingPanelKeys.has(key)) next.delete(key)
      }
      return next
    })
  }, [allPanels])

  const ensurePrompt = useCallback(async (panelKey: string, reason: FirstLastFramePromptReason) => {
    const pair = getPanelPair(panelKey)
    if (
      !pair
      || !pair.firstPanel.panelId
      || !pair.lastPanel.panelId
      || !pair.firstPanel.imageUrl
      || !pair.lastPanel.imageUrl
      || (!linkedPanelsRef.current.get(panelKey) && reason !== 'link')
    ) return
    if (activeOperationsRef.current.has(panelKey) || !canStartPromptOperation(promptEntriesRef.current.get(panelKey))) return

    const signature = buildSourceSignature(pair.firstPanel, pair.lastPanel)
    if (reason === 'source_change' && ensuredSignaturesRef.current.get(panelKey) === signature) return
    ensuredSignaturesRef.current.set(panelKey, signature)
    const requestRevision = (requestRevisionsRef.current.get(panelKey) || 0) + 1
    requestRevisionsRef.current.set(panelKey, requestRevision)
    activeOperationsRef.current.add(panelKey)
    locallySettledPanelsRef.current.delete(panelKey)
    setPromptEntries((previous) => new Map(previous).set(panelKey, {
      ...(previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)),
      status: 'queued',
      errorMessage: undefined,
    }))

    const clearSuperseded = () => {
      ensuredSignaturesRef.current.delete(panelKey)
      setPromptEntries((previous) => {
        const current = previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)
        return new Map(previous).set(panelKey, clearSupersededPromptOperation(current))
      })
    }

    try {
      const result = await ensureMutation.mutateAsync({
        firstPanelId: pair.firstPanel.panelId,
        lastPanelId: pair.lastPanel.panelId,
        episodeId,
        reason,
        onTaskUpdate: (task) => {
          if (task.status !== 'queued' && task.status !== 'processing') return
          setPromptEntries((previous) => {
            if (
              requestRevisionsRef.current.get(panelKey) !== requestRevision
              || (!linkedPanelsRef.current.get(panelKey) && reason !== 'link')
            ) return previous
            const current = previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)
            const projected = projectPromptTaskState(current, { phase: task.status })
            if (projected.status === current.status) return previous
            return new Map(previous).set(panelKey, projected)
          })
        },
      })
      const currentBinding = persistedDurationOverridesRef.current.get(panelKey)
        || pair.firstPanel.videoDurationBinding
      const nextSmartDurationBinding = result.applied
        && result.smartDuration
        && shouldApplyFirstLastFrameSmartDurationBinding(currentBinding)
        ? buildFirstLastFrameSmartDurationBinding(result.smartDuration)
        : undefined
      const appliedSignature = nextSmartDurationBinding
        ? buildSourceSignature(pair.firstPanel, pair.lastPanel, nextSmartDurationBinding)
        : undefined
      if (!isPromptResultCurrent(
        signature,
        currentSignaturesRef.current.get(panelKey),
        appliedSignature,
      )) {
        clearSuperseded()
        return
      }
      const shouldApply = shouldApplyPromptResult({
        linked: reason === 'link' || linkedPanelsRef.current.get(panelKey) === true,
        requestRevision,
        currentRevision: requestRevisionsRef.current.get(panelKey) || 0,
      })
      if (!shouldApply) {
        clearSuperseded()
        return
      }
      if (!result.applied) ensuredSignaturesRef.current.delete(panelKey)
      let verifiedSourceSignature = signature
      if (nextSmartDurationBinding && appliedSignature) {
        persistedDurationOverridesRef.current.set(panelKey, nextSmartDurationBinding)
        verifiedSourceSignature = appliedSignature
        currentSignaturesRef.current.set(panelKey, verifiedSourceSignature)
        setDurationRevision((revision) => revision + 1)
      }
      setPromptEntries((previous) => new Map(previous).set(panelKey, {
        ...applyPromptResult(previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel), result),
        ...(result.applied ? { verifiedSourceSignature, ready: true } : {}),
      }))
    } catch (error) {
      const shouldApply = shouldApplyPromptResult({
        linked: reason === 'link' || linkedPanelsRef.current.get(panelKey) === true,
        requestRevision,
        currentRevision: requestRevisionsRef.current.get(panelKey) || 0,
      })
      if (!shouldApply) {
        clearSuperseded()
        return
      }
      setPromptEntries((previous) => new Map(previous).set(panelKey, {
        ...(previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      activeOperationsRef.current.delete(panelKey)
      locallySettledPanelsRef.current.add(panelKey)
    }
  }, [buildDerivedEntry, buildSourceSignature, ensureMutation, episodeId, getPanelPair])
  const ensurePromptRef = useRef(ensurePrompt)
  ensurePromptRef.current = ensurePrompt

  useEffect(() => {
    const queue = createPromptAutoEnsureQueue(
      (panelKey) => ensurePromptRef.current(panelKey, 'source_change'),
      { concurrency: 2 },
    )
    autoEnsureQueueRef.current = queue
    return () => {
      queue.dispose()
      if (autoEnsureQueueRef.current === queue) autoEnsureQueueRef.current = null
    }
  }, [])

  useEffect(() => {
    setPromptEntries((previous) => {
      let changed = false
      const next = new Map(previous)
      for (const panel of allPanels) {
        if (!panel.panelId) continue
        const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
        const pair = getPanelPair(panelKey)
        if (!pair) continue
        const current = next.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)
        const task = promptTaskStates.getTaskState(`panel-first-last-prompt:${panel.panelId}`)
        if (!task) continue
        const ignoreActiveSnapshot = locallySettledPanelsRef.current.has(panelKey)
        if (!shouldProjectPromptTaskSnapshot({
          localOperationActive: activeOperationsRef.current.has(panelKey),
          ignoreActiveSnapshot,
          taskPhase: task.phase,
        })) continue
        if (ignoreActiveSnapshot) locallySettledPanelsRef.current.delete(panelKey)
        const projected = projectPromptTaskState(current, {
          phase: task.phase,
          errorMessage: task.lastError?.message,
        })
        if (projected.status !== current.status || projected.errorMessage !== current.errorMessage) {
          next.set(panelKey, projected)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [allPanels, buildDerivedEntry, getPanelPair, promptEntries, promptTaskStates])

  useEffect(() => {
    const candidates: string[] = []
    for (let index = 0; index < allPanels.length - 1; index += 1) {
      const firstPanel = allPanels[index]
      const lastPanel = allPanels[index + 1]
      const panelKey = `${firstPanel.storyboardId}-${firstPanel.panelIndex}`
      if (visiblePanelKeys && !visiblePanelKeys.has(panelKey)) continue
      const task = firstPanel.panelId
        ? promptTaskStates.getTaskState(`panel-first-last-prompt:${firstPanel.panelId}`)
        : null
      if (
        !linkedPanels.get(panelKey)
        || !firstPanel.imageUrl
        || !lastPanel.imageUrl
        || promptEntriesRef.current.get(panelKey)?.status === 'error'
        || !shouldAutoEnsurePrompt({
          taskHydrated: !promptTaskStates.isFetching,
          taskPhase: task?.phase,
          ignoreActiveSnapshot: locallySettledPanelsRef.current.has(panelKey),
        })
      ) continue
      candidates.push(panelKey)
    }
    autoEnsureQueueRef.current?.replace(candidates)
  }, [allPanels, linkedPanels, promptEntries, promptTaskStates, visiblePanelKeys])

  const resolvedPromptEntries = useMemo(() => {
    const next = new Map(promptEntries)
    for (let index = 0; index < allPanels.length - 1; index += 1) {
      const firstPanel = allPanels[index]
      const panelKey = `${firstPanel.storyboardId}-${firstPanel.panelIndex}`
      if (!linkedPanels.get(panelKey)) continue
      const current = next.get(panelKey) || buildDerivedEntry(firstPanel, allPanels[index + 1])
      next.set(panelKey, resolvePromptEntryReadiness(
        current,
        currentSignatures.get(panelKey) || '',
      ))
    }
    return next
  }, [allPanels, buildDerivedEntry, currentSignatures, linkedPanels, promptEntries])

  const beginDurationPersistence = useCallback((panelKey: string) => {
    const pair = getPanelPair(panelKey)
    if (!pair) return
    setPromptEntries((previous) => {
      const current = previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)
      return new Map(previous).set(panelKey, { ...current, status: 'saving', ready: false, errorMessage: undefined })
    })
  }, [buildDerivedEntry, getPanelPair])

  const confirmPersistedDuration = useCallback((panelKey: string, binding: VideoDurationBinding) => {
    persistedDurationOverridesRef.current.set(panelKey, binding)
    const pair = getPanelPair(panelKey)
    if (!pair) return
    const signature = buildSourceSignature(pair.firstPanel, pair.lastPanel)
    currentSignaturesRef.current.set(panelKey, signature)
    ensuredSignaturesRef.current.delete(panelKey)
    setPromptEntries((previous) => {
      const current = previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)
      return new Map(previous).set(panelKey, confirmDurationPersistenceForPromptEntry({
        entry: current,
        currentSourceSignature: signature,
      }))
    })
    setDurationRevision((revision) => revision + 1)
  }, [buildDerivedEntry, buildSourceSignature, getPanelPair])

  const failDurationPersistence = useCallback((panelKey: string, error: unknown) => {
    setPromptEntries((previous) => {
      const current = previous.get(panelKey)
      if (!current) return previous
      return new Map(previous).set(panelKey, {
        ...current,
        status: 'error',
        ready: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    })
  }, [])

  const setPromptValue = useCallback((panelKey: string, value: string) => {
    const pair = getPanelPair(panelKey)
    if (!pair) return
    setPromptEntries((previous) => new Map(previous).set(panelKey, {
      ...(previous.get(panelKey) || buildDerivedEntry(pair.firstPanel, pair.lastPanel)),
      value,
      origin: 'user',
      dirty: true,
      fallbackUsed: false,
      errorMessage: undefined,
    }))
  }, [buildDerivedEntry, getPanelPair])

  const savePromptValue = useCallback(async (panelKey: string, value: string) => {
    const pair = getPanelPair(panelKey)
    const entry = resolvedPromptEntries.get(panelKey)
    if (!pair || !entry) return
    if (activeOperationsRef.current.has(panelKey) || !canStartPromptOperation(promptEntriesRef.current.get(panelKey))) return
    activeOperationsRef.current.add(panelKey)
    const trimmedValue = value.trim()
    setPromptEntries((previous) => new Map(previous).set(panelKey, {
      ...entry, value, origin: 'user', dirty: true, status: 'saving',
    }))
    try {
      await onUpdatePrompt(pair.firstPanel.storyboardId, pair.firstPanel.panelIndex, trimmedValue, 'firstLastFramePrompt')
    } catch (error) {
      setPromptEntries((previous) => new Map(previous).set(panelKey, {
        ...entry,
        value,
        origin: 'user',
        dirty: true,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      }))
      throw error
    } finally {
      activeOperationsRef.current.delete(panelKey)
    }
    if (!trimmedValue) {
      const resetEntry = {
        ...buildDerivedEntry(pair.firstPanel, pair.lastPanel),
        status: 'idle' as const,
      }
      promptEntriesRef.current = new Map(promptEntriesRef.current).set(panelKey, resetEntry)
      setPromptEntries((previous) => new Map(previous).set(panelKey, resetEntry))
      ensuredSignaturesRef.current.delete(panelKey)
      await ensurePrompt(panelKey, 'source_change')
      return
    }
    const currentSourceSignature = currentSignaturesRef.current.get(panelKey)
      || buildSourceSignature(pair.firstPanel, pair.lastPanel)
    ensuredSignaturesRef.current.set(panelKey, currentSourceSignature)
    setPromptEntries((previous) => new Map(previous).set(
      panelKey,
      markSavedUserPromptReady(entry, trimmedValue, currentSourceSignature),
    ))
  }, [buildDerivedEntry, buildSourceSignature, ensurePrompt, getPanelPair, onUpdatePrompt, resolvedPromptEntries])

  const unlinkPrompt = useCallback((panelKey: string) => {
    requestRevisionsRef.current.set(panelKey, (requestRevisionsRef.current.get(panelKey) || 0) + 1)
    ensuredSignaturesRef.current.delete(panelKey)
    locallySettledPanelsRef.current.add(panelKey)
    setPromptEntries((previous) => {
      const current = previous.get(panelKey)
      if (!current) return previous
      return new Map(previous).set(panelKey, clearSupersededPromptOperation(current))
    })
  }, [])

  return {
    promptEntries: resolvedPromptEntries,
    getPromptEntry: (panelKey: string) => resolvedPromptEntries.get(panelKey),
    setPromptValue,
    savePromptValue,
    ensurePrompt,
    unlinkPrompt,
    beginDurationPersistence,
    confirmPersistedDuration,
    failDurationPersistence,
    getPersistedDurationOverride: (panelKey: string) => persistedDurationOverridesRef.current.get(panelKey),
  }
}
