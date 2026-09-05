import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppError } from '@/lib/errors/app-error'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderVideoExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { FailureRecord } from '@/lib/errors/failure'
import { MAX_VIDEO_BYTES } from '@/lib/http/body-size-constants'
import { readOwnedMediaBytesForGeneration } from '@/lib/media/outbound-owned-media'
import { extractH3ContinuationGuide } from '@/lib/video-compose/h3-continuation'
import { H3_CONTINUATION_GUIDE_FRAMES } from '@/lib/video-generation/h3-timeline'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-prompt'
import {
  resolveH3ContinuationDurationPlan,
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'
import { resolveVideoInputMode, type VideoInputReference } from '@/lib/video-generation/input-mode'
import { resolveComfyUiRuntimeTarget } from './config'
import { formatComfyUiExternalId } from './external-id'
import { COMFYUI_H3_MODEL_ID } from './models'
import { deriveComfyUiProfileRequirements, type ComfyUiProfileRequirementOption } from './profile-requirements'
import {
  H3_CONTINUATION_DUAL_STAGE_PROFILE_ID,
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
  resolveH3Dimensions,
  type H3AspectRatio,
  type H3DualStageRuntimeProfile,
} from './profiles'
import { uploadH3ContinuationFrames } from './h3-input-upload'
import {
  asComfyUiRecord,
  COMFYUI_ACCEPTED_JOB_STATUSES,
  ComfyUiHttpError,
  downloadComfyUiOutputToTemporaryFile,
  readComfyUiDeclaredNodeVideoOutput,
  readComfyUiHttpError,
  readComfyUiRequiredOptions,
  readComfyUiString,
  requestComfyUiJson,
} from './transport'

export const COMFYUI_H3_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`
export const COMFYUI_H3_RUNTIME_TARGET_ID = 'h3-dual-stage-2mp' as const
const H3_PREFLIGHT_CACHE_TTL_MS = 30_000
const preflightReadyAtByTargetProfile = new Map<string, number>()
type H3NodeInputSchemaLocation = 'required' | 'optional'
type H3NodeInputContract = Readonly<{
  location: H3NodeInputSchemaLocation
  type: string | null
}>
const H3_CONTINUATION_NODE_INPUT_TYPES = {
  LoadImage: {
    image: { location: 'required', type: null },
  },
  ImageBatch: {
    image1: { location: 'required', type: 'IMAGE' },
    image2: { location: 'required', type: 'IMAGE' },
  },
  MiniMaxH3AddGuide: {
    positive: { location: 'required', type: 'CONDITIONING' },
    latent: { location: 'required', type: 'LATENT' },
    vae: { location: 'optional', type: 'VAE' },
    image: { location: 'optional', type: 'IMAGE' },
    frame_idx: { location: 'required', type: 'INT' },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, H3NodeInputContract>>>>

function preAcceptRejected(error: unknown): ProviderSubmissionError {
  const message = error instanceof Error ? error.message : String(error)
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', message.slice(0, 512), {
    disposition: 'pre_accept_rejected', provider: 'comfyui', externalId: null,
    details: error instanceof ComfyUiHttpError ? { httpStatus: error.status, payload: error.payload } : { diagnostic: message.slice(0, 512) },
    cause: error,
  })
}

function promptRejection(error: ComfyUiHttpError): ProviderSubmissionError {
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', readComfyUiHttpError(error.payload), {
    disposition: 'rejected', provider: 'comfyui', externalId: null,
    details: { httpStatus: error.status, payload: error.payload }, cause: error,
  })
}

function missingOptionError(option: ComfyUiProfileRequirementOption): Error {
  if (['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly'].includes(option.classType)) {
    return new Error(`COMFYUI_MODEL_MISSING:${option.value}`)
  }
  return new Error(`COMFYUI_OPTION_MISSING:${option.classType}:${option.inputName}:${option.value}`)
}

function assertNodeInputContract(
  info: unknown,
  className: string,
  inputs: Readonly<Record<string, H3NodeInputContract>>,
): void {
  const node = asComfyUiRecord(asComfyUiRecord(info)?.[className])
  const input = asComfyUiRecord(node?.input)
  for (const [inputName, contract] of Object.entries(inputs)) {
    const schema = asComfyUiRecord(input?.[contract.location])
    const definition = schema?.[inputName]
    if (
      !Array.isArray(definition)
      || definition.length === 0
      || (contract.type !== null && definition[0] !== contract.type)
    ) {
      throw new Error(`COMFYUI_NODE_INPUT_INCOMPATIBLE:${className}:${inputName}:${contract.type ?? contract.location}`)
    }
  }
}

function assertContinuationGraphContract(profile: H3DualStageRuntimeProfile): void {
  if (profile.id !== H3_CONTINUATION_DUAL_STAGE_PROFILE_ID) return
  const guide = profile.workflow[profile.continuationGuideNodeId]
  if (!guide || guide.class_type !== 'MiniMaxH3AddGuide') {
    throw new Error('COMFYUI_H3_CONTINUATION_GRAPH_INCOMPATIBLE:guide')
  }
  const image = guide.inputs.image
  const expectedImageNodeId = profile.continuationBatchNodeIds.at(-1)
  if (!Array.isArray(image) || image[0] !== expectedImageNodeId || image[1] !== 0) {
    throw new Error('COMFYUI_H3_CONTINUATION_GRAPH_INCOMPATIBLE:image')
  }
  const vae = guide.inputs.vae
  if (
    !Array.isArray(vae)
    || typeof vae[0] !== 'string'
    || vae[1] !== 0
    || profile.workflow[vae[0]]?.class_type !== 'VAELoader'
  ) {
    throw new Error('COMFYUI_H3_CONTINUATION_GRAPH_INCOMPATIBLE:vae')
  }
}

async function preflight(
  baseUrl: string,
  profile: H3DualStageRuntimeProfile,
): Promise<void> {
  assertContinuationGraphContract(profile)
  const requirements = deriveComfyUiProfileRequirements({
    profileId: profile.id,
    graph: profile.workflow,
  })
  const cacheKey = `${baseUrl}\u0000${requirements.fingerprint}`
  const now = Date.now()
  if ((preflightReadyAtByTargetProfile.get(cacheKey) ?? 0) + H3_PREFLIGHT_CACHE_TTL_MS > now) return
  const infoByClassName = new Map<string, Promise<unknown>>()
  const readInfo = (className: string): Promise<unknown> => {
    const existing = infoByClassName.get(className)
    if (existing) return existing
    const requested = requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    infoByClassName.set(className, requested)
    return requested
  }
  const requiredInfos = await Promise.all(requirements.nodeClasses.map(async (className) => ({
    className,
    info: await readInfo(className),
  })))
  for (const { className, info } of requiredInfos) {
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  }
  if (profile.id === H3_CONTINUATION_DUAL_STAGE_PROFILE_ID) {
    const infoByClassName = new Map(
      requiredInfos.map(({ className, info }) => [className, info]),
    )
    for (const [className, inputs] of Object.entries(H3_CONTINUATION_NODE_INPUT_TYPES)) {
      assertNodeInputContract(infoByClassName.get(className), className, inputs)
    }
  }
  const optionInfos = await Promise.all(requirements.options.map(async (option) => ({
    option,
    info: await readInfo(option.classType),
  })))
  for (const { option, info } of optionInfos) {
    if (!readComfyUiRequiredOptions(info, option.classType, option.inputName).includes(option.value)) {
      throw missingOptionError(option)
    }
  }
  preflightReadyAtByTargetProfile.set(cacheKey, now)
}

function requireSelection(input: AiProviderVideoExecutionContext): void {
  if (input.selection.provider !== 'comfyui' || input.selection.modelId !== COMFYUI_H3_MODEL_ID || input.selection.modelKey !== COMFYUI_H3_MODEL_KEY) throw new AppError('INVALID_PARAMS', `Unsupported ComfyUI H3 model: ${input.selection.modelKey}`, { provider: 'comfyui' })
}

function normalizedReferenceUrls(values: readonly string[] | undefined): string[] {
  if (!values) return []
  const urls = values.map((url) => url.trim())
  if (urls.some((url) => !url)) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 reference image URLs must be non-empty', { provider: 'comfyui' })
  }
  return urls
}

function continuationPlaceholderFilenames(promptId: string): readonly string[] {
  return Array.from({ length: H3_CONTINUATION_GUIDE_FRAMES }, (_, index) => (
    `waoowaoo/${promptId}/continuation-${String(index).padStart(2, '0')}.png`
  ))
}

function buildGraph(
  input: AiProviderVideoExecutionContext,
  promptId: string,
  continuationFrameFilenames: readonly string[] = continuationPlaceholderFilenames(promptId),
) {
  requireSelection(input)
  const options = input.options ?? {}
  if (options.generateAudio !== true) throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires generateAudio=true', { provider: 'comfyui' })
  if (options.referenceAudios?.length || options.referenceVideos?.length) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 does not accept reference audio or video', { provider: 'comfyui' })
  }
  const referenceImageUrls = normalizedReferenceUrls(options.referenceImages)
  const firstFrameUrl = input.imageUrl.trim()
  const lastFrameUrl = options.lastFrameImageUrl?.trim() ?? ''
  const continuationVideoUrl = options.continuationVideoUrl?.trim() ?? ''
  if (options.lastFrameImageUrl !== undefined && !lastFrameUrl) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 last frame URL must be non-empty', { provider: 'comfyui' })
  }
  if (options.continuationVideoUrl !== undefined && !continuationVideoUrl) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 continuation video URL must be non-empty', { provider: 'comfyui' })
  }
  const references: VideoInputReference[] = [
    ...referenceImageUrls.map(() => ({ channel: 'image' as const, role: 'reference_image' })),
    ...(firstFrameUrl ? [{ channel: 'image' as const, role: 'first_frame' }] : []),
    ...(lastFrameUrl ? [{ channel: 'image' as const, role: 'last_frame' }] : []),
    ...(continuationVideoUrl ? [{ channel: 'video' as const, role: 'continuation_video' }] : []),
  ]
  const inputMode = resolveVideoInputMode(references).mode
  if (inputMode === 'text_to_video') {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires explicit media input', { provider: 'comfyui' })
  }
  const duration = options.duration
  const aspectRatio = options.aspectRatio
  if (typeof duration !== 'number' || !Number.isInteger(duration) || typeof aspectRatio !== 'string') throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires duration and aspectRatio', { provider: 'comfyui' })
  const durationPlan = inputMode === 'continuation'
    ? resolveH3ContinuationDurationPlan(duration)
    : resolveH3DurationPlan(duration)
  const seed = Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16)
  const prompt = options.prompt?.trim() || ''
  assertVideoPromptMatchesProfile({
    profile: 'minimax_h3_multimodal_v3',
    prompt,
    inputMode,
    timelineDurationSeconds: durationPlan.promptEndSeconds,
  })
  const common = {
    prompt,
    frameCount: durationPlan.frameCount,
    aspectRatio: aspectRatio as H3AspectRatio,
    seed,
  }
  if (inputMode === 'reference') {
    return { ...buildH3PromptGraph({
      ...common,
      mode: 'reference',
      referenceImageUrls,
      referenceAudioFilenames: [],
    }), inputMode }
  }
  if (inputMode === 'first_frame') {
    return { ...buildH3PromptGraph({
      ...common,
      mode: 'first_frame',
      firstFrameUrl,
    }), inputMode }
  }
  if (inputMode === 'first_last_frame') {
    return { ...buildH3PromptGraph({
      ...common,
      mode: 'first_last_frame',
      firstFrameUrl,
      lastFrameUrl,
    }), inputMode }
  }
  return {
    ...buildH3PromptGraph({
      ...common,
      mode: 'continuation',
      continuationFrameFilenames,
    }),
    inputMode,
    continuationVideoUrl,
  }
}

export async function executeComfyUiH3VideoGeneration(input: AiProviderVideoExecutionContext): Promise<GenerateResult> {
  const promptId = crypto.randomUUID()
  let target: ReturnType<typeof resolveComfyUiRuntimeTarget>
  let built: ReturnType<typeof buildGraph>
  let continuationWorkspaceDir: string | null = null
  try {
    target = resolveComfyUiRuntimeTarget(COMFYUI_H3_RUNTIME_TARGET_ID)
    built = buildGraph(input, promptId)
    await preflight(target.baseUrl, built.profile)
    if (built.inputMode === 'continuation') {
      const media = await readOwnedMediaBytesForGeneration(
        built.continuationVideoUrl,
        input.userId,
        {
          maxBytes: MAX_VIDEO_BYTES,
          label: 'owned H3 continuation video',
          supportedMimeTypes: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
        },
      )
      continuationWorkspaceDir = await mkdtemp(
        path.join(tmpdir(), `waoowaoo-h3-continuation-${promptId}-`),
      )
      const sourcePath = path.join(continuationWorkspaceDir, 'source-video')
      await writeFile(sourcePath, media.bytes)
      const dimensions = resolveH3Dimensions({
        megapixels: 1,
        aspectRatio: input.options!.aspectRatio as H3AspectRatio,
      })
      const framePaths = await extractH3ContinuationGuide({
        inputPath: sourcePath,
        workspaceDir: path.join(continuationWorkspaceDir, 'guide'),
        ...dimensions,
      })
      const uploaded = await uploadH3ContinuationFrames({
        baseUrl: target.baseUrl,
        promptId,
        framePaths,
      })
      built = buildGraph(input, promptId, uploaded)
    }
  } catch (error) { throw preAcceptRejected(error) }
  finally {
    if (continuationWorkspaceDir) {
      await rm(continuationWorkspaceDir, { recursive: true, force: true })
    }
  }
  try {
    const raw = await requestComfyUiJson(target.baseUrl, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: built.graph, prompt_id: promptId }) })
    if (readComfyUiString(asComfyUiRecord(raw)?.prompt_id) !== promptId) throw new Error('COMFYUI_PROMPT_ID_MISMATCH')
    return { success: true, async: true, requestId: promptId, externalId: formatComfyUiExternalId({ targetId: COMFYUI_H3_RUNTIME_TARGET_ID, type: 'VIDEO', requestId: promptId }), endpoint: COMFYUI_H3_RUNTIME_TARGET_ID }
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status === 400) throw promptRejection(error)
    try {
      const probe = asComfyUiRecord(await requestComfyUiJson(target.baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
      if (COMFYUI_ACCEPTED_JOB_STATUSES.has(readComfyUiString(probe?.status))) return { success: true, async: true, requestId: promptId, externalId: formatComfyUiExternalId({ targetId: COMFYUI_H3_RUNTIME_TARGET_ID, type: 'VIDEO', requestId: promptId }), endpoint: COMFYUI_H3_RUNTIME_TARGET_ID }
      } catch { /* preserve accepted/unknown boundary */ }
      throw new Error(`COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

export type ComfyUiPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; temporaryMediaFile: import('@/lib/ai-providers/async-task-types').AsyncTemporaryMediaFile }
  | { status: 'failed'; failure: FailureRecord }

export async function pollComfyUiH3Video(promptId: string, targetId: string = COMFYUI_H3_RUNTIME_TARGET_ID): Promise<ComfyUiPollResult> {
  if (targetId !== COMFYUI_H3_RUNTIME_TARGET_ID) throw new Error(`COMFYUI_RUNTIME_TARGET_MISMATCH:${COMFYUI_H3_RUNTIME_TARGET_ID}:${targetId}`)
  const baseUrl = resolveComfyUiRuntimeTarget(COMFYUI_H3_RUNTIME_TARGET_ID).baseUrl
  const record = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
  const status = readComfyUiString(record?.status)
  if (status === 'pending') return { status: 'pending', pendingPhase: 'queued' }
  if (status === 'in_progress') return { status: 'pending', pendingPhase: 'running' }
  if (status === 'cancelled') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: 'ComfyUI H3 job was cancelled', cause: record }) }
  if (status === 'failed') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(record?.execution_error), cause: record }) }
  if (status !== 'completed') throw new Error(`COMFYUI_JOB_STATUS_UNKNOWN:${status || '<missing>'}`)
  const output = readComfyUiDeclaredNodeVideoOutput(record?.outputs ?? record?.output, H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId)
  if (!output) throw new Error(`COMFYUI_VIDEO_OUTPUT_MISSING:${H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId}`)
  return { status: 'completed', temporaryMediaFile: await downloadComfyUiOutputToTemporaryFile({ baseUrl, output, contentType: 'video/mp4', maxBytes: MAX_VIDEO_BYTES, label: 'ComfyUI H3 dual-stage video' }) }
}

export async function cancelComfyUiH3Video(promptId: string, targetId: string = COMFYUI_H3_RUNTIME_TARGET_ID): Promise<void> {
  if (targetId !== COMFYUI_H3_RUNTIME_TARGET_ID) throw new Error(`COMFYUI_RUNTIME_TARGET_MISMATCH:${COMFYUI_H3_RUNTIME_TARGET_ID}:${targetId}`)
  const baseUrl = resolveComfyUiRuntimeTarget(COMFYUI_H3_RUNTIME_TARGET_ID).baseUrl
  try {
    await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' })
  } catch (error) {
    if (!(error instanceof ComfyUiHttpError) || error.status !== 400) throw error
    const job = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
    const status = readComfyUiString(job?.status)
    if (status === 'cancelled' || status === 'completed' || status === 'failed') return
    throw new Error(`COMFYUI_CANCEL_REJECTED:${status || '<missing>'}`, { cause: error })
  }
}
