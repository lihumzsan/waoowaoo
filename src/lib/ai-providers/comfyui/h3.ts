import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppError } from '@/lib/errors/app-error'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { resolveVideoInputPolicySelection } from '@/lib/ai-registry/video-input-policy'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderVideoExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { FailureRecord } from '@/lib/errors/failure'
import { MAX_VIDEO_BYTES } from '@/lib/http/body-size-constants'
import { readOwnedImageBytesForGeneration } from '@/lib/media/outbound-image'
import { readOwnedMediaBytesForGeneration } from '@/lib/media/outbound-owned-media'
import {
  MAX_VIDEO_REFERENCE_AUDIO_BYTES,
  VIDEO_REFERENCE_AUDIO_MIME_TYPES,
  normalizeVideoReferenceAudioMimeType,
} from '@/lib/media/outbound-audio'
import { extractH3ContinuationGuide } from '@/lib/video-compose/h3-continuation'
import { H3_CONTINUATION_GUIDE_FRAMES } from '@/lib/video-generation/h3-timeline'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-prompt'
import { resolveH3DurationPlan } from '@/lib/video-generation/h3-duration'
import { resolveVideoInputMode, type VideoInputReference } from '@/lib/video-generation/input-mode'
import { resolveComfyUiRuntimeTarget } from './config'
import { formatComfyUiExternalId } from './external-id'
import { COMFYUI_H3_MODEL_ID } from './models'
import { deriveComfyUiProfileRequirements, type ComfyUiProfileRequirementOption } from './profile-requirements'
import {
  H3_CONTINUATION_DUAL_STAGE_PROFILE_ID,
  H3_AUDIO_VAE_NAME,
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  H3_MAX_REFERENCE_AUDIOS,
  H3_MAX_REFERENCE_IMAGES,
  H3_REFERENCE_DUAL_STAGE_PROFILE_ID,
  buildH3PromptGraph,
  resolveH3Dimensions,
  type H3AspectRatio,
  type H3DualStageRuntimeProfile,
} from './profiles'
import {
  uploadH3ContinuationFrames,
  uploadH3ReferenceAudios,
  uploadH3ReferenceImages,
  type H3ReferenceAudioFile,
  type H3ReferenceImageFile,
} from './h3-input-upload'
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
const H3_REFERENCE_NODE_INPUT_TYPES = {
  LoadImage: {
    image: { location: 'required', type: null },
  },
  MiniMaxH3AudioConditioningT8: {
    clip: { location: 'required', type: 'CLIP' },
    video_vae: { location: 'required', type: 'VAE' },
    audio_vae: { location: 'required', type: 'VAE' },
    prompt: { location: 'required', type: 'STRING' },
    width: { location: 'required', type: 'INT' },
    height: { location: 'required', type: 'INT' },
    length: { location: 'required', type: 'INT' },
  },
  MiniMaxH3LearnedLatentUpscaleT8Advanced: {
    av_latent: { location: 'required', type: 'LATENT' },
    scale_by: { location: 'required', type: 'FLOAT' },
    target_megapixels: { location: 'required', type: 'FLOAT' },
    target_width: { location: 'required', type: 'INT' },
    target_height: { location: 'required', type: 'INT' },
    max_anisotropy: { location: 'required', type: 'FLOAT' },
  },
  MiniMaxH3AVDecodeT8: {
    av_latent: { location: 'required', type: 'LATENT' },
    video_vae: { location: 'required', type: 'VAE' },
    audio_vae: { location: 'required', type: 'VAE' },
  },
  ImageResizeKJv2: {
    width: { location: 'required', type: 'INT' },
    height: { location: 'required', type: 'INT' },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, H3NodeInputContract>>>>
const H3_REFERENCE_AUDIO_NODE_INPUT_TYPES = {
  LoadAudio: {
    audio: { location: 'required', type: null },
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
  const modelOption = new Set([
    'UNETLoader:unet_name',
    'CLIPLoader:clip_name',
    'VAELoader:vae_name',
    'LoraLoaderModelOnly:lora_name',
    'LoraLoaderBypassModelOnly:lora_name',
    'MiniMaxH3LearnedLatentUpscaleT8Advanced:model_name',
  ]).has(`${option.classType}:${option.inputName}`)
  if (modelOption) {
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

function assertReferenceAutogrowInputContract(input: {
  readonly info: unknown
  readonly inputName: 'ref_images' | 'ref_audios'
  readonly itemName: 'ref_image' | 'ref_audio'
  readonly itemType: 'IMAGE' | 'AUDIO'
  readonly prefix: 'ref_image_' | 'ref_audio_'
  readonly minimumMaximum: number
}): void {
  const className = 'MiniMaxH3AudioConditioningT8'
  const node = asComfyUiRecord(asComfyUiRecord(input.info)?.[className])
  const nodeInput = asComfyUiRecord(node?.input)
  const optional = asComfyUiRecord(nodeInput?.optional)
  const definition = optional?.[input.inputName]
  const options = Array.isArray(definition) ? asComfyUiRecord(definition[1]) : null
  const template = asComfyUiRecord(options?.template)
  const templateInput = asComfyUiRecord(template?.input)
  const templateRequired = asComfyUiRecord(templateInput?.required)
  const itemDefinition = templateRequired?.[input.itemName]
  if (
    !Array.isArray(definition)
    || definition[0] !== 'COMFY_AUTOGROW_V3'
    || !Array.isArray(itemDefinition)
    || itemDefinition[0] !== input.itemType
    || template?.prefix !== input.prefix
    || typeof template.max !== 'number'
    || template.max < input.minimumMaximum
  ) {
    throw new Error(`COMFYUI_NODE_INPUT_INCOMPATIBLE:${className}:${input.inputName}:${input.itemType}`)
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

function assertReferenceT8GraphContract(profile: H3DualStageRuntimeProfile): void {
  if (profile.id !== H3_REFERENCE_DUAL_STAGE_PROFILE_ID) return
  const imageNodeId = profile.referenceImageNodeIds[0]
  const audioNodeId = profile.referenceAudioNodeIds[0]
  const imageNode = imageNodeId ? profile.workflow[imageNodeId] : undefined
  const audioNode = audioNodeId ? profile.workflow[audioNodeId] : undefined
  const audioVaeNode = profile.workflow[profile.audioVaeNodeId]
  const audioDecodeNode = profile.workflow[profile.audioDecodeNodeId]
  const learnedUpscaleNode = profile.workflow[profile.learnedUpscaleNodeId]
  const finalUpscaleNode = profile.workflow[profile.finalUpscaleNodeId]
  const outputNode = profile.workflow[profile.outputNodeId]
  const conditioningNodes = profile.conditioningNodeIds.map((nodeId) => profile.workflow[nodeId])
  if (!imageNode || imageNode.class_type !== 'LoadImage' || typeof imageNode.inputs.image !== 'string') {
    throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:LoadImage')
  }
  if (!audioNode || audioNode.class_type !== 'LoadAudio' || typeof audioNode.inputs.audio !== 'string') {
    throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:LoadAudio')
  }
  if (audioVaeNode?.class_type !== 'VAELoader' || audioVaeNode.inputs.vae_name !== H3_AUDIO_VAE_NAME) {
    throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:audio_vae')
  }
  if (conditioningNodes.some((node) => node?.class_type !== 'MiniMaxH3AudioConditioningT8')) {
    throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:conditioning')
  }
  for (const node of conditioningNodes) {
    const audioVae = node?.inputs.audio_vae
    const prompt = node?.inputs.prompt
    const referenceImage = node?.inputs['ref_images.ref_image_0']
    const referenceAudio = node?.inputs['ref_audios.ref_audio_0']
    if (!Array.isArray(audioVae) || audioVae[0] !== profile.audioVaeNodeId || audioVae[1] !== 0) {
      throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:conditioning_audio_vae')
    }
    if (!Array.isArray(prompt) || prompt[0] !== profile.promptNodeId || prompt[1] !== 0) {
      throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:conditioning_prompt')
    }
    if (!Array.isArray(referenceImage) || referenceImage[0] !== imageNodeId || referenceImage[1] !== 0) {
      throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:ref_images')
    }
    if (!Array.isArray(referenceAudio) || referenceAudio[0] !== audioNodeId || referenceAudio[1] !== 0) {
      throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:ref_audios')
    }
  }
  if (
    conditioningNodes[0]?.inputs.length !== conditioningNodes[1]?.inputs.length
    || learnedUpscaleNode?.class_type !== 'MiniMaxH3LearnedLatentUpscaleT8Advanced'
    || learnedUpscaleNode.inputs.size_mode !== 'target_megapixels'
    || learnedUpscaleNode.inputs.aspect_policy !== 'preserve_source'
  ) {
    throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:two_pass')
  }
  if (
    audioDecodeNode?.class_type !== 'MiniMaxH3AVDecodeT8'
    || finalUpscaleNode?.class_type !== 'ImageResizeKJv2'
    || finalUpscaleNode.inputs.upscale_method !== 'nvidia_rtx_vsr'
    || outputNode?.class_type !== 'VHS_VideoCombine'
    || !Array.isArray(outputNode.inputs.images)
    || outputNode.inputs.images[0] !== profile.finalUpscaleNodeId
    || outputNode.inputs.images[1] !== 0
    || !Array.isArray(outputNode.inputs.audio)
    || outputNode.inputs.audio[0] !== profile.audioDecodeNodeId
    || outputNode.inputs.audio[1] !== 1
    || outputNode.inputs.format !== 'video/h264-mp4'
    || outputNode.inputs.pix_fmt !== 'yuv420p'
    || outputNode.inputs.crf !== 10
    || outputNode.inputs.frame_rate !== 24
  ) {
    throw new Error('COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:output')
  }
}

async function preflight(
  baseUrl: string,
  profile: H3DualStageRuntimeProfile,
  requiresReferenceAudio: boolean,
): Promise<void> {
  assertContinuationGraphContract(profile)
  assertReferenceT8GraphContract(profile)
  const requirements = deriveComfyUiProfileRequirements({
    profileId: profile.id,
    graph: profile.workflow,
  })
  const requiredNodeClasses = profile.id === H3_REFERENCE_DUAL_STAGE_PROFILE_ID && !requiresReferenceAudio
    ? requirements.nodeClasses.filter((className) => className !== 'LoadAudio')
    : requirements.nodeClasses
  const cacheKey = `${baseUrl}\u0000${requirements.fingerprint}\u0000reference-audio:${String(requiresReferenceAudio)}`
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
  const requiredInfos = await Promise.all(requiredNodeClasses.map(async (className) => ({
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
  if (profile.id === H3_REFERENCE_DUAL_STAGE_PROFILE_ID) {
    const infoByClassName = new Map(
      requiredInfos.map(({ className, info }) => [className, info]),
    )
    for (const [className, inputs] of Object.entries(H3_REFERENCE_NODE_INPUT_TYPES)) {
      assertNodeInputContract(infoByClassName.get(className), className, inputs)
    }
    const conditioningInfo = infoByClassName.get('MiniMaxH3AudioConditioningT8')
    assertReferenceAutogrowInputContract({
      info: conditioningInfo,
      inputName: 'ref_images',
      itemName: 'ref_image',
      itemType: 'IMAGE',
      prefix: 'ref_image_',
      minimumMaximum: H3_MAX_REFERENCE_IMAGES,
    })
    if (requiresReferenceAudio) {
      for (const [className, inputs] of Object.entries(H3_REFERENCE_AUDIO_NODE_INPUT_TYPES)) {
        assertNodeInputContract(infoByClassName.get(className), className, inputs)
      }
      assertReferenceAutogrowInputContract({
        info: conditioningInfo,
        inputName: 'ref_audios',
        itemName: 'ref_audio',
        itemType: 'AUDIO',
        prefix: 'ref_audio_',
        minimumMaximum: H3_MAX_REFERENCE_AUDIOS,
      })
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

function normalizedMediaUrls(
  values: readonly string[] | undefined,
  label: 'image' | 'audio',
): string[] {
  if (!values) return []
  const urls = values.map((url) => url.trim())
  if (urls.some((url) => !url)) {
    throw new AppError('INVALID_PARAMS', `ComfyUI H3 reference ${label} URLs must be non-empty`, { provider: 'comfyui' })
  }
  return urls
}

function continuationPlaceholderFilenames(promptId: string): readonly string[] {
  return Array.from({ length: H3_CONTINUATION_GUIDE_FRAMES }, (_, index) => (
    `waoowaoo/${promptId}/continuation-${String(index).padStart(2, '0')}.png`
  ))
}

function referenceInputPlaceholderFilenames(
  promptId: string,
  count: number,
  mediaType: 'image' | 'audio',
): readonly string[] {
  return Array.from({ length: count }, (_, index) => (
    `waoowaoo/${promptId}/reference-${mediaType}-${String(index).padStart(2, '0')}.${mediaType === 'image' ? 'png' : 'mp3'}`
  ))
}

type H3PreparedInputs = {
  readonly continuationFrameFilenames: readonly string[]
  readonly referenceImageFilenames: readonly string[]
  readonly referenceAudioFilenames: readonly string[]
}

async function readH3ReferenceImageFiles(input: {
  readonly urls: readonly string[]
  readonly userId: string
}): Promise<readonly H3ReferenceImageFile[]> {
  const files: H3ReferenceImageFile[] = []
  for (const url of input.urls) {
    const media = await readOwnedImageBytesForGeneration(url, input.userId)
    files.push({
      bytes: media.bytes,
      contentType: media.contentType,
      extension: media.contentType === 'image/jpeg'
        ? 'jpg'
        : media.contentType === 'image/png'
          ? 'png'
          : 'webp',
    })
  }
  return files
}

async function readH3ReferenceAudioFiles(input: {
  readonly urls: readonly string[]
  readonly userId: string
}): Promise<readonly H3ReferenceAudioFile[]> {
  return await Promise.all(input.urls.map(async (url): Promise<H3ReferenceAudioFile> => {
    const media = await readOwnedMediaBytesForGeneration(url, input.userId, {
      maxBytes: MAX_VIDEO_REFERENCE_AUDIO_BYTES,
      label: 'owned H3 reference audio',
      supportedMimeTypes: VIDEO_REFERENCE_AUDIO_MIME_TYPES,
      normalizeMimeType: normalizeVideoReferenceAudioMimeType,
      requireDetectedMimeType: true,
    })
    if (media.contentType !== 'audio/mpeg' && media.contentType !== 'audio/wav') {
      throw new Error(`COMFYUI_H3_REFERENCE_AUDIO_FORMAT_UNSUPPORTED:${media.contentType}`)
    }
    return {
      bytes: new Uint8Array(media.bytes),
      contentType: media.contentType,
      extension: media.contentType === 'audio/mpeg' ? 'mp3' : 'wav',
    }
  }))
}

function buildGraph(
  input: AiProviderVideoExecutionContext,
  promptId: string,
  prepared: H3PreparedInputs,
) {
  requireSelection(input)
  const options = input.options ?? {}
  if (options.generateAudio !== true) throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires generateAudio=true', { provider: 'comfyui' })
  if (options.referenceVideos?.length) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 does not accept reference video', { provider: 'comfyui' })
  }
  const referenceImageUrls = normalizedMediaUrls(options.referenceImages, 'image')
  const referenceAudioUrls = normalizedMediaUrls(options.referenceAudios, 'audio')
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
    ...referenceAudioUrls.map(() => ({ channel: 'audio' as const, role: 'reference_audio' })),
    ...(firstFrameUrl ? [{ channel: 'image' as const, role: 'first_frame' }] : []),
    ...(lastFrameUrl ? [{ channel: 'image' as const, role: 'last_frame' }] : []),
    ...(continuationVideoUrl ? [{ channel: 'video' as const, role: 'continuation_video' }] : []),
  ]
  const inputMode = resolveVideoInputMode(references).mode
  if (inputMode === 'text_to_video') {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires explicit media input', { provider: 'comfyui' })
  }
  if (referenceAudioUrls.length > 0 && referenceImageUrls.length === 0) {
    throw new AppError('INVALID_PARAMS', 'ComfyUI H3 reference audio requires a reference image', { provider: 'comfyui' })
  }
  const duration = options.duration
  const aspectRatio = options.aspectRatio
  if (typeof duration !== 'number' || !Number.isInteger(duration) || typeof aspectRatio !== 'string') throw new AppError('INVALID_PARAMS', 'ComfyUI H3 requires duration and aspectRatio', { provider: 'comfyui' })
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', COMFYUI_H3_MODEL_KEY)?.video
  if (!capabilities) throw new Error(`CAPABILITY_MODEL_UNSUPPORTED:${COMFYUI_H3_MODEL_KEY}`)
  resolveVideoInputPolicySelection({
    capabilities,
    inputMode,
    requestedDurationSeconds: duration,
    aspectRatio,
  })
  const durationPlan = resolveH3DurationPlan({
    inputMode,
    requestedDurationSeconds: duration,
  })
  const seed = Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16)
  const prompt = options.prompt?.trim() || ''
  assertVideoPromptMatchesProfile({
    profile: 'minimax_h3_multimodal_v3',
    prompt,
    inputMode,
    timelineDurationSeconds: durationPlan.promptEndSeconds,
    references: {
      pictureCount: inputMode === 'reference'
        ? referenceImageUrls.length
        : inputMode === 'first_last_frame'
          ? 2
          : inputMode === 'first_frame'
            ? 1
            : 0,
      audioCount: referenceAudioUrls.length,
    },
  })
  const common = {
    prompt,
    frameCount: durationPlan.frameCount,
    aspectRatio: aspectRatio as H3AspectRatio,
    seed,
  }
  if (inputMode === 'reference') {
    return { ...buildH3PromptGraph({
      mode: 'reference',
      prompt,
      requestedDurationSeconds: duration,
      aspectRatio: aspectRatio as H3AspectRatio,
      seed,
      referenceImageFilenames: prepared.referenceImageFilenames,
      referenceAudioFilenames: prepared.referenceAudioFilenames,
    }), inputMode, referenceAudioUrls }
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
      continuationFrameFilenames: prepared.continuationFrameFilenames,
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
    const referenceImageUrls = normalizedMediaUrls(input.options?.referenceImages, 'image')
    const referenceAudioUrls = normalizedMediaUrls(input.options?.referenceAudios, 'audio')
    const initialPreparedInputs: H3PreparedInputs = {
      continuationFrameFilenames: continuationPlaceholderFilenames(promptId),
      referenceImageFilenames: referenceInputPlaceholderFilenames(promptId, referenceImageUrls.length, 'image'),
      referenceAudioFilenames: referenceInputPlaceholderFilenames(promptId, referenceAudioUrls.length, 'audio'),
    }
    built = buildGraph(input, promptId, initialPreparedInputs)
    await preflight(
      target.baseUrl,
      built.profile,
      built.inputMode === 'reference' && built.referenceAudioUrls.length > 0,
    )
    if (built.inputMode === 'reference') {
      const imageFiles = await readH3ReferenceImageFiles({
        urls: referenceImageUrls,
        userId: input.userId,
      })
      const audioFiles = await readH3ReferenceAudioFiles({
        urls: built.referenceAudioUrls,
        userId: input.userId,
      })
      const uploadedImages = await uploadH3ReferenceImages({
        baseUrl: target.baseUrl,
        promptId,
        files: imageFiles,
      })
      const uploadedAudios = await uploadH3ReferenceAudios({
        baseUrl: target.baseUrl,
        promptId,
        files: audioFiles,
      })
      built = buildGraph(input, promptId, {
        ...initialPreparedInputs,
        referenceImageFilenames: uploadedImages,
        referenceAudioFilenames: uploadedAudios,
      })
    }
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
      built = buildGraph(input, promptId, {
        ...initialPreparedInputs,
        continuationFrameFilenames: uploaded,
      })
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
