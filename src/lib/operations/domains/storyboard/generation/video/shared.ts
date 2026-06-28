import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import { resolveAiVideoTokenPricingContract } from '@/lib/ai-exec/video-token-pricing'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { resolveBuiltinPricing } from '@/lib/ai-registry/pricing-resolution'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

export type UnknownObject = { [key: string]: unknown }
type VideoTaskModelPurpose = 'single-shot-video' | 'sequence-video'
export const ASSET_REFERENCE_GRID_MODE = 'asset_reference'

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

export function resolveLocaleFromContext(locale?: unknown): string {
  const normalized = normalizeString(locale)
  return normalized || 'zh'
}

export function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toVideoRuntimeSelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      selections[field] = raw
    }
  }
  return selections
}

function mergeVideoRuntimeSelections(...sources: unknown[]): Record<string, CapabilityValue> {
  const merged: Record<string, CapabilityValue> = {}
  for (const source of sources) {
    Object.assign(merged, toVideoRuntimeSelections(source))
  }
  return merged
}

function hasRuntimeSelections(value: unknown): boolean {
  return Object.keys(toVideoRuntimeSelections(value)).length > 0
}

function resolveVideoGenerationMode(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

function usesVideoTokenPricing(modelKey: string): boolean {
  return !!resolveAiVideoTokenPricingContract(modelKey)
}

function resolveVideoModelKeyFromPayload(payload: UnknownObject): string | null {
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    return firstLast.flModel
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    return payload.videoModel
  }
  return null
}

function requireVideoModelKeyFromPayload(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.videoModel !== 'string' || !parseModelKeyStrict(payload.videoModel)) {
    throw new Error('PROJECT_AGENT_VIDEO_MODEL_REQUIRED')
  }
  return payload.videoModel
}

function rejectManagedVideoModelField(field: string): never {
  throw new ApiError('FORBIDDEN', {
    code: 'TASK_MODEL_MANAGED_BY_CONFIG',
    field,
  })
}

export function assertNoManagedVideoModelInput(payload: UnknownObject): void {
  if (Object.prototype.hasOwnProperty.call(payload, 'videoModel')) {
    rejectManagedVideoModelField('videoModel')
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'groupVideoModel')) {
    rejectManagedVideoModelField('groupVideoModel')
  }
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && Object.prototype.hasOwnProperty.call(firstLast, 'flModel')) {
    rejectManagedVideoModelField('firstLastFrame.flModel')
  }
}

async function applySystemVideoModel(params: {
  payload: UnknownObject
  projectId: string
  userId: string
  purpose: VideoTaskModelPurpose
}): Promise<void> {
  assertNoManagedVideoModelInput(params.payload)

  const systemVideoModel = await resolveSystemModelKey({
    userId: params.userId,
    projectId: params.projectId,
    purpose: params.purpose,
  })

  const firstLast = isRecord(params.payload.firstLastFrame) ? params.payload.firstLastFrame : null
  params.payload.videoModel = systemVideoModel
  if (firstLast) {
    firstLast.flModel = systemVideoModel
  }

  if (getDeploymentConfig().edition !== 'cloud') return

  const plan = getPlatformRuntimePlan('video')
  if (systemVideoModel !== plan.modelKey) {
    throw new Error(`PLATFORM_RUNTIME_MODEL_MISMATCH: video=${systemVideoModel}`)
  }

  const suppliedOptions = isRecord(params.payload.generationOptions)
    ? params.payload.generationOptions
    : {}
  if (Object.prototype.hasOwnProperty.call(suppliedOptions, 'aspectRatio')) {
    throw new ApiError('FORBIDDEN', {
      code: 'TASK_VIDEO_RATIO_MANAGED_BY_PROJECT',
      field: 'generationOptions.aspectRatio',
    })
  }
  const suppliedRuntimeOptions = isRecord(suppliedOptions)
    ? toVideoRuntimeSelections(suppliedOptions)
    : {}
  const platformOptions = plan.generationOptions
  const internalFields = new Set(['duration', 'generationMode', 'containsVideoInput'])
  const internalOptions: Record<string, CapabilityValue> = {}

  for (const [field, value] of Object.entries(suppliedRuntimeOptions)) {
    if (internalFields.has(field)) {
      internalOptions[field] = value
      continue
    }
    const platformValue = platformOptions[field]
    if (platformValue !== undefined && platformValue === value) {
      continue
    }
    throw new ApiError('FORBIDDEN', {
      code: 'TASK_OPTIONS_MANAGED_BY_PLATFORM',
      field: `generationOptions.${field}`,
    })
  }

  params.payload.generationOptions = {
    ...platformOptions,
    ...internalOptions,
  }
}

function validateFirstLastFrameModel(input: unknown) {
  if (input === undefined || input === null) return
  if (!isRecord(input)) {
    throw new Error('PROJECT_AGENT_FIRSTLASTFRAME_PAYLOAD_INVALID')
  }

  const flModel = input.flModel
  if (typeof flModel !== 'string' || !parseModelKeyStrict(flModel)) {
    throw new Error('PROJECT_AGENT_FIRSTLASTFRAME_MODEL_INVALID')
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', flModel)
  if (capabilities?.video?.firstlastframe !== true) {
    throw new Error('PROJECT_AGENT_FIRSTLASTFRAME_MODEL_UNSUPPORTED')
  }
}

async function resolveVideoCapabilityOptions(input: {
  payload: unknown
  projectId: string
  userId: string
  lastVideoGenerationOptions?: unknown
}) {
  const payload = input.payload
  if (!isRecord(payload)) return {}
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  if (!modelKey) return {}

  const builtinCaps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  if (!builtinCaps) return toVideoRuntimeSelections(payload.generationOptions)

  const explicitRuntimeSelections = toVideoRuntimeSelections(payload.generationOptions)
  const shouldApplyLastOptions = !hasRuntimeSelections(payload.generationOptions)
  const runtimeSelections = mergeVideoRuntimeSelections(
    shouldApplyLastOptions ? input.lastVideoGenerationOptions : undefined,
    explicitRuntimeSelections,
  )
  runtimeSelections.generationMode = resolveVideoGenerationMode(payload)

  const resolveOptions = (selections: Record<string, CapabilityValue>) =>
    resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'video',
      modelKey,
      runtimeSelections: selections,
    })

  let resolvedOptions: Record<string, CapabilityValue>
  try {
    resolvedOptions = await resolveOptions(runtimeSelections)
  } catch (error) {
    if (!shouldApplyLastOptions) throw error
    const fallbackSelections = { ...explicitRuntimeSelections }
    fallbackSelections.generationMode = resolveVideoGenerationMode(payload)
    resolvedOptions = await resolveOptions(fallbackSelections)
  }

  const resolution = resolveBuiltinPricing({
      apiType: 'video',
      model: modelKey,
      selections: {
        ...resolvedOptions,
        ...(usesVideoTokenPricing(modelKey) ? { containsVideoInput: false } : {}),
      },
    })
  if (resolution.status === 'missing_capability_match') {
    throw new Error('PROJECT_AGENT_VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED')
  }
  return resolvedOptions
}

export function buildVideoTaskPayload(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
}) {
  const locale = resolveLocaleFromContext(params.ctx.context.locale)
  const existingMeta = isRecord(params.input.meta) ? params.input.meta : {}
  const payload: UnknownObject = {
    ...params.input,
    meta: {
      ...existingMeta,
      locale,
    },
  }
  delete payload.confirmed
  delete payload.confirmedMaxCost

  return {
    payload,
    localeForTask: resolveRequiredTaskLocale(params.ctx.request, payload),
  }
}

export async function validateVideoTaskPayloadOrThrow(params: {
  payload: UnknownObject
  projectId: string
  userId: string
  modelPurpose: VideoTaskModelPurpose
  lastVideoGenerationOptions?: unknown
}) {
  await applySystemVideoModel({
    payload: params.payload,
    projectId: params.projectId,
    userId: params.userId,
    purpose: params.modelPurpose,
  })
  requireVideoModelKeyFromPayload(params.payload)
  validateFirstLastFrameModel(params.payload.firstLastFrame)
  const resolvedOptions = await resolveVideoCapabilityOptions({
    payload: params.payload,
    projectId: params.projectId,
    userId: params.userId,
    lastVideoGenerationOptions: params.lastVideoGenerationOptions,
  })
  params.payload.generationOptions = resolvedOptions
}

export function requirePanelSystemVideoDurationSec(panelId: string, duration: unknown): number {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || !Number.isInteger(duration) || duration <= 0) {
    throw new Error(`PROJECT_AGENT_PANEL_VIDEO_DURATION_REQUIRED:${panelId}`)
  }
  return duration
}

export function applySystemVideoDuration(payload: UnknownObject, durationSec: number): void {
  const rawGenerationOptions = isRecord(payload.generationOptions) ? payload.generationOptions : {}
  payload.generationOptions = {
    ...rawGenerationOptions,
    duration: durationSec,
  }
}
