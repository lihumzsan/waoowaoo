import { AppError } from '@/lib/errors/app-error'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderVideoExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { FailureRecord } from '@/lib/errors/failure'
import { readComfyUiBaseUrl } from './config'
import { COMFYUI_H3_MODEL_ID } from './models'
import {
  buildH3PromptGraph,
  H3_MODELS,
  H3_RUNTIME_PROFILES,
  type H3AspectRatio,
  type H3ProfileId,
  type H3Resolution,
} from './profiles'
import {
  asComfyUiRecord,
  cancelComfyUiQueuedPrompt,
  ComfyUiHttpError,
  inspectComfyUiPrompt,
  readComfyUiHttpError,
  readComfyUiOutput,
  readComfyUiOutputData,
  readComfyUiRequiredOptions,
  readComfyUiString,
  requestComfyUiJson,
} from './transport'

export const COMFYUI_H3_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`

const COMFYUI_H3_MAX_VIDEO_BYTES = 100 * 1024 * 1024
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
  const classes = H3_RUNTIME_PROFILES['h3-fast-first-frame'].requiredNodeClasses
  for (const className of classes) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  }
  const expectedModels: Array<[string, string, string]> = [
    ['UNETLoader', 'unet_name', H3_MODELS.diffusion],
    ['CLIPLoader', 'clip_name', H3_MODELS.textEncoder],
    ['LoraLoaderBypassModelOnly', 'lora_name', H3_MODELS.turboLora],
    ['VAELoader', 'vae_name', H3_MODELS.videoVae],
    ['VAELoader', 'vae_name', H3_MODELS.audioVae],
  ]
  for (const [className, field, expected] of expectedModels) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!readComfyUiRequiredOptions(info, className, field).includes(expected)) throw new Error(`COMFYUI_MODEL_MISSING:${expected}`)
  }
}

function requireSelection(input: AiProviderVideoExecutionContext): void {
  if (input.selection.provider !== 'comfyui' || input.selection.modelKey !== COMFYUI_H3_MODEL_KEY) {
    throw new AppError('INVALID_PARAMS', `Unsupported ComfyUI H3 model: ${input.selection.modelKey}`, { provider: 'comfyui' })
  }
}

function resolveProfile(input: AiProviderVideoExecutionContext): H3ProfileId {
  const lastFrame = typeof input.options?.lastFrameImageUrl === 'string' ? input.options.lastFrameImageUrl.trim() : ''
  return lastFrame ? 'h3-fast-first-last-frame' : 'h3-fast-first-frame'
}

function buildGraph(input: AiProviderVideoExecutionContext, promptId: string): { profileId: H3ProfileId; graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> } {
  requireSelection(input)
  const options = input.options ?? {}
  if (options.generateAudio !== true) throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires generateAudio=true', { provider: 'comfyui' })
  if ((options.referenceImages?.length ?? 0) > 0 || (options.referenceAudios?.length ?? 0) > 0 || (options.referenceVideos?.length ?? 0) > 0) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 does not support generic references', { provider: 'comfyui' })
  }
  if (!input.imageUrl.trim()) throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires a first frame', { provider: 'comfyui' })
  const profileId = resolveProfile(input)
  const duration = options.duration
  const resolution = options.resolution
  const aspectRatio = options.aspectRatio
  if (typeof duration !== 'number' || !Number.isInteger(duration) || typeof resolution !== 'string' || typeof aspectRatio !== 'string') {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires duration, resolution, and aspectRatio', { provider: 'comfyui' })
  }
  const seed = Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16)
  const built = buildH3PromptGraph({
    profileId,
    prompt: options.prompt?.trim() || '',
    firstFrameUrl: input.imageUrl,
    ...(profileId === 'h3-fast-first-last-frame' ? { lastFrameUrl: options.lastFrameImageUrl } : {}),
    durationSeconds: duration,
    resolution: resolution as H3Resolution,
    aspectRatio: aspectRatio as H3AspectRatio,
    seed,
  })
  return { profileId, graph: built.graph }
}

export async function executeComfyUiH3VideoGeneration(input: AiProviderVideoExecutionContext): Promise<GenerateResult> {
  const promptId = crypto.randomUUID()
  let baseUrl: string
  let built: ReturnType<typeof buildGraph>
  try {
    baseUrl = readComfyUiBaseUrl()
    built = buildGraph(input, promptId)
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
    return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:VIDEO:${promptId}`, endpoint: built.profileId }
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status === 400) {
      throw promptRejection(error)
    }
    try {
      const probe = await inspectComfyUiPrompt(baseUrl, promptId)
      if (probe.status !== 'missing') {
        return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:VIDEO:${promptId}`, endpoint: built.profileId }
      }
    } catch { /* Preserve the original accepted/unknown boundary below. */ }
    throw new Error(
      `COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export type ComfyUiPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; videoUrl: string }
  | { status: 'failed'; failure: FailureRecord }

export async function pollComfyUiH3Video(promptId: string): Promise<ComfyUiPollResult> {
  const baseUrl = readComfyUiBaseUrl()
  const inspection = await inspectComfyUiPrompt(baseUrl, promptId)
  if (inspection.status === 'pending') return inspection
  if (inspection.status === 'missing') throw new Error('COMFYUI_PROMPT_NOT_FOUND')
  if (inspection.status === 'failed') {
    return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(inspection.details), cause: inspection.details }) }
  }
  const output = readComfyUiOutput(inspection.outputs)
  if (!output) throw new Error('COMFYUI_VIDEO_OUTPUT_MISSING')
  return {
    status: 'completed',
    videoUrl: await readComfyUiOutputData({
      baseUrl,
      output,
      contentType: 'video/mp4',
      maxBytes: COMFYUI_H3_MAX_VIDEO_BYTES,
      label: 'ComfyUI H3 video',
    }),
  }
}

export async function cancelComfyUiH3Video(promptId: string): Promise<void> {
  try {
    await cancelComfyUiQueuedPrompt(readComfyUiBaseUrl(), promptId)
  } catch (error) {
    if (error instanceof Error && /COMFYUI_HTTP_(400|404)/u.test(error.message)) return
    throw error
  }
}
