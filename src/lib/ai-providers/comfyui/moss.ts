import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderSoundExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { readComfyUiBaseUrl } from './config'
import { COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY } from './models'
import mossWorkflow from './workflows/moss-soundeffect-v2.json'
import {
  asComfyUiRecord,
  cancelComfyUiQueuedPrompt,
  ComfyUiHttpError,
  inspectComfyUiPrompt,
  readComfyUiHttpError,
  readComfyUiDeclaredNodeAudioOutput,
  readComfyUiOutputData,
  readComfyUiRequiredOptions,
  readComfyUiString,
  requestComfyUiJson,
  type ComfyUiOutput,
} from './transport'

export const COMFYUI_MOSS_MAX_AUDIO_BYTES = 25 * 1024 * 1024

export type MossSoundEffectProfile = {
  readonly modelId: typeof COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID
  readonly workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>
  readonly loaderNodeId: '29'
  readonly generatorNodeId: '30'
  readonly outputNodeId: '28'
  readonly requiredNodeClasses: readonly ['MOSS_SoundEffectV2Loader', 'MOSS_SoundEffectV2Generate', 'SaveAudioMP3']
}

export const MOSS_SOUNDEFFECT_V2_PROFILE: MossSoundEffectProfile = {
  modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID,
  workflow: mossWorkflow as MossSoundEffectProfile['workflow'],
  loaderNodeId: '29',
  generatorNodeId: '30',
  outputNodeId: '28',
  requiredNodeClasses: ['MOSS_SoundEffectV2Loader', 'MOSS_SoundEffectV2Generate', 'SaveAudioMP3'],
}

function copyGraph(profile: MossSoundEffectProfile) {
  return Object.fromEntries(Object.entries(profile.workflow).map(([nodeId, node]) => [
    nodeId,
    { class_type: node.class_type, inputs: { ...node.inputs } },
  ]))
}

export function buildMossSoundEffectPromptGraph(input: {
  readonly prompt: string
  readonly negativePrompt?: string
  readonly durationSeconds: number
  readonly seed: number
}): { readonly profile: MossSoundEffectProfile; readonly graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> } {
  if (!input.prompt.trim()) throw new Error('COMFYUI_MOSS_PROMPT_REQUIRED')
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 30) {
    throw new Error(`COMFYUI_MOSS_DURATION_INVALID:${String(input.durationSeconds)}`)
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_MOSS_SEED_INVALID')
  const graph = copyGraph(MOSS_SOUNDEFFECT_V2_PROFILE)
  const generator = graph[MOSS_SOUNDEFFECT_V2_PROFILE.generatorNodeId]
  if (!generator) throw new Error('COMFYUI_MOSS_GENERATOR_NODE_MISSING')
  generator.inputs.prompt = input.prompt
  generator.inputs.negative_prompt = input.negativePrompt ?? ''
  generator.inputs.seconds = input.durationSeconds
  generator.inputs.seed = input.seed
  generator.inputs.append_duration_suffix = true
  generator.inputs.preview = false
  return { profile: MOSS_SOUNDEFFECT_V2_PROFILE, graph }
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
  for (const className of MOSS_SOUNDEFFECT_V2_PROFILE.requiredNodeClasses) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  }
  const loaderInfo = await requestComfyUiJson(baseUrl, `/object_info/MOSS_SoundEffectV2Loader`)
  if (!readComfyUiRequiredOptions(loaderInfo, 'MOSS_SoundEffectV2Loader', 'model').includes('OpenMOSS-Team/MOSS-SoundEffect-v2.0')) {
    throw new Error('COMFYUI_MODEL_MISSING:OpenMOSS-Team/MOSS-SoundEffect-v2.0')
  }
}

export function requireMossSelection(input: AiProviderSoundExecutionContext): void {
  if (input.selection.provider !== 'comfyui' || input.selection.modelKey !== COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY || input.selection.modelId !== COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID) {
    throw new Error(`COMFYUI_MOSS_MODEL_UNSUPPORTED:${input.selection.modelKey}`)
  }
}

export async function executeComfyUiMossSoundGeneration(input: AiProviderSoundExecutionContext): Promise<GenerateResult> {
  requireMossSelection(input)
  const options = input.options ?? {}
  if (options.outputFormat !== 'mp3') throw new Error('COMFYUI_MOSS_OUTPUT_FORMAT_INVALID')
  if (typeof options.durationSeconds !== 'number') throw new Error('COMFYUI_MOSS_DURATION_REQUIRED')
  const promptId = crypto.randomUUID()
  let baseUrl: string
  let built: ReturnType<typeof buildMossSoundEffectPromptGraph>
  try {
    baseUrl = readComfyUiBaseUrl()
    built = buildMossSoundEffectPromptGraph({
      prompt: input.prompt,
      negativePrompt: options.negativePrompt,
      durationSeconds: options.durationSeconds,
      seed: Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16),
    })
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
    return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:SOUND:${promptId}`, endpoint: 'moss-soundeffect-v2' }
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status >= 400 && error.status < 500) throw promptRejection(error)
    try {
      const probe = await inspectComfyUiPrompt(baseUrl, promptId)
      if (probe.status !== 'missing') {
        return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:SOUND:${promptId}`, endpoint: 'moss-soundeffect-v2' }
      }
    } catch { /* Preserve the original accepted/unknown boundary below. */ }
    throw new Error(
      `COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export type MossSoundPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; audioUrl: string }
  | { status: 'failed'; failure: ReturnType<typeof createProviderAsyncTaskFailure> }

export async function pollComfyUiMossSound(promptId: string): Promise<MossSoundPollResult> {
  const baseUrl = readComfyUiBaseUrl()
  const inspection = await inspectComfyUiPrompt(baseUrl, promptId)
  if (inspection.status === 'pending') return inspection
  if (inspection.status === 'missing') throw new Error('COMFYUI_PROMPT_NOT_FOUND')
  if (inspection.status === 'failed') {
    return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(inspection.details), cause: inspection.details }) }
  }
  const output: ComfyUiOutput | null = readComfyUiDeclaredNodeAudioOutput(inspection.outputs, '28')
  if (!output) throw new Error('COMFYUI_MOSS_AUDIO_OUTPUT_MISSING')
  return {
    status: 'completed',
    audioUrl: await readComfyUiOutputData({
      baseUrl,
      output,
      contentType: 'audio/mpeg',
      maxBytes: COMFYUI_MOSS_MAX_AUDIO_BYTES,
      label: 'ComfyUI MOSS audio',
    }),
  }
}

export async function cancelComfyUiMossSound(promptId: string): Promise<void> {
  try {
    await cancelComfyUiQueuedPrompt(readComfyUiBaseUrl(), promptId)
  } catch (error) {
    if (error instanceof Error && /COMFYUI_HTTP_(400|404)/u.test(error.message)) return
    throw error
  }
}
