import { z } from 'zod'
import type {
  AiOptionSchema, AiReadonlyUnknownObject, AiResolvedSelection, AiVariantDescriptor,
  CapabilityValue, MusicCapabilities,
} from '@/lib/ai-registry/types'
import { buildMediaOptionSchema, enumValidator, integerRangeValidator } from '@/lib/ai-providers/shared/option-schema'
import { musicLyricsSchema, validateMusicLyricsContract } from '@/lib/workspace-resource/audio-execution-contract'
import {
  MUSIC_KEY_SCALE_VALUES, MUSIC_TIME_SIGNATURE_VALUES, isMusicKeyScale, isMusicTimeSignature,
  type MusicKeyScale, type MusicTimeSignature,
} from '@/lib/workspace-resource/music-parameter-contract'
import type { ComfyUiRuntimeTargetId } from './config'
import type { ComfyUiPromptGraph } from './profiles'
import aceStepWorkflow from './workflows/ace-step-1.5.json'
import miniMaxWorkflow from './workflows/minimax-music-3.json'

export const COMFYUI_MUSIC_OUTPUT_NODE_ID = '107'
export const ACE_STEP_MIN_PROVIDER_DURATION_SECONDS = 10
export const ACE_STEP_MAX_DURATION_SECONDS = 600

export type ComfyUiMusicDurationPlan = {
  readonly requestedDurationSeconds: number
  readonly providerDurationSeconds: number
  readonly requiresTrim: boolean
}

type ComfyUiMusicGraphInput = {
  readonly prompt: string
  // The execution engine has already normalized these with this profile's optionSchema.
  readonly options: AiReadonlyUnknownObject
  readonly seed: number
}

export type ComfyUiMusicGraphResult = {
  readonly graph: ComfyUiPromptGraph
  readonly durationPlan: ComfyUiMusicDurationPlan
}

export type ComfyUiMusicProfile = {
  readonly modelId: string
  readonly modelKey: string
  readonly name: string
  readonly runtimeTargetId: ComfyUiRuntimeTargetId
  readonly capabilities: MusicCapabilities
  readonly defaultGenerationOptions: Readonly<Record<string, CapabilityValue>>
  readonly workflow: ComfyUiPromptGraph
  readonly outputNodeId: typeof COMFYUI_MUSIC_OUTPUT_NODE_ID
  readonly optionSchema: AiOptionSchema
  readonly buildGraph: (input: ComfyUiMusicGraphInput) => ComfyUiMusicGraphResult
}

function freezeWorkflow(graph: ComfyUiPromptGraph): ComfyUiPromptGraph {
  for (const node of Object.values(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value)) Object.freeze(value)
    }
    Object.freeze(node.inputs)
    Object.freeze(node)
  }
  return Object.freeze(graph)
}

export function resolveAceStepDurationPlan(requestedDurationSeconds: number): ComfyUiMusicDurationPlan {
  if (!Number.isInteger(requestedDurationSeconds) || requestedDurationSeconds < 4 || requestedDurationSeconds > ACE_STEP_MAX_DURATION_SECONDS) {
    throw new Error(`COMFYUI_ACE_STEP_DURATION_INVALID:${String(requestedDurationSeconds)}`)
  }
  const providerDurationSeconds = Math.max(requestedDurationSeconds, ACE_STEP_MIN_PROVIDER_DURATION_SECONDS)
  return { requestedDurationSeconds, providerDurationSeconds, requiresTrim: providerDurationSeconds !== requestedDurationSeconds }
}

export function buildAceStepMusicPromptGraph(input: {
  readonly prompt: string
  readonly requestedDurationSeconds: number
  readonly bpm: number
  readonly keyScale: MusicKeyScale
  readonly timeSignature: MusicTimeSignature
  readonly seed: number
}): ComfyUiMusicGraphResult {
  if (!input.prompt.trim()) throw new Error('COMFYUI_ACE_STEP_PROMPT_REQUIRED')
  if (!Number.isInteger(input.bpm) || input.bpm < 20 || input.bpm > 300) throw new Error('COMFYUI_ACE_STEP_BPM_INVALID')
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_ACE_STEP_SEED_INVALID')
  const durationPlan = resolveAceStepDurationPlan(input.requestedDurationSeconds)
  const graph = structuredClone(ACE_STEP_1_5_PROFILE.workflow)
  const encoder = graph['94']
  const latent = graph['98']
  const sampler = graph['3']
  if (!encoder || !latent || !sampler) throw new Error('COMFYUI_ACE_STEP_PROFILE_INVALID')
  encoder.inputs.tags = input.prompt
  encoder.inputs.bpm = input.bpm
  encoder.inputs.duration = durationPlan.providerDurationSeconds
  encoder.inputs.keyscale = input.keyScale
  encoder.inputs.timesignature = input.timeSignature
  encoder.inputs.seed = input.seed
  latent.inputs.seconds = durationPlan.providerDurationSeconds
  sampler.inputs.seed = input.seed
  return { graph, durationPlan }
}

export function buildMiniMaxMusic3PromptGraph(input: {
  readonly prompt: string
  readonly lyrics: string
  readonly durationSeconds: number
  readonly seed: number
}): ComfyUiPromptGraph {
  if (!input.prompt.trim()) throw new Error('COMFYUI_MINIMAX_MUSIC_PROMPT_REQUIRED')
  musicLyricsSchema.parse(input.lyrics)
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 360) {
    throw new Error(`COMFYUI_MINIMAX_MUSIC_DURATION_INVALID:${String(input.durationSeconds)}`)
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_MINIMAX_MUSIC_SEED_INVALID')
  const graph = structuredClone(MINIMAX_MUSIC_3_PROFILE.workflow)
  const encoder = graph['42']
  const sampler = graph['47']
  if (!encoder || !sampler) throw new Error('COMFYUI_MINIMAX_MUSIC_PROFILE_INVALID')
  encoder.inputs.caption = input.prompt
  encoder.inputs.lyrics = input.lyrics
  encoder.inputs.max_duration = input.durationSeconds
  encoder.inputs.seed = input.seed
  sampler.inputs.seed = input.seed
  return graph
}

const aceStepOptionSchema = buildMediaOptionSchema('music', {
  allowedKeys: ['providerDurationSeconds'],
  required: ['durationSeconds', 'vocalMode', 'bpm', 'keyScale', 'timeSignature', 'outputFormat'],
  excludedKeys: ['negativePrompt', 'genre', 'mood', 'referenceVideos'],
  validators: {
    durationSeconds: integerRangeValidator({ min: 4, max: 600 }),
    providerDurationSeconds: integerRangeValidator({ min: 10, max: 600 }),
    vocalMode: enumValidator(['instrumental']),
    bpm: integerRangeValidator({ min: 20, max: 300 }),
    keyScale: enumValidator(MUSIC_KEY_SCALE_VALUES),
    timeSignature: enumValidator(MUSIC_TIME_SIGNATURE_VALUES),
    outputFormat: enumValidator(['mp3']),
  },
  objectValidators: [(options) => options.providerDurationSeconds === undefined
    || (typeof options.durationSeconds === 'number'
      && options.providerDurationSeconds === resolveAceStepDurationPlan(options.durationSeconds).providerDurationSeconds)
    ? { ok: true } : { ok: false, reason: 'provider_duration_mismatch' }],
  normalize: (options) => {
    if (typeof options.durationSeconds !== 'number') throw new Error('COMFYUI_ACE_STEP_DURATION_REQUIRED')
    return { ...options, providerDurationSeconds: resolveAceStepDurationPlan(options.durationSeconds).providerDurationSeconds }
  },
})

const vocalLyricsSchema = z.object({
  vocalMode: z.enum(['instrumental', 'vocal']),
  lyrics: musicLyricsSchema.optional(),
}).superRefine(validateMusicLyricsContract)

const miniMaxOptionSchema = buildMediaOptionSchema('music', {
  allowedKeys: ['lyrics', 'providerDurationSeconds'],
  required: ['durationSeconds', 'vocalMode', 'outputFormat'],
  excludedKeys: ['negativePrompt', 'genre', 'mood', 'bpm', 'keyScale', 'timeSignature', 'referenceVideos'],
  validators: {
    durationSeconds: integerRangeValidator({ min: 1, max: 360 }),
    providerDurationSeconds: integerRangeValidator({ min: 1, max: 360 }),
    vocalMode: enumValidator(['instrumental', 'vocal']),
    outputFormat: enumValidator(['mp3']),
  },
  objectValidators: [
    (options) => vocalLyricsSchema.safeParse(options).success
      ? { ok: true } : { ok: false, reason: 'lyrics_contract_invalid' },
    (options) => options.providerDurationSeconds === undefined || options.providerDurationSeconds === options.durationSeconds
      ? { ok: true } : { ok: false, reason: 'provider_duration_mismatch' },
  ],
  normalize: (options) => ({ ...options, providerDurationSeconds: options.durationSeconds }),
})

export const ACE_STEP_1_5_PROFILE: ComfyUiMusicProfile = {
  modelId: 'ace-step-1.5',
  modelKey: 'comfyui::ace-step-1.5',
  name: 'ACE-Step 1.5',
  runtimeTargetId: 'shared',
  capabilities: {
    generationModes: ['prompt'],
    durationSecondsRange: { min: 4, max: 600 }, vocalModeOptions: ['instrumental'], outputFormatOptions: ['mp3'],
    bpmRange: { min: 20, max: 300 }, keyScaleOptions: [...MUSIC_KEY_SCALE_VALUES], timeSignatureOptions: [...MUSIC_TIME_SIGNATURE_VALUES],
  },
  defaultGenerationOptions: { outputFormat: 'mp3' },
  workflow: freezeWorkflow(aceStepWorkflow),
  outputNodeId: COMFYUI_MUSIC_OUTPUT_NODE_ID,
  optionSchema: aceStepOptionSchema,
  buildGraph: (input) => {
    const options = input.options
    if (typeof options.durationSeconds !== 'number' || typeof options.bpm !== 'number'
      || !isMusicKeyScale(options.keyScale) || !isMusicTimeSignature(options.timeSignature)) {
      throw new Error('COMFYUI_ACE_STEP_OPTIONS_INVALID')
    }
    return buildAceStepMusicPromptGraph({
      prompt: input.prompt, requestedDurationSeconds: options.durationSeconds,
      bpm: options.bpm, keyScale: options.keyScale, timeSignature: options.timeSignature, seed: input.seed,
    })
  },
}

export const MINIMAX_MUSIC_3_PROFILE: ComfyUiMusicProfile = {
  modelId: 'minimax-music-3',
  modelKey: 'comfyui::minimax-music-3',
  name: 'MiniMax Music 3',
  runtimeTargetId: 'h3-dual-stage-2mp',
  capabilities: {
    generationModes: ['prompt'], durationSecondsRange: { min: 1, max: 360 },
    vocalModeOptions: ['instrumental', 'vocal'], outputFormatOptions: ['mp3'],
  },
  defaultGenerationOptions: { outputFormat: 'mp3' },
  workflow: freezeWorkflow(miniMaxWorkflow),
  outputNodeId: COMFYUI_MUSIC_OUTPUT_NODE_ID,
  optionSchema: miniMaxOptionSchema,
  buildGraph: (input) => {
    const options = input.options
    if (typeof options.durationSeconds !== 'number') throw new Error('COMFYUI_MINIMAX_MUSIC_DURATION_REQUIRED')
    const providerLyrics = options.vocalMode === 'instrumental' ? '[Instrumental]' : options.lyrics
    if (typeof providerLyrics !== 'string') throw new Error('COMFYUI_MINIMAX_MUSIC_LYRICS_REQUIRED')
    return {
      graph: buildMiniMaxMusic3PromptGraph({
        prompt: input.prompt, lyrics: providerLyrics,
        durationSeconds: options.durationSeconds, seed: input.seed,
      }),
      durationPlan: { requestedDurationSeconds: options.durationSeconds, providerDurationSeconds: options.durationSeconds, requiresTrim: false },
    }
  },
}

export const COMFYUI_MUSIC_PROFILES: readonly ComfyUiMusicProfile[] = [ACE_STEP_1_5_PROFILE, MINIMAX_MUSIC_3_PROFILE]

export function resolveComfyUiMusicProfile(selection: AiResolvedSelection): ComfyUiMusicProfile {
  const profile = COMFYUI_MUSIC_PROFILES.find((candidate) => candidate.modelKey === selection.modelKey)
  if (selection.provider !== 'comfyui' || !profile || selection.modelId !== profile.modelId) {
    throw new Error(`COMFYUI_MUSIC_MODEL_UNSUPPORTED:${selection.modelKey}`)
  }
  return profile
}

export function describeComfyUiMusic(selection: AiResolvedSelection): AiVariantDescriptor {
  const profile = resolveComfyUiMusicProfile(selection)
  return {
    modelKey: profile.modelKey, modelId: profile.modelId, providerKey: 'comfyui', providerId: 'comfyui', modality: 'music',
    display: { name: profile.name, sourceLabel: 'comfyui', label: `${profile.name} (comfyui)` },
    execution: { mode: 'async' }, capabilities: { music: profile.capabilities }, optionSchema: profile.optionSchema,
  }
}
