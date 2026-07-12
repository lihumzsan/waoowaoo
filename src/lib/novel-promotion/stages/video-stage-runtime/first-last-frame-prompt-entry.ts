export type FirstLastFramePromptEntry = {
  value: string
  origin: 'derived' | 'generated' | 'user'
  dirty: boolean
  status: 'idle' | 'queued' | 'processing' | 'saving' | 'error'
  sourceFingerprint?: string
  fallbackUsed?: boolean
  errorMessage?: string
  ready?: boolean
  verifiedSourceSignature?: string
}

export type FirstLastFramePromptResult = {
  prompt: string
  sourceFingerprint: string
  applied: boolean
  fallbackUsed: boolean
  warnings: string[]
}

export function createPersistedPromptEntry(params: {
  prompt?: string | null
  editedByUser?: boolean | null
  sourceFingerprint?: string | null
}): FirstLastFramePromptEntry | undefined {
  const value = params.prompt?.trim() || ''
  if (!value) return undefined
  return {
    value,
    origin: params.editedByUser ? 'user' : 'generated',
    dirty: false,
    status: 'idle',
    ready: false,
    ...(params.sourceFingerprint ? { sourceFingerprint: params.sourceFingerprint } : {}),
  }
}

export function buildFirstLastFrameVideoPrompt(entry: FirstLastFramePromptEntry) {
  if (entry.ready === false) throw new Error('FIRST_LAST_FRAME_PROMPT_NOT_READY')
  return {
    customPrompt: entry.value,
    customPromptEditedByUser: entry.origin === 'user',
  }
}

export function markPromptSourceChanged(
  entry: FirstLastFramePromptEntry,
  sourceFingerprint: string,
): FirstLastFramePromptEntry {
  if (entry.sourceFingerprint === sourceFingerprint) return entry
  return {
    value: '',
    origin: 'derived',
    dirty: false,
    status: 'queued',
    ready: false,
    sourceFingerprint,
  }
}

export function shouldApplyPromptResult(params: {
  linked: boolean
  requestRevision: number
  currentRevision: number
}) {
  return params.linked && params.requestRevision === params.currentRevision
}

export function isPromptResultCurrent(requestSignature: string, currentSignature?: string) {
  return !!currentSignature && requestSignature === currentSignature
}

export function canStartPromptOperation(entry?: Pick<FirstLastFramePromptEntry, 'status'>) {
  return !entry || entry.status === 'idle' || entry.status === 'error'
}

const GOON_DURATIONS = new Set([4, 5, 6, 8, 10, 12])

export function resolveFirstLastFrameDurationSelection(
  field: string,
  rawValue: string,
  currentOptions: Record<string, string | number | boolean>,
) {
  if (field !== 'duration') return null
  const duration = Number(rawValue)
  if (!GOON_DURATIONS.has(duration)) return null
  return {
    binding: { mode: 'manual' as const, voiceLineIds: [], targetDurationSeconds: duration },
    generationOptions: { ...currentOptions, duration },
  }
}

export function resolvePanelFirstLastFrameGenerationOptions<T extends Record<string, unknown>>(
  panelKey: string,
  defaults: T,
  overrides: ReadonlyMap<string, T>,
  persistedTargetDuration?: number | null,
): T {
  const override = overrides.get(panelKey)
  if (override) return override
  if (typeof persistedTargetDuration === 'number' && Number.isFinite(persistedTargetDuration)) {
    return { ...defaults, duration: persistedTargetDuration }
  }
  return defaults
}

export function resolvePromptEntryReadiness(
  entry: FirstLastFramePromptEntry,
  currentSourceSignature: string,
): FirstLastFramePromptEntry {
  if (entry.ready && entry.verifiedSourceSignature === currentSourceSignature) return entry
  if (entry.status === 'error' || entry.status === 'saving') return { ...entry, ready: false }
  return {
    ...entry,
    status: 'queued',
    ready: false,
  }
}

export function clearSupersededPromptOperation(
  entry: FirstLastFramePromptEntry,
): FirstLastFramePromptEntry {
  return {
    ...entry,
    status: 'idle',
    errorMessage: undefined,
  }
}

export function shouldAutoEnsurePrompt(params: {
  taskHydrated: boolean
  taskPhase?: string | null
  ignoreActiveSnapshot?: boolean
}) {
  if (!params.taskHydrated) return false
  if (params.ignoreActiveSnapshot && (params.taskPhase === 'queued' || params.taskPhase === 'processing')) {
    return true
  }
  return params.taskPhase !== 'failed'
    && params.taskPhase !== 'queued'
    && params.taskPhase !== 'processing'
}

export function shouldProjectPromptTaskSnapshot(params: {
  localOperationActive: boolean
  ignoreActiveSnapshot: boolean
  taskPhase?: string | null
}) {
  if (params.localOperationActive) return false
  if (
    params.ignoreActiveSnapshot
    && (params.taskPhase === 'queued' || params.taskPhase === 'processing')
  ) return false
  return true
}

export function projectPromptTaskState(
  entry: FirstLastFramePromptEntry,
  task: { phase?: string | null; errorMessage?: string | null },
): FirstLastFramePromptEntry {
  if (task.phase === 'queued' || task.phase === 'processing') {
    return { ...entry, status: task.phase, errorMessage: undefined }
  }
  if (task.phase === 'failed') {
    return { ...entry, status: 'error', errorMessage: task.errorMessage || undefined }
  }
  if (
    (task.phase === 'completed' || task.phase === 'idle')
    && (entry.status === 'queued' || entry.status === 'processing')
  ) {
    return { ...entry, status: 'idle', errorMessage: undefined }
  }
  return entry
}

export function applyPromptResult(
  entry: FirstLastFramePromptEntry,
  result: FirstLastFramePromptResult,
): FirstLastFramePromptEntry {
  if (!result.applied) {
    return {
      ...entry,
      status: 'error',
      ready: false,
      errorMessage: 'Generated prompt was not applied because the linked source changed.',
    }
  }
  return {
    value: result.prompt,
    origin: 'generated',
    dirty: false,
    status: 'idle',
    ready: true,
    sourceFingerprint: result.sourceFingerprint,
    fallbackUsed: result.fallbackUsed,
    errorMessage: undefined,
  }
}
