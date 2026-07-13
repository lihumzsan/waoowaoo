import type OpenAI from 'openai'
import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'
import type { LLMStreamKind } from '@/lib/llm-observe/types'
import type { ChatMessageContent } from '@/lib/ai-registry/message-content'
import { isReasoningEffort, type ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'

export type AiModality = 'llm' | 'vision' | 'image' | 'video' | 'music' | 'soundEffect'
export type AiExecutionMode = 'sync' | 'async' | 'stream' | 'batch'
export type AiVariantSubKind = 'official' | 'user-template'

export type AiOptionValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export interface AiUnknownObject {
  [key: string]: unknown
}

export interface AiReadonlyUnknownObject {
  readonly [key: string]: unknown
}

export type AiOptionValidator = (value: unknown) => AiOptionValidationResult
export type AiOptionObjectValidator = (options: AiReadonlyUnknownObject) => AiOptionValidationResult

export type AiOptionSchema = {
  allowedKeys: ReadonlySet<string>
  required?: readonly string[]
  requiresOneOf?: ReadonlyArray<{ keys: readonly string[]; message: string }>
  conflicts?: ReadonlyArray<{ keys: readonly string[]; message: string; allowSameValue?: boolean }>
  validators: { readonly [key: string]: AiOptionValidator }
  objectValidators?: readonly AiOptionObjectValidator[]
}

export type AiVariantDescriptor = {
  modelKey: string
  providerKey: string
  providerId: string
  modelId: string
  modality: AiModality

  familyRef?: string

  display: {
    name: string
    sourceLabel: string
    label: string
  }

  execution: {
    mode: AiExecutionMode
    externalIdPrefix?: string
  }

  capabilities: ModelCapabilities
  optionSchema: AiOptionSchema
  inputContracts?: AiUnknownObject
}

export type AiResolvedSelection = {
  provider: string
  modelId: string
  modelKey: string
  variantSubKind: AiVariantSubKind
  variantData?: AiUnknownObject
}

export type AiResolvedLlmSelection = AiResolvedSelection

export type AiLlmMessage = {
  role: 'user' | 'assistant' | 'system'
  content: ChatMessageContent
}

export interface ChatCompletionOptions {
  temperature?: number
  reasoning?: boolean
  reasoningEffort?: ReasoningEffort
  projectId?: string
  action?: string
  openRouterSessionId?: string
  streamStepId?: string
  streamStepAttempt?: number
  streamStepTitle?: string
  streamStepIndex?: number
  streamStepTotal?: number
  __skipAutoStream?: boolean
}

export interface ChatCompletionStreamCallbacks {
  onStage?: (stage: {
    stage: 'submit' | 'streaming' | 'fallback' | 'completed'
    provider?: string | null
    step?: InternalLLMStreamStepMeta
  }) => void
  onChunk?: (chunk: {
    kind: LLMStreamKind
    delta: string
    seq: number
    lane?: string | null
    step?: InternalLLMStreamStepMeta
  }) => void
  onComplete?: (text: string, step?: InternalLLMStreamStepMeta) => void
  onError?: (error: unknown, step?: InternalLLMStreamStepMeta) => void
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: ChatMessageContent }

export type AiStepMeta = {
  stepId: string
  stepAttempt?: number
  stepTitle: string
  stepIndex: number
  stepTotal: number
}

export type AiTextMessages = Array<{
  role: 'user' | 'assistant' | 'system'
  content: ChatMessageContent
}>

export type AiStepExecutionInput = {
  userId: string
  model: string
  messages: AiTextMessages
  projectId?: string
  action: string
  meta: AiStepMeta
  temperature?: number
  reasoning?: boolean
  reasoningEffort?: ReasoningEffort
}

export type AiStepExecutionResult = {
  text: string
  reasoning: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  completion: OpenAI.Chat.Completions.ChatCompletion
}

export type AiVisionStepExecutionInput = {
  userId: string
  model: string
  prompt: string
  imageUrls: string[]
  projectId?: string
  action?: string
  meta?: AiStepMeta
  temperature?: number
  reasoning?: boolean
  reasoningEffort?: ReasoningEffort
}

export type AiVisionStepExecutionResult = {
  text: string
  reasoning: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  completion: OpenAI.Chat.Completions.ChatCompletion
}

export type AiLlmProviderConfig = {
  id: string
  name: string
  apiKey: string
  baseUrl?: string
}

export type AiLlmExecutionInput = {
  userId: string
  providerKey: string
  selection: AiResolvedLlmSelection
  providerConfig: AiLlmProviderConfig
  messages: AiLlmMessage[]
  temperature: number
  reasoning: boolean
  reasoningEffort: ReasoningEffort
  openRouterSessionId?: string
}

export type AiLlmUsage = {
  promptTokens: number
  completionTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  cacheHitRate?: number
  providerCostCredits?: number
}

export type AiLlmTermination = {
  readonly kind: 'normal' | 'token_limit' | 'safety' | 'tool_call' | 'unknown'
  readonly rawReason: string | null
}

export type AiLlmExecutionResult = {
  completion: OpenAI.Chat.Completions.ChatCompletion
  logProvider: string
  text: string
  reasoning: string
  termination: AiLlmTermination
  usage?: AiLlmUsage | null
  successDetails?: AiUnknownObject
}

export type UnifiedModelType = 'llm' | 'image' | 'video' | 'music' | 'soundEffect'
export type CapabilityValue = string | number | boolean
export type CapabilityOptionValue = CapabilityValue
export type CapabilitySelections = Record<string, Record<string, CapabilityValue>>

export type CapabilityValidationCode =
  | 'CAPABILITY_SHAPE_INVALID'
  | 'CAPABILITY_NAMESPACE_INVALID'
  | 'CAPABILITY_FIELD_INVALID'
  | 'CAPABILITY_VALUE_NOT_ALLOWED'

export interface CapabilityValidationIssue {
  code: CapabilityValidationCode
  field: string
  message: string
  allowedValues?: readonly CapabilityOptionValue[]
}

export interface CapabilityFieldI18n {
  labelKey?: string
  unitKey?: string
  optionLabelKeys?: Record<string, string>
}

export type CapabilityFieldI18nMap = Record<string, CapabilityFieldI18n>

export interface LLMCapabilities {
  reasoningEffortOptions?: ReasoningEffort[]
  fieldI18n?: CapabilityFieldI18nMap
}

export interface ImageCapabilities {
  resolutionOptions?: string[]
  qualityOptions?: string[]
  fieldI18n?: CapabilityFieldI18nMap
}

export interface VideoCapabilities {
  generationModeOptions?: string[]
  generateAudioOptions?: boolean[]
  durationOptions?: number[]
  fpsOptions?: number[]
  resolutionOptions?: string[]
  firstlastframe?: boolean
  supportGenerateAudio?: boolean
  assetReferenceMultiReference?: boolean
  fieldI18n?: CapabilityFieldI18nMap
}

export interface MusicCapabilities {
  durationSecondsOptions?: number[]
  vocalModeOptions?: string[]
  outputFormatOptions?: string[]
  bpmOptions?: number[]
  fieldI18n?: CapabilityFieldI18nMap
}

export interface SoundEffectCapabilities {
  durationSecondsOptions?: number[]
  loopOptions?: boolean[]
  promptInfluenceOptions?: number[]
  outputFormatOptions?: string[]
  fieldI18n?: CapabilityFieldI18nMap
}

export interface ModelCapabilities {
  llm?: LLMCapabilities
  image?: ImageCapabilities
  video?: VideoCapabilities
  music?: MusicCapabilities
  soundEffect?: SoundEffectCapabilities
}

const CAPABILITY_NAMESPACES = new Set<keyof ModelCapabilities>([
  'llm',
  'image',
  'video',
  'music',
  'soundEffect',
])

const LLM_ALLOWED_FIELDS = new Set<keyof LLMCapabilities>([
  'reasoningEffortOptions',
  'fieldI18n',
])

const IMAGE_ALLOWED_FIELDS = new Set<keyof ImageCapabilities>([
  'resolutionOptions',
  'qualityOptions',
  'fieldI18n',
])

const VIDEO_ALLOWED_FIELDS = new Set<keyof VideoCapabilities>([
  'generationModeOptions',
  'generateAudioOptions',
  'durationOptions',
  'fpsOptions',
  'resolutionOptions',
  'firstlastframe',
  'supportGenerateAudio',
  'assetReferenceMultiReference',
  'fieldI18n',
])

const MUSIC_ALLOWED_FIELDS = new Set<keyof MusicCapabilities>([
  'durationSecondsOptions',
  'vocalModeOptions',
  'outputFormatOptions',
  'bpmOptions',
  'fieldI18n',
])

const SOUND_EFFECT_ALLOWED_FIELDS = new Set<keyof SoundEffectCapabilities>([
  'durationSecondsOptions',
  'loopOptions',
  'promptInfluenceOptions',
  'outputFormatOptions',
  'fieldI18n',
])

function isRecord(value: unknown): value is AiUnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

function isReasoningEffortArray(value: unknown): value is ReasoningEffort[] {
  return Array.isArray(value) && value.length > 0 && value.every(isReasoningEffort)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isBooleanArray(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'boolean')
}

function makeAllowedIssue(
  field: string,
  value: unknown,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValidationIssue {
  return {
    code: 'CAPABILITY_VALUE_NOT_ALLOWED',
    field,
    allowedValues,
    message: `Value ${String(value)} is not allowed`,
  }
}

function validateFieldI18nMap(
  issues: CapabilityValidationIssue[],
  namespace: keyof ModelCapabilities,
  rawFieldI18n: unknown,
  allowedFields: Readonly<Record<string, readonly CapabilityOptionValue[] | undefined>>,
) {
  if (rawFieldI18n === undefined) return
  if (!isRecord(rawFieldI18n)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `capabilities.${namespace}.fieldI18n`,
      message: 'fieldI18n must be an object',
    })
    return
  }

  for (const [field, rawConfig] of Object.entries(rawFieldI18n)) {
    if (!(field in allowedFields)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}`,
        message: `Unknown i18n field: ${field}`,
      })
      continue
    }

    if (!isRecord(rawConfig)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}`,
        message: 'field i18n config must be an object',
      })
      continue
    }

    if (rawConfig.labelKey !== undefined && !isNonEmptyString(rawConfig.labelKey)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}.labelKey`,
        message: 'labelKey must be a non-empty string',
      })
    }

    if (rawConfig.unitKey !== undefined && !isNonEmptyString(rawConfig.unitKey)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}.unitKey`,
        message: 'unitKey must be a non-empty string',
      })
    }

    if (rawConfig.optionLabelKeys !== undefined) {
      if (!isRecord(rawConfig.optionLabelKeys)) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilities.${namespace}.fieldI18n.${field}.optionLabelKeys`,
          message: 'optionLabelKeys must be an object',
        })
        continue
      }

      const allowedOptionKeys = new Set((allowedFields[field] || []).map((value) => String(value)))
      for (const [optionKey, optionLabel] of Object.entries(rawConfig.optionLabelKeys)) {
        if (!isNonEmptyString(optionLabel)) {
          issues.push({
            code: 'CAPABILITY_FIELD_INVALID',
            field: `capabilities.${namespace}.fieldI18n.${field}.optionLabelKeys.${optionKey}`,
            message: 'option label must be a non-empty string',
          })
        }
        if (allowedOptionKeys.size > 0 && !allowedOptionKeys.has(optionKey)) {
          issues.push({
            code: 'CAPABILITY_VALUE_NOT_ALLOWED',
            field: `capabilities.${namespace}.fieldI18n.${field}.optionLabelKeys.${optionKey}`,
            message: `Option key ${optionKey} is not defined in ${field}Options`,
            allowedValues: Array.from(allowedOptionKeys),
          })
        }
      }
    }
  }
}

function validateNamespaceShape(
  issues: CapabilityValidationIssue[],
  namespace: keyof ModelCapabilities,
  value: unknown,
) {
  if (value === undefined) return
  if (!isRecord(value)) {
    issues.push({
      code: 'CAPABILITY_SHAPE_INVALID',
      field: `capabilities.${namespace}`,
      message: `capabilities.${namespace} must be an object`,
    })
  }
}

function validateNamespaceAllowedFields(
  issues: CapabilityValidationIssue[],
  namespace: keyof ModelCapabilities,
  value: unknown,
  allowedFields: ReadonlySet<string>,
) {
  if (!isRecord(value)) return
  for (const field of Object.keys(value)) {
    if (allowedFields.has(field)) continue
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `capabilities.${namespace}.${field}`,
      message: field === 'i18n'
        ? 'Use fieldI18n instead of i18n'
        : `Unknown capability field: ${field}`,
    })
  }
}

function validateLLMCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return
  const options = raw.reasoningEffortOptions
  const normalizedOptions = isReasoningEffortArray(options) ? options : undefined
  if (options !== undefined && !normalizedOptions) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.llm.reasoningEffortOptions',
      message: 'reasoningEffortOptions must contain only canonical reasoning effort values',
    })
  }

  validateFieldI18nMap(issues, 'llm', raw.fieldI18n, {
    reasoningEffort: normalizedOptions,
  })
}

function validateImageCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const resolutionOptions = raw.resolutionOptions
  if (resolutionOptions !== undefined && !isStringArray(resolutionOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.image.resolutionOptions',
      message: 'resolutionOptions must be a non-empty string array',
    })
  }

  const qualityOptions = raw.qualityOptions
  if (qualityOptions !== undefined && !isStringArray(qualityOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.image.qualityOptions',
      message: 'qualityOptions must be a non-empty string array',
    })
  }

  validateFieldI18nMap(issues, 'image', raw.fieldI18n, {
    resolution: isStringArray(resolutionOptions) ? resolutionOptions : undefined,
    quality: isStringArray(qualityOptions) ? qualityOptions : undefined,
  })
}

function validateVideoCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const generationModeOptions = raw.generationModeOptions
  if (generationModeOptions !== undefined && !isStringArray(generationModeOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.generationModeOptions',
      message: 'generationModeOptions must be a non-empty string array',
    })
  }

  const generateAudioOptions = raw.generateAudioOptions
  if (generateAudioOptions !== undefined && !isBooleanArray(generateAudioOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.generateAudioOptions',
      message: 'generateAudioOptions must be a boolean array',
    })
  }

  const durationOptions = raw.durationOptions
  if (durationOptions !== undefined && !isNumberArray(durationOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.durationOptions',
      message: 'durationOptions must be a finite number array',
    })
  }

  const fpsOptions = raw.fpsOptions
  if (fpsOptions !== undefined && !isNumberArray(fpsOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.fpsOptions',
      message: 'fpsOptions must be a finite number array',
    })
  }

  const resolutionOptions = raw.resolutionOptions
  if (resolutionOptions !== undefined && !isStringArray(resolutionOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.resolutionOptions',
      message: 'resolutionOptions must be a non-empty string array',
    })
  }

  if (raw.supportGenerateAudio !== undefined && typeof raw.supportGenerateAudio !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.supportGenerateAudio',
      message: 'supportGenerateAudio must be boolean',
    })
  }

  if (raw.firstlastframe !== undefined && typeof raw.firstlastframe !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.firstlastframe',
      message: 'firstlastframe must be boolean',
    })
  }

  if (raw.assetReferenceMultiReference !== undefined && typeof raw.assetReferenceMultiReference !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.assetReferenceMultiReference',
      message: 'assetReferenceMultiReference must be boolean',
    })
  }

  validateFieldI18nMap(issues, 'video', raw.fieldI18n, {
    generationMode: isStringArray(generationModeOptions) ? generationModeOptions : undefined,
    generateAudio: isBooleanArray(generateAudioOptions) ? generateAudioOptions : undefined,
    duration: isNumberArray(durationOptions) ? durationOptions : undefined,
    fps: isNumberArray(fpsOptions) ? fpsOptions : undefined,
    resolution: isStringArray(resolutionOptions) ? resolutionOptions : undefined,
  })
}

function validateMusicCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const durationSecondsOptions = raw.durationSecondsOptions
  if (durationSecondsOptions !== undefined && !isNumberArray(durationSecondsOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.durationSecondsOptions',
      message: 'durationSecondsOptions must be a finite number array',
    })
  }

  const vocalModeOptions = raw.vocalModeOptions
  if (vocalModeOptions !== undefined && !isStringArray(vocalModeOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.vocalModeOptions',
      message: 'vocalModeOptions must be a non-empty string array',
    })
  }

  const outputFormatOptions = raw.outputFormatOptions
  if (outputFormatOptions !== undefined && !isStringArray(outputFormatOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.outputFormatOptions',
      message: 'outputFormatOptions must be a non-empty string array',
    })
  }

  const bpmOptions = raw.bpmOptions
  if (bpmOptions !== undefined && !isNumberArray(bpmOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.bpmOptions',
      message: 'bpmOptions must be a finite number array',
    })
  }

  validateFieldI18nMap(issues, 'music', raw.fieldI18n, {
    durationSeconds: isNumberArray(durationSecondsOptions) ? durationSecondsOptions : undefined,
    vocalMode: isStringArray(vocalModeOptions) ? vocalModeOptions : undefined,
    outputFormat: isStringArray(outputFormatOptions) ? outputFormatOptions : undefined,
    bpm: isNumberArray(bpmOptions) ? bpmOptions : undefined,
  })
}

function validateSoundEffectCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const durationSecondsOptions = raw.durationSecondsOptions
  if (durationSecondsOptions !== undefined && !isNumberArray(durationSecondsOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.soundEffect.durationSecondsOptions',
      message: 'durationSecondsOptions must be a finite number array',
    })
  }

  const loopOptions = raw.loopOptions
  if (loopOptions !== undefined && !isBooleanArray(loopOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.soundEffect.loopOptions',
      message: 'loopOptions must be a boolean array',
    })
  }

  const promptInfluenceOptions = raw.promptInfluenceOptions
  if (promptInfluenceOptions !== undefined && !isNumberArray(promptInfluenceOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.soundEffect.promptInfluenceOptions',
      message: 'promptInfluenceOptions must be a finite number array',
    })
  }

  const outputFormatOptions = raw.outputFormatOptions
  if (outputFormatOptions !== undefined && !isStringArray(outputFormatOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.soundEffect.outputFormatOptions',
      message: 'outputFormatOptions must be a non-empty string array',
    })
  }

  validateFieldI18nMap(issues, 'soundEffect', raw.fieldI18n, {
    durationSeconds: isNumberArray(durationSecondsOptions) ? durationSecondsOptions : undefined,
    loop: isBooleanArray(loopOptions) ? loopOptions : undefined,
    promptInfluence: isNumberArray(promptInfluenceOptions) ? promptInfluenceOptions : undefined,
    outputFormat: isStringArray(outputFormatOptions) ? outputFormatOptions : undefined,
  })
}

function validateOptionFieldValue(
  fieldPath: string,
  value: unknown,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValidationIssue | null {
  if (!allowedValues.includes(value as CapabilityOptionValue)) {
    return makeAllowedIssue(fieldPath, value, allowedValues)
  }
  return null
}

export function validateOptionValueAgainstAllowed(
  fieldPath: string,
  value: unknown,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValidationIssue[] {
  const issue = validateOptionFieldValue(fieldPath, value, allowedValues)
  return issue ? [issue] : []
}

export function validateModelCapabilities(
  modelType: UnifiedModelType,
  capabilities: unknown,
): CapabilityValidationIssue[] {
  const issues: CapabilityValidationIssue[] = []
  const expectedNamespace: keyof ModelCapabilities = modelType

  if (capabilities === undefined || capabilities === null) return issues
  if (!isRecord(capabilities)) {
    issues.push({
      code: 'CAPABILITY_SHAPE_INVALID',
      field: 'capabilities',
      message: 'capabilities must be an object',
    })
    return issues
  }

  for (const namespace of Object.keys(capabilities)) {
    if (!CAPABILITY_NAMESPACES.has(namespace as keyof ModelCapabilities)) {
      issues.push({
        code: 'CAPABILITY_NAMESPACE_INVALID',
        field: `capabilities.${namespace}`,
        message: `Unknown capabilities namespace: ${namespace}`,
      })
      continue
    }

    if (namespace !== expectedNamespace) {
      issues.push({
        code: 'CAPABILITY_NAMESPACE_INVALID',
        field: `capabilities.${namespace}`,
        allowedValues: [expectedNamespace],
        message: `Namespace ${namespace} is not allowed for model type ${modelType}`,
      })
    }
  }

  validateNamespaceShape(issues, 'llm', (capabilities as ModelCapabilities).llm)
  validateNamespaceShape(issues, 'image', (capabilities as ModelCapabilities).image)
  validateNamespaceShape(issues, 'video', (capabilities as ModelCapabilities).video)
  validateNamespaceShape(issues, 'music', (capabilities as ModelCapabilities).music)
  validateNamespaceShape(issues, 'soundEffect', (capabilities as ModelCapabilities).soundEffect)

  validateNamespaceAllowedFields(issues, 'llm', (capabilities as ModelCapabilities).llm, LLM_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'image', (capabilities as ModelCapabilities).image, IMAGE_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'video', (capabilities as ModelCapabilities).video, VIDEO_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'music', (capabilities as ModelCapabilities).music, MUSIC_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'soundEffect', (capabilities as ModelCapabilities).soundEffect, SOUND_EFFECT_ALLOWED_FIELDS)

  validateLLMCapabilities(issues, (capabilities as ModelCapabilities).llm)
  validateImageCapabilities(issues, (capabilities as ModelCapabilities).image)
  validateVideoCapabilities(issues, (capabilities as ModelCapabilities).video)
  validateMusicCapabilities(issues, (capabilities as ModelCapabilities).music)
  validateSoundEffectCapabilities(issues, (capabilities as ModelCapabilities).soundEffect)

  return issues
}
