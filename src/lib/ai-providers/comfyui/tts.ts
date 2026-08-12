import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderVoiceExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { readOwnedMediaBytesForGeneration } from '@/lib/media/outbound-owned-media'
import { readComfyUiDeclaredNodeAudioOutput, readComfyUiOutputData, asComfyUiRecord, readComfyUiHttpError, readComfyUiRequiredOptions, readComfyUiString, requestComfyUiJson, COMFYUI_ACCEPTED_JOB_STATUSES, type ComfyUiOutput, ComfyUiHttpError } from './transport'
import { readComfyUiBaseUrl } from './config'
import { COMFYUI_MOSS_TTS_LOCAL_MODEL_ID, COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY } from './models'
import ttsWorkflow from './workflows/moss-tts-local-1.7b.json'

export const COMFYUI_MOSS_TTS_MAX_AUDIO_BYTES = 25 * 1024 * 1024
const MOSS_TTS_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko'] as const
const MOSS_TTS_LOCAL_MODEL_PATH = 'D:\\workspace\\comfui\\dapao2604\\ComfyUI\\models\\moss-tts\\OpenMOSS-Team--MOSS-TTS-Local-Transformer'
const MOSS_TTS_CODEC_PATH = 'D:\\workspace\\comfui\\dapao2604\\ComfyUI\\models\\moss-tts\\OpenMOSS-Team--MOSS-Audio-Tokenizer'

export type MossTtsProfile = {
  readonly modelId: typeof COMFYUI_MOSS_TTS_LOCAL_MODEL_ID
  readonly workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>
  readonly inputNodeId: '3'
  readonly loaderNodeId: '6'
  readonly generatorNodeId: '7'
  readonly outputNodeId: '5'
  readonly requiredNodeClasses: readonly ['LoadAudio', 'MossTTSModelLoader', 'MossTTSGenerate', 'SaveAudioMP3']
}

export const MOSS_TTS_LOCAL_PROFILE: MossTtsProfile = {
  modelId: COMFYUI_MOSS_TTS_LOCAL_MODEL_ID,
  workflow: ttsWorkflow as MossTtsProfile['workflow'],
  inputNodeId: '3', loaderNodeId: '6', generatorNodeId: '7', outputNodeId: '5',
  requiredNodeClasses: ['LoadAudio', 'MossTTSModelLoader', 'MossTTSGenerate', 'SaveAudioMP3'],
}

function copyGraph(profile: MossTtsProfile) {
  return Object.fromEntries(Object.entries(profile.workflow).map(([id, node]) => [id, {
    class_type: node.class_type,
    inputs: { ...node.inputs },
  }]))
}

export function buildMossTtsPromptGraph(input: {
  readonly text: string
  readonly language: string
  readonly referenceAudio: string
  readonly seed: number
}): { readonly profile: MossTtsProfile; readonly graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> } {
  if (!input.text.trim()) throw new Error('COMFYUI_MOSS_TTS_TEXT_REQUIRED')
  if (!(MOSS_TTS_LANGUAGES as readonly string[]).includes(input.language)) throw new Error('COMFYUI_MOSS_TTS_LANGUAGE_INVALID')
  if (!input.referenceAudio.trim()) throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_REQUIRED')
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_MOSS_TTS_SEED_INVALID')
  const graph = copyGraph(MOSS_TTS_LOCAL_PROFILE)
  graph[MOSS_TTS_LOCAL_PROFILE.inputNodeId]!.inputs.audio = input.referenceAudio
  const generator = graph[MOSS_TTS_LOCAL_PROFILE.generatorNodeId]!
  generator.inputs.text = input.text
  generator.inputs.language = input.language
  generator.inputs.seed = input.seed
  return { profile: MOSS_TTS_LOCAL_PROFILE, graph }
}

function preAcceptRejected(error: unknown): ProviderSubmissionError {
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', (error instanceof Error ? error.message : String(error)).slice(0, 512), {
    disposition: 'pre_accept_rejected', provider: 'comfyui', externalId: null,
    details: error instanceof ComfyUiHttpError ? { httpStatus: error.status, payload: error.payload } : {}, cause: error,
  })
}

function promptRejection(error: ComfyUiHttpError): ProviderSubmissionError {
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', readComfyUiHttpError(error.payload), {
    disposition: 'rejected', provider: 'comfyui', externalId: null,
    details: { httpStatus: error.status, payload: error.payload }, cause: error,
  })
}

async function preflight(baseUrl: string): Promise<void> {
  for (const className of MOSS_TTS_LOCAL_PROFILE.requiredNodeClasses) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  }
  const generatorInfo = await requestComfyUiJson(baseUrl, '/object_info/MossTTSGenerate')
  const languages = readComfyUiRequiredOptions(generatorInfo, 'MossTTSGenerate', 'language')
  if (!MOSS_TTS_LANGUAGES.every((language) => languages.includes(language))) throw new Error('COMFYUI_MOSS_TTS_LANGUAGE_OPTIONS_MISSING')
  const loaderInfo = await requestComfyUiJson(baseUrl, '/object_info/MossTTSModelLoader')
  const modelVariants = readComfyUiRequiredOptions(loaderInfo, 'MossTTSModelLoader', 'model_variant')
  if (!modelVariants.includes('MOSS-TTS (Local 1.7B)')) throw new Error('COMFYUI_MOSS_TTS_LOCAL_MODEL_OPTION_MISSING')
}

async function uploadReferenceAudio(input: { baseUrl: string; userId: string; referenceAudio: string; promptId: string }): Promise<string> {
  const media = await readOwnedMediaBytesForGeneration(input.referenceAudio, input.userId, {
    maxBytes: 15 * 1024 * 1024,
    label: 'owned MOSS TTS reference audio',
    supportedMimeTypes: new Set(['audio/mpeg', 'audio/wav', 'audio/flac']),
    normalizeMimeType: (mime) => mime === 'audio/mp3' ? 'audio/mpeg' : mime,
  })
  const form = new FormData()
  const filename = `waoowaoo-voiceover-${input.promptId}.wav`
  const bytes = new Uint8Array(media.bytes)
  form.append('image', new Blob([bytes], { type: media.contentType }), filename)
  form.append('type', 'input')
  form.append('subfolder', `waoowaoo/${input.promptId}`)
  form.append('overwrite', 'false')
  const response = await fetch(`${input.baseUrl.replace(/\/+$/u, '')}/upload/image`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(120_000), cache: 'no-store',
  })
  const body = await response.text()
  let parsed: unknown = null
  try { parsed = body ? JSON.parse(body) as unknown : null } catch { parsed = body }
  if (!response.ok) throw new ComfyUiHttpError(response.status, parsed)
  const record = asComfyUiRecord(parsed)
  const name = readComfyUiString(record?.name)
  const subfolder = readComfyUiString(record?.subfolder)
  const type = readComfyUiString(record?.type) || 'input'
  if (!name || type !== 'input' || !subfolder.startsWith(`waoowaoo/${input.promptId}`)) throw new Error('COMFYUI_MOSS_TTS_UPLOAD_RESPONSE_INVALID')
  return `${subfolder}/${name}`
}

export function requireMossTtsSelection(input: AiProviderVoiceExecutionContext): void {
  if (input.selection.provider !== 'comfyui' || input.selection.modelKey !== COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY || input.selection.modelId !== COMFYUI_MOSS_TTS_LOCAL_MODEL_ID) throw new Error(`COMFYUI_MOSS_TTS_MODEL_UNSUPPORTED:${input.selection.modelKey}`)
}

export async function executeComfyUiMossTtsGeneration(input: AiProviderVoiceExecutionContext): Promise<GenerateResult> {
  requireMossTtsSelection(input)
  const language = input.options?.language ?? 'auto'
  const referenceAudio = input.options?.referenceAudio
  if (typeof referenceAudio !== 'string' || !referenceAudio.trim()) throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_REQUIRED')
  if (input.options?.outputFormat !== 'mp3') throw new Error('COMFYUI_MOSS_TTS_OUTPUT_FORMAT_INVALID')
  const promptId = crypto.randomUUID()
  const baseUrl = readComfyUiBaseUrl()
  let graph: ReturnType<typeof buildMossTtsPromptGraph>['graph']
  try {
    await preflight(baseUrl)
    const uploaded = await uploadReferenceAudio({ baseUrl, userId: input.userId, referenceAudio, promptId })
    graph = buildMossTtsPromptGraph({ text: input.text, language, referenceAudio: uploaded, seed: Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16) }).graph
    graph[MOSS_TTS_LOCAL_PROFILE.loaderNodeId]!.inputs.local_model_path = MOSS_TTS_LOCAL_MODEL_PATH
    graph[MOSS_TTS_LOCAL_PROFILE.loaderNodeId]!.inputs.codec_local_path = MOSS_TTS_CODEC_PATH
  } catch (error) { throw preAcceptRejected(error) }
  try {
    const raw = await requestComfyUiJson(baseUrl, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, prompt_id: promptId }) })
    if (readComfyUiString(asComfyUiRecord(raw)?.prompt_id) !== promptId) throw new Error('COMFYUI_PROMPT_ID_MISMATCH')
    return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:VOICE:${promptId}`, endpoint: 'moss-tts-local-1.7b' }
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status >= 400 && error.status < 500) throw promptRejection(error)
    try {
      const probe = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
      if (COMFYUI_ACCEPTED_JOB_STATUSES.has(readComfyUiString(probe?.status))) return { success: true, async: true, requestId: promptId, externalId: `COMFYUI:VOICE:${promptId}`, endpoint: 'moss-tts-local-1.7b' }
    } catch { /* preserve unknown boundary */ }
    throw new Error(`COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`)
  }
}

export type MossTtsPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; audioUrl: string }
  | { status: 'failed'; failure: ReturnType<typeof createProviderAsyncTaskFailure> }

export async function pollComfyUiMossTts(promptId: string): Promise<MossTtsPollResult> {
  const baseUrl = readComfyUiBaseUrl()
  const record = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
  const status = readComfyUiString(record?.status)
  if (status === 'pending') return { status: 'pending', pendingPhase: 'queued' }
  if (status === 'in_progress') return { status: 'pending', pendingPhase: 'running' }
  if (status === 'cancelled') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: 'ComfyUI MOSS TTS job was cancelled', cause: record }) }
  if (status === 'failed') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(record?.execution_error), cause: record }) }
  if (status !== 'completed') throw new Error(`COMFYUI_JOB_STATUS_UNKNOWN:${status || '<missing>'}`)
  const output: ComfyUiOutput | null = readComfyUiDeclaredNodeAudioOutput(record?.outputs ?? record?.output, MOSS_TTS_LOCAL_PROFILE.outputNodeId)
  if (!output) throw new Error('COMFYUI_MOSS_TTS_AUDIO_OUTPUT_MISSING')
  return { status: 'completed', audioUrl: await readComfyUiOutputData({ baseUrl, output, contentType: 'audio/mpeg', maxBytes: COMFYUI_MOSS_TTS_MAX_AUDIO_BYTES, label: 'ComfyUI MOSS TTS audio' }) }
}

export async function cancelComfyUiMossTts(promptId: string): Promise<void> {
  try { await requestComfyUiJson(readComfyUiBaseUrl(), `/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' }) } catch (error) {
    if (error instanceof Error && /COMFYUI_HTTP_(400|404)/u.test(error.message)) return
    throw error
  }
}
