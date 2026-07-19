import {
  buildFirstLastFramePromptFingerprintInput,
  type FirstLastFrameFingerprintPanel,
} from '@/lib/novel-promotion/first-last-frame-prompt-fingerprint'
import {
  COMFYUI_LTX23_GOON_DURATION_OPTIONS,
  normalizeLtx23GoonDurationSeconds,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { normalizeVideoDurationBinding, type VideoDurationBinding } from '@/lib/video-duration/audio-binding'

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
  smartDuration?: {
    durationSeconds: number
    confidence: number
    reason: string
    fingerprint: string
    algorithmVersion: string
  }
}

export type FirstLastFrameSmartDurationResult = NonNullable<FirstLastFramePromptResult['smartDuration']>

export type FirstLastFrameDurationStatus = {
  source: 'smart' | 'manual' | 'default' | 'analyzing'
  durationSeconds: number
  reason?: string
  canRestoreSmart: boolean
}

export function buildFirstLastFramePromptSourceSignature(
  firstPanel: FirstLastFrameFingerprintPanel,
  lastPanel: FirstLastFrameFingerprintPanel,
) {
  return JSON.stringify({
    canonical: buildFirstLastFramePromptFingerprintInput({ firstPanel, lastPanel }),
  })
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

export function markSavedUserPromptReady(
  entry: FirstLastFramePromptEntry,
  value: string,
  currentSourceSignature: string,
): FirstLastFramePromptEntry {
  return {
    ...entry,
    value,
    origin: 'user',
    dirty: false,
    status: 'idle',
    ready: true,
    verifiedSourceSignature: currentSourceSignature,
    errorMessage: undefined,
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

export function isPromptResultCurrent(
  requestSignature: string,
  currentSignature?: string,
  appliedSignature?: string,
) {
  return !!currentSignature
    && (requestSignature === currentSignature || appliedSignature === currentSignature)
}

export function canStartPromptOperation(entry?: Pick<FirstLastFramePromptEntry, 'status'>) {
  return !entry || entry.status === 'idle' || entry.status === 'error'
}

const GOON_DURATIONS = new Set<number>(COMFYUI_LTX23_GOON_DURATION_OPTIONS)

function readSmartRecommendedDuration(binding: VideoDurationBinding): number | null {
  const candidate = binding.durationSource === 'smart'
    ? binding.targetDurationSeconds
    : binding.recommendedDurationSeconds
  if (typeof candidate !== 'number') return null
  const normalized = normalizeLtx23GoonDurationSeconds(candidate)
  return normalized === candidate ? normalized : null
}

function withPreservedSmartRecommendation(
  nextBinding: VideoDurationBinding,
  previousBinding?: VideoDurationBinding | null,
): VideoDurationBinding {
  const previous = normalizeVideoDurationBinding(previousBinding)
  const recommendedDurationSeconds = readSmartRecommendedDuration(previous)
  if (recommendedDurationSeconds === null || !previous.recommendationFingerprint) return nextBinding
  return {
    ...nextBinding,
    recommendedDurationSeconds,
    ...(typeof previous.recommendationConfidence === 'number'
      ? { recommendationConfidence: previous.recommendationConfidence }
      : {}),
    ...(previous.recommendationReason ? { recommendationReason: previous.recommendationReason } : {}),
    recommendationFingerprint: previous.recommendationFingerprint,
    ...(previous.recommendationAlgorithmVersion
      ? { recommendationAlgorithmVersion: previous.recommendationAlgorithmVersion }
      : {}),
  }
}

export function resolveFirstLastFrameDurationSelection(
  field: string,
  rawValue: string,
  currentOptions: Record<string, string | number | boolean>,
  previousBinding?: VideoDurationBinding | null,
) {
  if (field !== 'duration') return null
  const duration = Number(rawValue)
  if (!GOON_DURATIONS.has(duration)) return null
  return {
    binding: withPreservedSmartRecommendation({
      mode: 'manual' as const,
      voiceLineIds: [],
      targetDurationSeconds: duration,
      durationSource: 'manual' as const,
    }, previousBinding),
    generationOptions: { ...currentOptions, duration },
  }
}

export function restoreFirstLastFrameSmartDurationBinding(
  value: VideoDurationBinding | null | undefined,
): VideoDurationBinding | null {
  const binding = normalizeVideoDurationBinding(value)
  const recommendedDurationSeconds = readSmartRecommendedDuration(binding)
  if (recommendedDurationSeconds === null || !binding.recommendationFingerprint) return null
  return {
    mode: 'manual',
    voiceLineIds: [],
    targetDurationSeconds: recommendedDurationSeconds,
    durationSource: 'smart',
    recommendedDurationSeconds,
    ...(typeof binding.recommendationConfidence === 'number'
      ? { recommendationConfidence: binding.recommendationConfidence }
      : {}),
    ...(binding.recommendationReason ? { recommendationReason: binding.recommendationReason } : {}),
    recommendationFingerprint: binding.recommendationFingerprint,
    ...(binding.recommendationAlgorithmVersion ? { recommendationAlgorithmVersion: binding.recommendationAlgorithmVersion } : {}),
  }
}

export function shouldEnsurePromptAfterDurationSelection(params: {
  previousBinding?: VideoDurationBinding | null
  nextBinding: VideoDurationBinding
}) {
  void params
  return false
}

export function confirmDurationPersistenceForPromptEntry(params: {
  entry: FirstLastFramePromptEntry
  currentSourceSignature: string
}): FirstLastFramePromptEntry {
  const isStillVerified = params.entry.verifiedSourceSignature === params.currentSourceSignature
  return {
    ...params.entry,
    status: 'idle',
    ready: isStillVerified,
    verifiedSourceSignature: isStillVerified ? params.currentSourceSignature : undefined,
    errorMessage: undefined,
  }
}

export function buildFirstLastFrameSmartDurationBinding(
  smartDuration: FirstLastFrameSmartDurationResult,
): VideoDurationBinding {
  return {
    mode: 'manual',
    voiceLineIds: [],
    targetDurationSeconds: smartDuration.durationSeconds,
    recommendedDurationSeconds: smartDuration.durationSeconds,
    durationSource: 'smart',
    recommendationConfidence: smartDuration.confidence,
    recommendationReason: smartDuration.reason,
    recommendationFingerprint: smartDuration.fingerprint,
    recommendationAlgorithmVersion: smartDuration.algorithmVersion,
  }
}

export function shouldApplyFirstLastFrameSmartDurationBinding(
  currentBinding: VideoDurationBinding | null | undefined,
) {
  const normalized = normalizeVideoDurationBinding(currentBinding)
  return normalized.durationSource !== 'manual'
}

export function resolveFirstLastFrameDurationStatus(params: {
  binding?: VideoDurationBinding | null
  durationSeconds?: unknown
  promptStatus?: FirstLastFramePromptEntry['status']
}): FirstLastFrameDurationStatus | null {
  const binding = normalizeVideoDurationBinding(params.binding)
  const selectedDuration = typeof params.durationSeconds === 'number'
    && Number.isFinite(params.durationSeconds)
    ? normalizeLtx23GoonDurationSeconds(params.durationSeconds)
    : null
  const bindingDuration = typeof binding.targetDurationSeconds === 'number'
    ? normalizeLtx23GoonDurationSeconds(binding.targetDurationSeconds)
    : null
  const durationSeconds = selectedDuration ?? bindingDuration
  if (durationSeconds === null) return null
  const canRestoreSmart = binding.durationSource === 'manual'
    && restoreFirstLastFrameSmartDurationBinding(binding) !== null
  if (
    (params.promptStatus === 'queued' || params.promptStatus === 'processing')
    && binding.durationSource !== 'smart'
    && binding.durationSource !== 'manual'
  ) {
    return { source: 'analyzing', durationSeconds, canRestoreSmart: false }
  }
  if (binding.durationSource === 'smart') {
    return {
      source: 'smart',
      durationSeconds,
      ...(binding.recommendationReason ? { reason: binding.recommendationReason } : {}),
      canRestoreSmart: false,
    }
  }
  if (binding.durationSource === 'manual') {
    return {
      source: 'manual',
      durationSeconds,
      ...(binding.recommendationReason ? { reason: binding.recommendationReason } : {}),
      canRestoreSmart,
    }
  }
  return { source: 'default', durationSeconds, canRestoreSmart: false }
}

function readPersistedTargetDuration(value: VideoDurationBinding | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = normalizeLtx23GoonDurationSeconds(value)
    return normalized === value ? normalized : null
  }
  if (!value || typeof value !== 'object') return null
  const binding = normalizeVideoDurationBinding(value)
  if (typeof binding.targetDurationSeconds !== 'number') return null
  const normalized = normalizeLtx23GoonDurationSeconds(binding.targetDurationSeconds)
  return normalized === binding.targetDurationSeconds ? normalized : null
}

export function resolvePanelFirstLastFrameGenerationOptions<T extends Record<string, unknown>>(
  panelKey: string,
  defaults: T,
  overrides: ReadonlyMap<string, T>,
  persistedTargetDuration?: VideoDurationBinding | number | null,
): T {
  const override = overrides.get(panelKey)
  if (override) return override
  const targetDuration = readPersistedTargetDuration(persistedTargetDuration)
  if (targetDuration !== null) {
    return { ...defaults, duration: targetDuration }
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
  if (params.localOperationActive) return params.taskPhase === 'processing'
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
