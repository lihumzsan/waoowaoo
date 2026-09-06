import { isReasoningEffort, type ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'

export type AiModality = 'llm' | 'vision' | 'image' | 'video' | 'music' | 'sound' | 'voice'
export type AiExecutionMode = 'sync' | 'async' | 'stream' | 'batch'
export type AiVariantSubKind = 'official' | 'user-template'
export type AiLlmProtocol =
  | 'openai-responses'
  | 'openai-compatible-chat'
  | 'openrouter-chat'
  | 'codex-cli'
  | 'google-generative-ai'

/** Provider wire verified specifically for Codex custom model providers. */
export type AiCodexRuntimeWireApi = 'responses'

export type AiPublicReasoningMode = 'none' | 'native' | 'summary_auto'

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
export type AiOptionNormalizer = (options: AiReadonlyUnknownObject) => AiUnknownObject

export type AiOptionSchema = {
  allowedKeys: ReadonlySet<string>
  required?: readonly string[]
  requiresOneOf?: ReadonlyArray<{ keys: readonly string[]; message: string }>
  conflicts?: ReadonlyArray<{ keys: readonly string[]; message: string; allowSameValue?: boolean }>
  validators: { readonly [key: string]: AiOptionValidator }
  objectValidators?: readonly AiOptionObjectValidator[]
  normalize?: AiOptionNormalizer
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

export type UnifiedModelType = 'llm' | 'image' | 'video' | 'music' | 'sound' | 'voice'
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
  protocol: AiLlmProtocol
  codexRuntimeWireApi?: AiCodexRuntimeWireApi
  publicReasoningMode?: AiPublicReasoningMode
  reasoningEffortOptions?: ReasoningEffort[]
  /**
   * Total input+output token window the model accepts. Any caller that must
   * bound what it sends reads it from here; deriving a window from a model id,
   * a provider name or a hardcoded constant is what this field exists to stop.
   * Absent means undeclared, and consumers must fail closed rather than assume
   * a default — an assumed window is either wasted context or a hard overflow.
   */
  contextWindow?: number
  fieldI18n?: CapabilityFieldI18nMap
}

export interface ImageCapabilities {
  resolutionOptions?: string[]
  qualityOptions?: string[]
  fieldI18n?: CapabilityFieldI18nMap
}

export type VideoInputMode =
  | 'text_to_video'
  | 'first_frame'
  | 'first_last_frame'
  | 'continuation'
  | 'reference'

export const VIDEO_PROMPT_PROFILES = [
  'generic_v1',
  'minimax_h3_multimodal_v3',
] as const

export type VideoPromptProfile = (typeof VIDEO_PROMPT_PROFILES)[number]

export interface VideoContinuationInputCapabilities {
  minSourceDurationMs: number
  maxSourceDurationMs: number
  sourceAspectRatioByTarget: Record<string, {
    width: number
    height: number
  }>
}

export interface VideoInputModePolicy {
  durationOptions: number[]
}

export interface VideoCapabilities {
  promptProfile: VideoPromptProfile
  supportedInputModes?: VideoInputMode[]
  supportsTextToVideo?: boolean
  generationModeOptions?: string[]
  generateAudioOptions?: boolean[]
  aspectRatioOptions?: string[]
  inputModePolicies?: Partial<Record<VideoInputMode, VideoInputModePolicy>>
  resolutionOptions?: string[]
  firstlastframe?: boolean
  supportGenerateAudio?: boolean
  assetReferenceMultiReference?: boolean
  maxReferenceImages?: number
  maxReferenceAudios?: number
  maxReferenceVideos?: number
  maxReferenceFiles?: number
  referenceAudioRequiresVisual?: boolean
  minReferenceAudioDurationMs?: number
  maxTotalReferenceAudioDurationMs?: number
  continuationInput?: VideoContinuationInputCapabilities
  fieldI18n?: CapabilityFieldI18nMap
}

export type MusicGenerationMode = 'prompt' | 'composition_plan'

export interface MusicCompositionPlanCapabilities {
  maxChunks: number
  minChunkDurationMs: number
  maxChunkDurationMs: number
  minPlanDurationMs: number
  maxPlanDurationMs: number
  maxPositiveStyles: number
  maxNegativeStyles: number
  contextAdherenceOptions: Array<'low' | 'medium' | 'high'>
}

export interface MusicCapabilities {
  generationModes?: MusicGenerationMode[]
  compositionPlan?: MusicCompositionPlanCapabilities
  durationSecondsOptions?: number[]
  durationSecondsRange?: {
    min: number
    max: number
  }
  vocalModeOptions?: string[]
  outputFormatOptions?: string[]
  bpmOptions?: number[]
  bpmRange?: {
    min: number
    max: number
  }
  keyScaleOptions?: string[]
  timeSignatureOptions?: string[]
  /** Maximum video references accepted by prompt-based music models. */
  maxReferenceVideos?: number
  /**
   * Provider wire limit for one generation prompt, in characters. Absent means
   * the provider publishes no such limit.
   */
  promptMaxChars?: number
  fieldI18n?: CapabilityFieldI18nMap
}

export interface SoundCapabilities {
  durationSecondsRange?: {
    min: number
    max: number
  }
  outputFormatOptions?: string[]
  promptMaxChars?: number
  fieldI18n?: CapabilityFieldI18nMap
}

export interface VoiceCapabilities {
  useCases?: string[]
  languageOptions?: string[]
  requiresReferenceAudio?: boolean
  referenceAudioDurationMsRange?: { min: number; max: number }
  outputFormatOptions?: string[]
  outputSampleRateHz?: number
  textMaxChars?: number
  fieldI18n?: CapabilityFieldI18nMap
}

export interface ModelCapabilities {
  llm?: LLMCapabilities
  image?: ImageCapabilities
  video?: VideoCapabilities
  music?: MusicCapabilities
  sound?: SoundCapabilities
  voice?: VoiceCapabilities
}

const CAPABILITY_NAMESPACES = new Set<keyof ModelCapabilities>([
  'llm',
  'image',
  'video',
  'music',
  'sound',
  'voice',
])

const LLM_ALLOWED_FIELDS = new Set<keyof LLMCapabilities>([
  'protocol',
  'codexRuntimeWireApi',
  'publicReasoningMode',
  'reasoningEffortOptions',
  'contextWindow',
  'fieldI18n',
])

const IMAGE_ALLOWED_FIELDS = new Set<keyof ImageCapabilities>([
  'resolutionOptions',
  'qualityOptions',
  'fieldI18n',
])

const VIDEO_ALLOWED_FIELDS = new Set<keyof VideoCapabilities>([
  'promptProfile',
  'supportedInputModes',
  'supportsTextToVideo',
  'generationModeOptions',
  'generateAudioOptions',
  'aspectRatioOptions',
  'inputModePolicies',
  'resolutionOptions',
  'firstlastframe',
  'supportGenerateAudio',
  'assetReferenceMultiReference',
  'maxReferenceImages',
  'maxReferenceAudios',
  'maxReferenceVideos',
  'maxReferenceFiles',
  'referenceAudioRequiresVisual',
  'minReferenceAudioDurationMs',
  'maxTotalReferenceAudioDurationMs',
  'continuationInput',
  'fieldI18n',
])

const MUSIC_ALLOWED_FIELDS = new Set<keyof MusicCapabilities>([
  'generationModes',
  'compositionPlan',
  'durationSecondsOptions',
  'durationSecondsRange',
  'vocalModeOptions',
  'outputFormatOptions',
  'bpmOptions',
  'bpmRange',
  'keyScaleOptions',
  'timeSignatureOptions',
  'maxReferenceVideos',
  'promptMaxChars',
  'fieldI18n',
])

const SOUND_ALLOWED_FIELDS = new Set<keyof SoundCapabilities>([
  'durationSecondsRange',
  'outputFormatOptions',
  'promptMaxChars',
  'fieldI18n',
])

const VOICE_ALLOWED_FIELDS = new Set<keyof VoiceCapabilities>([
  'useCases',
  'languageOptions',
  'requiresReferenceAudio',
  'referenceAudioDurationMsRange',
  'outputFormatOptions',
  'outputSampleRateHz',
  'textMaxChars',
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
  const protocol = raw.protocol
  const allowedProtocols: readonly AiLlmProtocol[] = [
    'openai-responses',
    'openai-compatible-chat',
    'openrouter-chat',
    'codex-cli',
    'google-generative-ai',
  ]
  if (!allowedProtocols.includes(protocol as AiLlmProtocol)) {
    issues.push(makeAllowedIssue('capabilities.llm.protocol', protocol, allowedProtocols))
  }
  if (
    raw.codexRuntimeWireApi !== undefined
    && raw.codexRuntimeWireApi !== 'responses'
  ) {
    issues.push(makeAllowedIssue(
      'capabilities.llm.codexRuntimeWireApi',
      raw.codexRuntimeWireApi,
      ['responses'],
    ))
  }
  const publicReasoningModes: readonly AiPublicReasoningMode[] = [
    'none',
    'native',
    'summary_auto',
  ]
  if (
    raw.publicReasoningMode !== undefined
    && !publicReasoningModes.includes(raw.publicReasoningMode as AiPublicReasoningMode)
  ) {
    issues.push(makeAllowedIssue(
      'capabilities.llm.publicReasoningMode',
      raw.publicReasoningMode,
      publicReasoningModes,
    ))
  }
  const options = raw.reasoningEffortOptions
  const normalizedOptions = isReasoningEffortArray(options) ? options : undefined
  if (options !== undefined && !normalizedOptions) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.llm.reasoningEffortOptions',
      message: 'reasoningEffortOptions must contain only canonical reasoning effort values',
    })
  }

  const contextWindow = raw.contextWindow
  if (
    contextWindow !== undefined
    && (typeof contextWindow !== 'number'
      || !Number.isSafeInteger(contextWindow)
      || contextWindow <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.llm.contextWindow',
      message: 'contextWindow must be a positive integer token count',
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

  if (!VIDEO_PROMPT_PROFILES.includes(raw.promptProfile as VideoPromptProfile)) {
    issues.push(makeAllowedIssue(
      'capabilities.video.promptProfile',
      raw.promptProfile,
      VIDEO_PROMPT_PROFILES,
    ))
  }

  const supportedInputModes = raw.supportedInputModes
  const validInputModes = new Set<VideoInputMode>([
    'text_to_video',
    'first_frame',
    'first_last_frame',
    'continuation',
    'reference',
  ])
  if (
    supportedInputModes !== undefined
    && (
      !isStringArray(supportedInputModes)
      || supportedInputModes.some((mode) => !validInputModes.has(mode as VideoInputMode))
      || new Set(supportedInputModes).size !== supportedInputModes.length
    )
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.supportedInputModes',
      message: 'supportedInputModes must contain unique canonical video input modes',
    })
  }

  const aspectRatioOptions = raw.aspectRatioOptions
  if (
    (isStringArray(supportedInputModes) && supportedInputModes.length > 0 && !isStringArray(aspectRatioOptions))
    || (aspectRatioOptions !== undefined && (
      !isStringArray(aspectRatioOptions)
      || aspectRatioOptions.length === 0
      || new Set(aspectRatioOptions).size !== aspectRatioOptions.length
      || aspectRatioOptions.some((value) => !/^[1-9]\d*:[1-9]\d*$/u.test(value))
    ))
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.aspectRatioOptions',
      message: 'aspectRatioOptions must contain unique canonical W:H values',
    })
  }

  const inputModePolicies = raw.inputModePolicies
  const canonicalSupportedInputModes = isStringArray(supportedInputModes)
    && supportedInputModes.every((mode) => validInputModes.has(mode as VideoInputMode))
    ? supportedInputModes
    : []
  if (canonicalSupportedInputModes.length > 0 && !isRecord(inputModePolicies)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.inputModePolicies',
      message: 'inputModePolicies must declare every supported input mode',
    })
  } else if (inputModePolicies !== undefined && !isRecord(inputModePolicies)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.inputModePolicies',
      message: 'inputModePolicies must be an object',
    })
  }
  const durationOptionsForI18n: number[] = []
  if (isRecord(inputModePolicies)) {
    const expectedModes = new Set(canonicalSupportedInputModes)
    for (const mode of canonicalSupportedInputModes) {
      if (!Object.hasOwn(inputModePolicies, mode)) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilities.video.inputModePolicies.${mode}`,
          message: `Missing input mode policy: ${mode}`,
        })
      }
    }
    for (const [mode, value] of Object.entries(inputModePolicies)) {
      if (!expectedModes.has(mode)) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilities.video.inputModePolicies.${mode}`,
          message: `Unknown or unsupported input mode policy: ${mode}`,
        })
        continue
      }
      if (!isRecord(value) || Object.keys(value).some((field) => field !== 'durationOptions')) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilities.video.inputModePolicies.${mode}`,
          message: 'Input mode policy must contain only durationOptions',
        })
        continue
      }
      const options = value.durationOptions
      if (
        !isNumberArray(options)
        || options.length === 0
        || options.some((duration) => !Number.isSafeInteger(duration) || duration <= 0)
        || new Set(options).size !== options.length
      ) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilities.video.inputModePolicies.${mode}.durationOptions`,
          message: 'durationOptions must contain unique positive integers',
        })
        continue
      }
      durationOptionsForI18n.push(...options)
    }
  }

  const supportsContinuation = isStringArray(supportedInputModes)
    && supportedInputModes.includes('continuation')
  const continuationInput = raw.continuationInput
  if (supportsContinuation && !isRecord(continuationInput)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.continuationInput',
      message: 'continuationInput must declare the source media contract',
    })
  } else if (continuationInput !== undefined && !isRecord(continuationInput)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.continuationInput',
      message: 'continuationInput must be an object',
    })
  }
  if (isRecord(continuationInput)) {
    const allowedFields = new Set([
      'minSourceDurationMs',
      'maxSourceDurationMs',
      'sourceAspectRatioByTarget',
    ])
    for (const field of Object.keys(continuationInput)) {
      if (allowedFields.has(field)) continue
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.video.continuationInput.${field}`,
        message: `Unknown continuation input field: ${field}`,
      })
    }
    const minimum = continuationInput.minSourceDurationMs
    const maximum = continuationInput.maxSourceDurationMs
    if (!Number.isSafeInteger(minimum) || (minimum as number) <= 0) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.video.continuationInput.minSourceDurationMs',
        message: 'minSourceDurationMs must be a positive integer',
      })
    }
    if (!Number.isSafeInteger(maximum) || (maximum as number) <= 0) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.video.continuationInput.maxSourceDurationMs',
        message: 'maxSourceDurationMs must be a positive integer',
      })
    }
    if (
      Number.isSafeInteger(minimum)
      && Number.isSafeInteger(maximum)
      && (minimum as number) > (maximum as number)
    ) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.video.continuationInput.maxSourceDurationMs',
        message: 'maxSourceDurationMs must be at least minSourceDurationMs',
      })
    }
    const dimensionsByAspectRatio = continuationInput.sourceAspectRatioByTarget
    if (!isRecord(dimensionsByAspectRatio) || Object.keys(dimensionsByAspectRatio).length === 0) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.video.continuationInput.sourceAspectRatioByTarget',
        message: 'sourceAspectRatioByTarget must be a non-empty object',
      })
    } else {
      for (const [aspectRatio, dimensions] of Object.entries(dimensionsByAspectRatio)) {
        if (
          !aspectRatio.trim()
          || !isRecord(dimensions)
          || Object.keys(dimensions).some((field) => field !== 'width' && field !== 'height')
          || !Number.isSafeInteger(dimensions.width)
          || (dimensions.width as number) <= 0
          || !Number.isSafeInteger(dimensions.height)
          || (dimensions.height as number) <= 0
        ) {
          issues.push({
            code: 'CAPABILITY_FIELD_INVALID',
            field: `capabilities.video.continuationInput.sourceAspectRatioByTarget.${aspectRatio}`,
            message: 'Continuation source aspect ratio must contain positive integer width and height',
          })
        }
      }
    }
  }

  if (raw.supportsTextToVideo !== undefined && typeof raw.supportsTextToVideo !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.supportsTextToVideo',
      message: 'supportsTextToVideo must be boolean',
    })
  }

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

  if (
    raw.maxReferenceImages !== undefined
    && (!Number.isInteger(raw.maxReferenceImages) || (raw.maxReferenceImages as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.maxReferenceImages',
      message: 'maxReferenceImages must be a positive integer',
    })
  }

  if (
    raw.maxReferenceAudios !== undefined
    && (!Number.isInteger(raw.maxReferenceAudios) || (raw.maxReferenceAudios as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.maxReferenceAudios',
      message: 'maxReferenceAudios must be a positive integer',
    })
  }

  if (
    raw.maxReferenceVideos !== undefined
    && (!Number.isInteger(raw.maxReferenceVideos) || (raw.maxReferenceVideos as number) < 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.maxReferenceVideos',
      message: 'maxReferenceVideos must be a non-negative integer',
    })
  }

  if (
    raw.maxReferenceFiles !== undefined
    && (!Number.isInteger(raw.maxReferenceFiles) || (raw.maxReferenceFiles as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.maxReferenceFiles',
      message: 'maxReferenceFiles must be a positive integer',
    })
  }

  if (
    raw.referenceAudioRequiresVisual !== undefined
    && typeof raw.referenceAudioRequiresVisual !== 'boolean'
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.referenceAudioRequiresVisual',
      message: 'referenceAudioRequiresVisual must be boolean',
    })
  }

  if (
    raw.minReferenceAudioDurationMs !== undefined
    && (!Number.isInteger(raw.minReferenceAudioDurationMs) || (raw.minReferenceAudioDurationMs as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.minReferenceAudioDurationMs',
      message: 'minReferenceAudioDurationMs must be a positive integer',
    })
  }

  if (
    raw.maxTotalReferenceAudioDurationMs !== undefined
    && (!Number.isInteger(raw.maxTotalReferenceAudioDurationMs)
      || (raw.maxTotalReferenceAudioDurationMs as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.maxTotalReferenceAudioDurationMs',
      message: 'maxTotalReferenceAudioDurationMs must be a positive integer',
    })
  }

  validateFieldI18nMap(issues, 'video', raw.fieldI18n, {
    generationMode: isStringArray(generationModeOptions) ? generationModeOptions : undefined,
    generateAudio: isBooleanArray(generateAudioOptions) ? generateAudioOptions : undefined,
    duration: durationOptionsForI18n.length > 0
      ? Array.from(new Set(durationOptionsForI18n))
      : undefined,
    resolution: isStringArray(resolutionOptions) ? resolutionOptions : undefined,
  })
}

function validateMusicCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const generationModes = raw.generationModes
  const allowedGenerationModes: readonly MusicGenerationMode[] = ['prompt', 'composition_plan']
  if (
    generationModes !== undefined
    && (!isStringArray(generationModes)
      || generationModes.some((mode) => !allowedGenerationModes.includes(mode as MusicGenerationMode)))
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.generationModes',
      message: 'generationModes must contain only prompt or composition_plan',
      allowedValues: allowedGenerationModes,
    })
  }

  const compositionPlan = raw.compositionPlan
  if (compositionPlan !== undefined) {
    if (!isRecord(compositionPlan)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.music.compositionPlan',
        message: 'compositionPlan must be an object',
      })
    } else {
      const requiredPositiveIntegers = [
        'maxChunks',
        'minChunkDurationMs',
        'maxChunkDurationMs',
        'minPlanDurationMs',
        'maxPlanDurationMs',
        'maxPositiveStyles',
        'maxNegativeStyles',
      ] as const
      for (const field of requiredPositiveIntegers) {
        const value = compositionPlan[field]
        if (!Number.isSafeInteger(value) || (value as number) <= 0) {
          issues.push({
            code: 'CAPABILITY_FIELD_INVALID',
            field: `capabilities.music.compositionPlan.${field}`,
            message: `${field} must be a positive integer`,
          })
        }
      }
      if (
        typeof compositionPlan.minChunkDurationMs === 'number'
        && typeof compositionPlan.maxChunkDurationMs === 'number'
        && compositionPlan.maxChunkDurationMs < compositionPlan.minChunkDurationMs
      ) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: 'capabilities.music.compositionPlan.maxChunkDurationMs',
          message: 'maxChunkDurationMs must be >= minChunkDurationMs',
        })
      }
      if (
        typeof compositionPlan.minPlanDurationMs === 'number'
        && typeof compositionPlan.maxPlanDurationMs === 'number'
        && compositionPlan.maxPlanDurationMs < compositionPlan.minPlanDurationMs
      ) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: 'capabilities.music.compositionPlan.maxPlanDurationMs',
          message: 'maxPlanDurationMs must be >= minPlanDurationMs',
        })
      }
      const adherenceOptions = compositionPlan.contextAdherenceOptions
      if (
        !isStringArray(adherenceOptions)
        || adherenceOptions.some((value) => !['low', 'medium', 'high'].includes(value))
      ) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: 'capabilities.music.compositionPlan.contextAdherenceOptions',
          message: 'contextAdherenceOptions must contain only low, medium, or high',
          allowedValues: ['low', 'medium', 'high'],
        })
      }
    }
  }

  if (
    Array.isArray(generationModes)
    && generationModes.includes('composition_plan')
    && compositionPlan === undefined
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.compositionPlan',
      message: 'compositionPlan capabilities are required when composition_plan is supported',
    })
  }

  const durationSecondsOptions = raw.durationSecondsOptions
  if (durationSecondsOptions !== undefined && !isNumberArray(durationSecondsOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.durationSecondsOptions',
      message: 'durationSecondsOptions must be a finite number array',
    })
  }

  const durationSecondsRange = raw.durationSecondsRange
  if (durationSecondsRange !== undefined) {
    const validRange = isRecord(durationSecondsRange)
      && typeof durationSecondsRange.min === 'number'
      && Number.isFinite(durationSecondsRange.min)
      && durationSecondsRange.min > 0
      && typeof durationSecondsRange.max === 'number'
      && Number.isFinite(durationSecondsRange.max)
      && durationSecondsRange.max >= durationSecondsRange.min
    if (!validRange) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.music.durationSecondsRange',
        message: 'durationSecondsRange must contain finite positive min/max values with max >= min',
      })
    }
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

  const bpmRange = raw.bpmRange
  if (bpmRange !== undefined) {
    const validRange = isRecord(bpmRange)
      && typeof bpmRange.min === 'number'
      && Number.isFinite(bpmRange.min)
      && bpmRange.min > 0
      && typeof bpmRange.max === 'number'
      && Number.isFinite(bpmRange.max)
      && bpmRange.max >= bpmRange.min
    if (!validRange) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.music.bpmRange',
        message: 'bpmRange must contain finite positive min/max values with max >= min',
      })
    }
  }

  const keyScaleOptions = raw.keyScaleOptions
  if (keyScaleOptions !== undefined && !isStringArray(keyScaleOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.keyScaleOptions',
      message: 'keyScaleOptions must be a non-empty string array',
    })
  }

  const timeSignatureOptions = raw.timeSignatureOptions
  if (timeSignatureOptions !== undefined && !isStringArray(timeSignatureOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.timeSignatureOptions',
      message: 'timeSignatureOptions must be a non-empty string array',
    })
  }

  if (
    raw.maxReferenceVideos !== undefined
    && (!Number.isInteger(raw.maxReferenceVideos) || (raw.maxReferenceVideos as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.maxReferenceVideos',
      message: 'maxReferenceVideos must be a positive integer',
    })
  }

  if (
    raw.promptMaxChars !== undefined
    && (!Number.isInteger(raw.promptMaxChars) || (raw.promptMaxChars as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.music.promptMaxChars',
      message: 'promptMaxChars must be a positive integer',
    })
  }

  validateFieldI18nMap(issues, 'music', raw.fieldI18n, {
    durationSeconds: isNumberArray(durationSecondsOptions) ? durationSecondsOptions : undefined,
    vocalMode: isStringArray(vocalModeOptions) ? vocalModeOptions : undefined,
    outputFormat: isStringArray(outputFormatOptions) ? outputFormatOptions : undefined,
    bpm: isNumberArray(bpmOptions) ? bpmOptions : undefined,
    keyScale: isStringArray(keyScaleOptions) ? keyScaleOptions : undefined,
    timeSignature: isStringArray(timeSignatureOptions) ? timeSignatureOptions : undefined,
  })
}

function validateSoundCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const durationSecondsRange = raw.durationSecondsRange
  if (durationSecondsRange !== undefined) {
    const validRange = isRecord(durationSecondsRange)
      && typeof durationSecondsRange.min === 'number'
      && Number.isFinite(durationSecondsRange.min)
      && durationSecondsRange.min > 0
      && typeof durationSecondsRange.max === 'number'
      && Number.isFinite(durationSecondsRange.max)
      && durationSecondsRange.max >= durationSecondsRange.min
    if (!validRange) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: 'capabilities.sound.durationSecondsRange',
        message: 'durationSecondsRange must contain finite positive min/max values with max >= min',
      })
    }
  }

  const outputFormatOptions = raw.outputFormatOptions
  if (outputFormatOptions !== undefined && !isStringArray(outputFormatOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.sound.outputFormatOptions',
      message: 'outputFormatOptions must be a non-empty string array',
    })
  }

  if (
    raw.promptMaxChars !== undefined
    && (!Number.isInteger(raw.promptMaxChars) || (raw.promptMaxChars as number) <= 0)
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.sound.promptMaxChars',
      message: 'promptMaxChars must be a positive integer',
    })
  }

  validateFieldI18nMap(issues, 'sound', raw.fieldI18n, {
    outputFormat: isStringArray(outputFormatOptions) ? outputFormatOptions : undefined,
  })
}

function validateVoiceCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const useCases = raw.useCases
  if (useCases !== undefined && !isStringArray(useCases)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.voice.useCases',
      message: 'useCases must be a non-empty string array',
    })
  }

  const languageOptions = raw.languageOptions
  if (languageOptions !== undefined && !isStringArray(languageOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.voice.languageOptions',
      message: 'languageOptions must be a non-empty string array',
    })
  }

  if (raw.requiresReferenceAudio !== undefined && typeof raw.requiresReferenceAudio !== 'boolean') {
    issues.push({ code: 'CAPABILITY_FIELD_INVALID', field: 'capabilities.voice.requiresReferenceAudio', message: 'requiresReferenceAudio must be boolean' })
  }
  const durationRange = raw.referenceAudioDurationMsRange
  if (durationRange !== undefined) {
    const range = isRecord(durationRange) ? durationRange : null
    if (!range || typeof range.min !== 'number' || !Number.isFinite(range.min) || typeof range.max !== 'number' || !Number.isFinite(range.max) || range.min < 0 || range.max < range.min) {
      issues.push({ code: 'CAPABILITY_FIELD_INVALID', field: 'capabilities.voice.referenceAudioDurationMsRange', message: 'referenceAudioDurationMsRange must contain an ascending finite min/max' })
    }
  }
  if (raw.outputFormatOptions !== undefined && !isStringArray(raw.outputFormatOptions)) {
    issues.push({ code: 'CAPABILITY_FIELD_INVALID', field: 'capabilities.voice.outputFormatOptions', message: 'outputFormatOptions must be a non-empty string array' })
  }
  if (raw.outputSampleRateHz !== undefined && (typeof raw.outputSampleRateHz !== 'number' || !Number.isSafeInteger(raw.outputSampleRateHz) || raw.outputSampleRateHz <= 0)) {
    issues.push({ code: 'CAPABILITY_FIELD_INVALID', field: 'capabilities.voice.outputSampleRateHz', message: 'outputSampleRateHz must be a positive integer' })
  }
  if (raw.textMaxChars !== undefined && (typeof raw.textMaxChars !== 'number' || !Number.isSafeInteger(raw.textMaxChars) || raw.textMaxChars <= 0)) {
    issues.push({ code: 'CAPABILITY_FIELD_INVALID', field: 'capabilities.voice.textMaxChars', message: 'textMaxChars must be a positive integer' })
  }

  validateFieldI18nMap(issues, 'voice', raw.fieldI18n, {
    language: isStringArray(languageOptions) ? languageOptions : undefined,
    useCase: isStringArray(useCases) ? useCases : undefined,
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

  if (capabilities === undefined || capabilities === null) {
    if (modelType === 'video') {
      issues.push({
        code: 'CAPABILITY_NAMESPACE_INVALID',
        field: 'capabilities.video',
        allowedValues: ['video'],
        message: 'Video capabilities namespace is required',
      })
    }
    return issues
  }
  if (!isRecord(capabilities)) {
    issues.push({
      code: 'CAPABILITY_SHAPE_INVALID',
      field: 'capabilities',
      message: 'capabilities must be an object',
    })
    return issues
  }

  if (modelType === 'video' && capabilities.video === undefined) {
    issues.push({
      code: 'CAPABILITY_NAMESPACE_INVALID',
      field: 'capabilities.video',
      allowedValues: ['video'],
      message: 'Video capabilities namespace is required',
    })
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
  validateNamespaceShape(issues, 'sound', (capabilities as ModelCapabilities).sound)
  validateNamespaceShape(issues, 'voice', (capabilities as ModelCapabilities).voice)

  validateNamespaceAllowedFields(issues, 'llm', (capabilities as ModelCapabilities).llm, LLM_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'image', (capabilities as ModelCapabilities).image, IMAGE_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'video', (capabilities as ModelCapabilities).video, VIDEO_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'music', (capabilities as ModelCapabilities).music, MUSIC_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'sound', (capabilities as ModelCapabilities).sound, SOUND_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'voice', (capabilities as ModelCapabilities).voice, VOICE_ALLOWED_FIELDS)

  validateLLMCapabilities(issues, (capabilities as ModelCapabilities).llm)
  validateImageCapabilities(issues, (capabilities as ModelCapabilities).image)
  validateVideoCapabilities(issues, (capabilities as ModelCapabilities).video)
  validateMusicCapabilities(issues, (capabilities as ModelCapabilities).music)
  validateSoundCapabilities(issues, (capabilities as ModelCapabilities).sound)
  validateVoiceCapabilities(issues, (capabilities as ModelCapabilities).voice)

  return issues
}
