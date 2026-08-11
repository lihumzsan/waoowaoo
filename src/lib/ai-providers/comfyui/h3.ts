import { AppError } from '@/lib/errors/app-error'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderVideoExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { FailureRecord } from '@/lib/errors/failure'
import { readResponseBufferWithLimit } from '@/lib/http/body-limits'
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

export const COMFYUI_H3_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`

const COMFYUI_H3_MAX_VIDEO_BYTES = 100 * 1024 * 1024
const COMFYUI_ACCEPTED_JOB_STATUSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])

class ComfyUiHttpError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, payload: unknown) {
    super(`COMFYUI_HTTP_${status}:${readHttpError(payload)}`)
    this.name = 'ComfyUiHttpError'
    this.status = status
    this.payload = payload
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readHttpError(value: unknown): string {
  const record = asRecord(value)
  return (
    readString(record?.error)
    || readString(record?.message)
    || readString(record?.exception_message)
    || 'ComfyUI request failed'
  ).slice(0, 512)
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}${path}`
}

async function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(buildUrl(baseUrl, path), {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(60_000),
    cache: 'no-store',
  })
  const text = await response.text()
  let payload: unknown = null
  try { payload = text ? JSON.parse(text) as unknown : null } catch { payload = text }
  if (!response.ok) throw new ComfyUiHttpError(response.status, payload)
  return payload
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
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', readHttpError(error.payload), {
    disposition: 'rejected',
    provider: 'comfyui',
    externalId: null,
    details: { httpStatus: error.status, payload: error.payload },
    cause: error,
  })
}

function readOptions(info: unknown, className: string, field: string): string[] {
  const root = asRecord(info)
  const definition = asRecord(root?.[className])
  const input = asRecord(definition?.input)
  const required = asRecord(input?.required)
  const fieldValue = required?.[field]
  if (!Array.isArray(fieldValue) || !Array.isArray(fieldValue[0])) return []
  return fieldValue[0].filter((value): value is string => typeof value === 'string')
}

async function preflight(baseUrl: string): Promise<void> {
  const classes = H3_RUNTIME_PROFILES['h3-fast-first-frame'].requiredNodeClasses
  for (const className of classes) {
    const info = await requestJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  }
  const expectedModels: Array<[string, string, string]> = [
    ['UNETLoader', 'unet_name', H3_MODELS.diffusion],
    ['CLIPLoader', 'clip_name', H3_MODELS.textEncoder],
    ['LoraLoaderBypassModelOnly', 'lora_name', H3_MODELS.turboLora],
    ['VAELoader', 'vae_name', H3_MODELS.videoVae],
    ['VAELoader', 'vae_name', H3_MODELS.audioVae],
  ]
  for (const [className, field, expected] of expectedModels) {
    const info = await requestJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!readOptions(info, className, field).includes(expected)) throw new Error(`COMFYUI_MODEL_MISSING:${expected}`)
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
    const raw = await requestJson(baseUrl, '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: built.graph, prompt_id: promptId }),
    })
    if (readString(asRecord(raw)?.prompt_id) !== promptId) throw new Error('COMFYUI_PROMPT_ID_MISMATCH')
    return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:VIDEO:${promptId}`, endpoint: built.profileId }
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status === 400) {
      throw promptRejection(error)
    }
    try {
      const probe = asRecord(await requestJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
      const status = readString(probe?.status)
      if (COMFYUI_ACCEPTED_JOB_STATUSES.has(status)) {
        return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:VIDEO:${promptId}`, endpoint: built.profileId }
      }
    } catch { /* Preserve the original accepted/unknown boundary below. */ }
    throw new Error(`COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`)
  }
}

type ComfyUiOutput = { filename: string; subfolder: string; type: string }

function readOutput(value: unknown): ComfyUiOutput | null {
  const record = asRecord(value)
  if (!record) return null
  const candidate = asRecord(record['15'] ?? record['16'] ?? record['141'] ?? record.preview_output ?? record.output ?? record)
  if (!candidate) return null
  const nodeId = readString(candidate.nodeId)
  if (nodeId && !['15', '16', '141'].includes(nodeId)) return null
  for (const field of ['gifs', 'videos', 'files']) {
    const list = candidate[field]
    if (!Array.isArray(list)) continue
    const first = asRecord(list[0])
    const filename = readString(first?.filename)
    if (filename) return { filename, subfolder: readString(first?.subfolder), type: readString(first?.type) || 'output' }
  }
  const filename = readString(candidate.filename)
  return filename ? { filename, subfolder: readString(candidate.subfolder), type: readString(candidate.type) || 'output' } : null
}

async function readVideoData(baseUrl: string, output: ComfyUiOutput): Promise<string> {
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type })
  const response = await fetch(buildUrl(baseUrl, `/view?${query.toString()}`), {
    signal: AbortSignal.timeout(120_000),
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`COMFYUI_OUTPUT_HTTP_${response.status}`)
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0]!.trim().toLowerCase()
  if (contentType !== 'video/mp4') throw new Error(`COMFYUI_OUTPUT_CONTENT_TYPE_INVALID:${contentType || '<missing>'}`)
  const buffer = await readResponseBufferWithLimit(response, COMFYUI_H3_MAX_VIDEO_BYTES, 'ComfyUI H3 video')
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

export type ComfyUiPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; videoUrl: string }
  | { status: 'failed'; failure: FailureRecord }

export async function pollComfyUiH3Video(promptId: string): Promise<ComfyUiPollResult> {
  const baseUrl = readComfyUiBaseUrl()
  const raw = await requestJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`)
  const record = asRecord(raw)
  const status = readString(record?.status)
  if (status === 'pending') return { status: 'pending', pendingPhase: 'queued' }
  if (status === 'in_progress') return { status: 'pending', pendingPhase: 'running' }
  if (status === 'cancelled') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: 'ComfyUI H3 job was cancelled', cause: record }) }
  if (status === 'failed') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readHttpError(record?.execution_error), cause: record }) }
  if (status !== 'completed') throw new Error(`COMFYUI_JOB_STATUS_UNKNOWN:${status || '<missing>'}`)
  const output = readOutput(record?.outputs ?? record?.preview_output ?? record?.output)
  if (!output) throw new Error('COMFYUI_VIDEO_OUTPUT_MISSING')
  return { status: 'completed', videoUrl: await readVideoData(baseUrl, output) }
}

export async function cancelComfyUiH3Video(promptId: string): Promise<void> {
  try {
    await requestJson(readComfyUiBaseUrl(), `/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' })
  } catch (error) {
    if (error instanceof Error && /COMFYUI_HTTP_(400|404)/u.test(error.message)) return
    throw error
  }
}
