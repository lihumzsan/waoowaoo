import type { CapabilitySelections, CapabilityValue } from '@/lib/ai-registry/types'
import { getPlatformDefaultModels } from '@/lib/platform-models/catalog'
import type { SystemModelPurpose } from '@/lib/model-access/system-model-resolver'

export type PlatformRuntimePurpose = SystemModelPurpose

export interface PlatformRuntimePlan {
  purpose: PlatformRuntimePurpose
  modelKey: string
  generationOptions: Record<string, CapabilityValue>
}

function readEnvString(name: string): string | null {
  const raw = process.env[name]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
}

function readEnvBoolean(name: string): boolean | null {
  const raw = readEnvString(name)
  if (raw === null) return null
  const normalized = raw.toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`PLATFORM_RUNTIME_BOOLEAN_INVALID: ${name}=${raw}`)
}

function readEnvPositiveInteger(name: string): number | null {
  const raw = readEnvString(name)
  if (raw === null) return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`PLATFORM_RUNTIME_POSITIVE_INTEGER_INVALID: ${name}=${raw}`)
  }
  return parsed
}

function readEnvMusicOutputFormat(): string | null {
  const value = readEnvString('PLATFORM_MUSIC_OUTPUT_FORMAT')
  if (value === null) return null
  if (value === 'mp3' || value === 'wav') return value
  throw new Error(`PLATFORM_RUNTIME_MUSIC_OUTPUT_FORMAT_INVALID: PLATFORM_MUSIC_OUTPUT_FORMAT=${value}`)
}

function addStringOption(target: Record<string, CapabilityValue>, field: string, envName: string): void {
  const value = readEnvString(envName)
  if (value !== null) target[field] = value
}

function platformImageOptions(): Record<string, CapabilityValue> {
  const options: Record<string, CapabilityValue> = {}
  addStringOption(options, 'resolution', 'PLATFORM_IMAGE_RESOLUTION')
  addStringOption(options, 'quality', 'PLATFORM_IMAGE_QUALITY')
  return options
}

export function getPlatformVideoGenerationOptions(): Record<string, CapabilityValue> {
  const options: Record<string, CapabilityValue> = {
    resolution: readEnvString('PLATFORM_VIDEO_RESOLUTION') || '720p',
    generateAudio: readEnvBoolean('PLATFORM_VIDEO_GENERATE_AUDIO') ?? false,
  }
  return options
}

export function getPlatformMusicGenerationOptions(): Record<string, CapabilityValue> {
  const options: Record<string, CapabilityValue> = {}
  const durationSeconds = readEnvPositiveInteger('PLATFORM_MUSIC_DURATION_SECONDS')
  const outputFormat = readEnvMusicOutputFormat()
  if (durationSeconds !== null) options.durationSeconds = durationSeconds
  if (outputFormat !== null) options.outputFormat = outputFormat
  return options
}

function resolveModelKey(purpose: PlatformRuntimePurpose): string {
  const defaults = getPlatformDefaultModels()
  switch (purpose) {
    case 'analysis':
      return defaults.analysisModel
    case 'character-image':
      return defaults.characterModel
    case 'location-image':
      return defaults.locationModel
    case 'storyboard-image':
      return defaults.storyboardModel
    case 'edit-image':
      return defaults.editModel
    case 'video':
      return defaults.videoModel
    case 'music':
      return defaults.musicModel
  }
}

function resolveGenerationOptions(purpose: PlatformRuntimePurpose): Record<string, CapabilityValue> {
  switch (purpose) {
    case 'character-image':
    case 'location-image':
    case 'storyboard-image':
    case 'edit-image':
      return platformImageOptions()
    case 'video':
      return getPlatformVideoGenerationOptions()
    case 'music':
      return getPlatformMusicGenerationOptions()
    case 'analysis':
      return {}
  }
}

export function getPlatformRuntimePlan(purpose: PlatformRuntimePurpose): PlatformRuntimePlan {
  return {
    purpose,
    modelKey: resolveModelKey(purpose),
    generationOptions: resolveGenerationOptions(purpose),
  }
}

function assignCapabilityDefault(
  target: CapabilitySelections,
  modelKey: string,
  options: Record<string, CapabilityValue>,
): void {
  if (Object.keys(options).length === 0) return
  target[modelKey] = {
    ...(target[modelKey] || {}),
    ...options,
  }
}

export function getPlatformCapabilityDefaults(): CapabilitySelections {
  const defaults: CapabilitySelections = {}
  const imageOptions = platformImageOptions()
  const videoOptions = getPlatformVideoGenerationOptions()

  assignCapabilityDefault(defaults, getPlatformRuntimePlan('character-image').modelKey, imageOptions)
  assignCapabilityDefault(defaults, getPlatformRuntimePlan('location-image').modelKey, imageOptions)
  assignCapabilityDefault(defaults, getPlatformRuntimePlan('storyboard-image').modelKey, imageOptions)
  assignCapabilityDefault(defaults, getPlatformRuntimePlan('edit-image').modelKey, imageOptions)
  assignCapabilityDefault(defaults, getPlatformRuntimePlan('video').modelKey, videoOptions)

  return defaults
}
