import aceStepWorkflow from './workflows/ace-step-1.5.json'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { MusicKeyScale, MusicTimeSignature } from '@/lib/workspace-resource/music-parameter-contract'
import { resolveComfyUiRuntimeTarget } from './config'
import { formatComfyUiExternalId } from './external-id'
import { COMFYUI_ACE_STEP_1_5_MODEL_ID, COMFYUI_ACE_STEP_1_5_MODEL_KEY } from './models'
import {
  asComfyUiRecord,
  COMFYUI_ACCEPTED_JOB_STATUSES,
  ComfyUiHttpError,
  readComfyUiDeclaredNodeAudioOutput,
  readComfyUiHttpError,
  readComfyUiOutputData,
  readComfyUiOptions,
  readComfyUiString,
  requestComfyUiJson,
  type ComfyUiOutput,
} from './transport'

export const ACE_STEP_MIN_PROVIDER_DURATION_SECONDS = 10
export const ACE_STEP_MAX_DURATION_SECONDS = 600

type AceStepGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export const ACE_STEP_1_5_PROFILE = {
  modelId: COMFYUI_ACE_STEP_1_5_MODEL_ID,
  workflow: aceStepWorkflow as AceStepGraph,
  encoderNodeId: '94',
  latentNodeId: '98',
  samplerNodeId: '3',
  outputNodeId: '107',
  requiredNodeClasses: [
    'UNETLoader',
    'DualCLIPLoader',
    'VAELoader',
    'ModelSamplingAuraFlow',
    'TextEncodeAceStepAudio1.5',
    'EmptyAceStep1.5LatentAudio',
    'ConditioningZeroOut',
    'KSampler',
    'VAEDecodeAudio',
    'SaveAudioAdvanced',
  ],
} as const

export type AceStepDurationPlan = {
  readonly requestedDurationSeconds: number
  readonly providerDurationSeconds: number
  readonly requiresTrim: boolean
}

export function resolveAceStepDurationPlan(requestedDurationSeconds: number): AceStepDurationPlan {
  if (!Number.isInteger(requestedDurationSeconds) || requestedDurationSeconds < 4 || requestedDurationSeconds > ACE_STEP_MAX_DURATION_SECONDS) {
    throw new Error(`COMFYUI_ACE_STEP_DURATION_INVALID:${String(requestedDurationSeconds)}`)
  }
  const providerDurationSeconds = Math.max(requestedDurationSeconds, ACE_STEP_MIN_PROVIDER_DURATION_SECONDS)
  return {
    requestedDurationSeconds,
    providerDurationSeconds,
    requiresTrim: providerDurationSeconds !== requestedDurationSeconds,
  }
}

function copyGraph(): AceStepGraph {
  return Object.fromEntries(Object.entries(ACE_STEP_1_5_PROFILE.workflow).map(([nodeId, node]) => [
    nodeId,
    { class_type: node.class_type, inputs: { ...node.inputs } },
  ]))
}

export function buildAceStepMusicPromptGraph(input: {
  readonly prompt: string
  readonly requestedDurationSeconds: number
  readonly bpm: number
  readonly keyScale: MusicKeyScale
  readonly timeSignature: MusicTimeSignature
  readonly seed: number
}): { readonly graph: AceStepGraph; readonly durationPlan: AceStepDurationPlan } {
  if (!input.prompt.trim()) throw new Error('COMFYUI_ACE_STEP_PROMPT_REQUIRED')
  if (!Number.isInteger(input.bpm) || input.bpm < 20 || input.bpm > 300) throw new Error('COMFYUI_ACE_STEP_BPM_INVALID')
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_ACE_STEP_SEED_INVALID')
  const durationPlan = resolveAceStepDurationPlan(input.requestedDurationSeconds)
  const graph = copyGraph()
  const encoder = graph[ACE_STEP_1_5_PROFILE.encoderNodeId]
  const latent = graph[ACE_STEP_1_5_PROFILE.latentNodeId]
  const sampler = graph[ACE_STEP_1_5_PROFILE.samplerNodeId]
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

function preAcceptRejected(error: unknown): ProviderSubmissionError {
  const message = error instanceof Error ? error.message : String(error)
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', message.slice(0, 512), {
    disposition: 'pre_accept_rejected',
    provider: 'comfyui',
    externalId: null,
    details: error instanceof ComfyUiHttpError
      ? { httpStatus: error.status, payload: error.payload }
      : { diagnostic: message.slice(0, 512) },
    cause: error,
  })
}

function promptRejection(error: ComfyUiHttpError): ProviderSubmissionError {
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', readComfyUiHttpError(error.payload), {
    disposition: 'rejected',
    provider: 'comfyui',
    externalId: null,
    details: { httpStatus: error.status, payload: error.payload },
    cause: error,
  })
}

async function preflight(baseUrl: string): Promise<void> {
  for (const className of ACE_STEP_1_5_PROFILE.requiredNodeClasses) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  }
  const checks = [
    ['UNETLoader', 'unet_name', 'acestep_v1.5_turbo.safetensors'],
    ['DualCLIPLoader', 'clip_name1', 'qwen_0.6b_ace15.safetensors'],
    ['DualCLIPLoader', 'clip_name2', 'qwen_1.7b_ace15.safetensors'],
    ['VAELoader', 'vae_name', 'ace_1.5_vae.safetensors'],
  ] as const
  for (const [className, field, expected] of checks) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!readComfyUiOptions(info, className, field, 'required').includes(expected)) {
      throw new Error(`COMFYUI_MODEL_MISSING:${expected}`)
    }
  }
}

export function requireAceStepSelection(input: AiProviderMusicExecutionContext): void {
  if (input.selection.provider !== 'comfyui' || input.selection.modelId !== COMFYUI_ACE_STEP_1_5_MODEL_ID || input.selection.modelKey !== COMFYUI_ACE_STEP_1_5_MODEL_KEY) {
    throw new Error(`COMFYUI_ACE_STEP_MODEL_UNSUPPORTED:${input.selection.modelKey}`)
  }
}

export async function executeComfyUiAceStepMusicGeneration(input: AiProviderMusicExecutionContext): Promise<GenerateResult> {
  requireAceStepSelection(input)
  if (input.generation.kind !== 'prompt') throw new Error('COMFYUI_ACE_STEP_GENERATION_MODE_INVALID')
  const options = input.options ?? {}
  if (options.vocalMode !== 'instrumental') throw new Error('COMFYUI_ACE_STEP_VOCAL_MODE_INVALID')
  if (options.outputFormat !== 'mp3') throw new Error('COMFYUI_ACE_STEP_OUTPUT_FORMAT_INVALID')
  if (typeof options.durationSeconds !== 'number') throw new Error('COMFYUI_ACE_STEP_DURATION_REQUIRED')
  if (typeof options.providerDurationSeconds !== 'number') throw new Error('COMFYUI_ACE_STEP_PROVIDER_DURATION_REQUIRED')
  if (typeof options.bpm !== 'number') throw new Error('COMFYUI_ACE_STEP_BPM_REQUIRED')
  if (typeof options.keyScale !== 'string') throw new Error('COMFYUI_ACE_STEP_KEYSCALE_REQUIRED')
  if (typeof options.timeSignature !== 'string') throw new Error('COMFYUI_ACE_STEP_TIME_SIGNATURE_REQUIRED')
  const promptId = crypto.randomUUID()
  let baseUrl: string
  let built: ReturnType<typeof buildAceStepMusicPromptGraph>
  try {
    baseUrl = resolveComfyUiRuntimeTarget('shared').baseUrl
    built = buildAceStepMusicPromptGraph({
      prompt: input.generation.prompt,
      requestedDurationSeconds: options.durationSeconds,
      bpm: options.bpm,
      keyScale: options.keyScale,
      timeSignature: options.timeSignature,
      seed: Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16),
    })
    if (options.providerDurationSeconds !== built.durationPlan.providerDurationSeconds) {
      throw new Error('COMFYUI_ACE_STEP_PROVIDER_DURATION_MISMATCH')
    }
    await preflight(baseUrl)
  } catch (error) {
    throw preAcceptRejected(error)
  }
  try {
    const raw = await requestComfyUiJson(baseUrl, '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: built.graph, prompt_id: promptId }),
    })
    if (readComfyUiString(asComfyUiRecord(raw)?.prompt_id) !== promptId) throw new Error('COMFYUI_PROMPT_ID_MISMATCH')
    return {
      success: true,
      async: true,
      requestId: promptId,
      externalId: formatComfyUiExternalId({ targetId: 'shared', type: 'MUSIC', requestId: promptId }),
      endpoint: 'ace-step-1.5',
      metadata: built.durationPlan,
    }
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status >= 400 && error.status < 500) throw promptRejection(error)
    try {
      const probe = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
      if (COMFYUI_ACCEPTED_JOB_STATUSES.has(readComfyUiString(probe?.status))) {
        return { success: true, async: true, requestId: promptId, externalId: formatComfyUiExternalId({ targetId: 'shared', type: 'MUSIC', requestId: promptId }), endpoint: 'ace-step-1.5', metadata: built.durationPlan }
      }
    } catch { /* Preserve the original accepted/unknown boundary below. */ }
    throw new Error(`COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

export type AceStepMusicPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; audioUrl: string }
  | { status: 'failed'; failure: ReturnType<typeof createProviderAsyncTaskFailure> }

export async function pollComfyUiAceStepMusic(promptId: string, targetId: string = 'shared'): Promise<AceStepMusicPollResult> {
  if (targetId !== 'shared') throw new Error(`COMFYUI_RUNTIME_TARGET_MISMATCH:shared:${targetId}`)
  const baseUrl = resolveComfyUiRuntimeTarget('shared').baseUrl
  const record = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
  const status = readComfyUiString(record?.status)
  if (status === 'pending') return { status: 'pending', pendingPhase: 'queued' }
  if (status === 'in_progress') return { status: 'pending', pendingPhase: 'running' }
  if (status === 'cancelled') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: 'ComfyUI ACE-Step job was cancelled', cause: record }) }
  if (status === 'failed') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(record?.execution_error), cause: record }) }
  if (status !== 'completed') throw new Error(`COMFYUI_JOB_STATUS_UNKNOWN:${status || '<missing>'}`)
  const output: ComfyUiOutput | null = readComfyUiDeclaredNodeAudioOutput(record?.outputs ?? record?.preview_output ?? record?.output, ACE_STEP_1_5_PROFILE.outputNodeId)
  if (!output) throw new Error('COMFYUI_ACE_STEP_AUDIO_OUTPUT_MISSING')
  return {
    status: 'completed',
    audioUrl: await readComfyUiOutputData({
      baseUrl,
      output,
      contentType: 'audio/mpeg',
      maxBytes: 100 * 1024 * 1024,
      label: 'ComfyUI ACE-Step music',
    }),
  }
}

export async function cancelComfyUiAceStepMusic(promptId: string, targetId: string = 'shared'): Promise<void> {
  if (targetId !== 'shared') throw new Error(`COMFYUI_RUNTIME_TARGET_MISMATCH:shared:${targetId}`)
  try {
    await requestComfyUiJson(resolveComfyUiRuntimeTarget('shared').baseUrl, `/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' })
  } catch (error) {
    if (error instanceof Error && /COMFYUI_HTTP_(400|404)/u.test(error.message)) return
    throw error
  }
}
