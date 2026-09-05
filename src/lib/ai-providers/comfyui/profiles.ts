import dualStageWorkflow from './workflows/h3-dual-stage-2mp.json'
import frameDualStageWorkflow from './workflows/h3-frame-dual-stage-2mp.json'
import { H3_CONTINUATION_GUIDE_FRAMES } from '@/lib/video-generation/h3-timeline'

export const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const
export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]

export type ComfyUiPromptGraph = Record<string, {
  readonly class_type: string
  readonly inputs: Record<string, unknown>
}>

const H3_DELIVERY_SCALE_NUMERATOR = 3
const H3_DELIVERY_SCALE_DENOMINATOR = 2
export const H3_MAX_REFERENCE_IMAGES = 8
export const H3_MAX_REFERENCE_AUDIOS = 3
const H3_REFERENCE_IMAGE_NODE_IDS = ['137', '326', '327', '328', '329', '330', '331', '332'] as const
const H3_REFERENCE_RESIZE_NODE_IDS = ['198', '333', '334', '335', '336', '337', '338', '339'] as const
const H3_REFERENCE_AUDIO_NODE_IDS = ['340', '341', '342'] as const
export const H3_AUDIO_VAE_NAME = 'h3\\minimax_h3_audio_vae_fp32.safetensors' as const

function unsupportedOption(name: string, value: unknown): never {
  throw new Error('COMFYUI_H3_OPTION_UNSUPPORTED:' + name + '=' + String(value))
}
function parseAspectRatio(value: string): [number, number] {
  if (!(H3_ASPECT_RATIOS as readonly string[]).includes(value)) unsupportedOption('aspectRatio', value)
  const [width, height] = value.split(':').map((entry) => Number.parseInt(entry, 10))
  if (!width || !height) throw new Error('COMFYUI_H3_ASPECT_RATIO_INVALID:' + value)
  return [width, height]
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

export function resolveH3Dimensions(input: {
  readonly megapixels: number
  readonly aspectRatio: H3AspectRatio
}): { readonly width: number; readonly height: number } {
  if (input.megapixels !== 1 && input.megapixels !== 2) {
    unsupportedOption('megapixels', input.megapixels)
  }
  const [ratioWidth, ratioHeight] = parseAspectRatio(input.aspectRatio)
  const area = 1024 * 1024
  const width = Math.sqrt(area * (ratioWidth / ratioHeight))
  const height = area / width
  const generationDimensions = {
    width: roundToMultiple(width, 32),
    height: roundToMultiple(height, 32),
  }
  if (input.megapixels === 1) return generationDimensions
  return deriveH3DeliveryDimensions(generationDimensions)
}

function deriveH3DeliveryDimensions(input: {
  readonly width: number
  readonly height: number
}): { readonly width: number; readonly height: number } {
  return {
    width: input.width * H3_DELIVERY_SCALE_NUMERATOR / H3_DELIVERY_SCALE_DENOMINATOR,
    height: input.height * H3_DELIVERY_SCALE_NUMERATOR / H3_DELIVERY_SCALE_DENOMINATOR,
  }
}

export const H3_REFERENCE_DUAL_STAGE_PROFILE_ID = 'h3-reference-dual-stage-2mp' as const
export const H3_FRAME_DUAL_STAGE_PROFILE_ID = 'h3-frame-dual-stage-2mp' as const
export const H3_CONTINUATION_DUAL_STAGE_PROFILE_ID = 'h3-continuation-dual-stage-2mp' as const
export type H3GraphProfileId =
  | typeof H3_REFERENCE_DUAL_STAGE_PROFILE_ID
  | typeof H3_FRAME_DUAL_STAGE_PROFILE_ID
  | typeof H3_CONTINUATION_DUAL_STAGE_PROFILE_ID

type H3RuntimeProfileBase = {
  readonly id: H3GraphProfileId
  readonly workflow: ComfyUiPromptGraph
  readonly promptNodeId: string
  readonly h3NodeId: string
  readonly noiseNodeId: string
  readonly firstUpscaleNodeId: string
  readonly finalUpscaleNodeId: string
  readonly outputNodeId: string
}

export type H3ReferenceDualStageRuntimeProfile = H3RuntimeProfileBase & {
  readonly id: typeof H3_REFERENCE_DUAL_STAGE_PROFILE_ID
  readonly referenceImageNodeIds: readonly string[]
  readonly referenceResizeNodeIds: readonly string[]
  readonly referenceAudioNodeIds: readonly string[]
  readonly audioVaeNodeId: string
  readonly audioDecodeNodeId: string
  readonly audioSamplerNodeId: string
}

export type H3FrameDualStageRuntimeProfile = H3RuntimeProfileBase & {
  readonly id: typeof H3_FRAME_DUAL_STAGE_PROFILE_ID
  readonly firstFrameImageNodeId: string
  readonly firstFrameResizeNodeId: string
  readonly lastFrameImageNodeId: string
  readonly lastFrameResizeNodeId: string
}

export type H3ContinuationDualStageRuntimeProfile = H3RuntimeProfileBase & {
  readonly id: typeof H3_CONTINUATION_DUAL_STAGE_PROFILE_ID
  readonly continuationImageNodeIds: readonly string[]
  readonly continuationBatchNodeIds: readonly string[]
  readonly continuationGuideNodeId: string
}

export type H3DualStageRuntimeProfile =
  | H3ReferenceDualStageRuntimeProfile
  | H3FrameDualStageRuntimeProfile
  | H3ContinuationDualStageRuntimeProfile

export const H3_DUAL_STAGE_RUNTIME_PROFILE: H3ReferenceDualStageRuntimeProfile = {
  id: H3_REFERENCE_DUAL_STAGE_PROFILE_ID,
  workflow: dualStageWorkflow as ComfyUiPromptGraph,
  referenceImageNodeIds: H3_REFERENCE_IMAGE_NODE_IDS,
  referenceResizeNodeIds: H3_REFERENCE_RESIZE_NODE_IDS,
  referenceAudioNodeIds: H3_REFERENCE_AUDIO_NODE_IDS,
  audioVaeNodeId: '120',
  audioDecodeNodeId: '121',
  audioSamplerNodeId: '125',
  promptNodeId: '138',
  h3NodeId: '309',
  noiseNodeId: '129',
  firstUpscaleNodeId: '213',
  finalUpscaleNodeId: '323',
  outputNodeId: '168',
}

export const H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE: H3FrameDualStageRuntimeProfile = {
  id: H3_FRAME_DUAL_STAGE_PROFILE_ID,
  workflow: frameDualStageWorkflow as ComfyUiPromptGraph,
  firstFrameImageNodeId: '137',
  firstFrameResizeNodeId: '198',
  lastFrameImageNodeId: '326',
  lastFrameResizeNodeId: '327',
  promptNodeId: '138',
  h3NodeId: '309',
  noiseNodeId: '129',
  firstUpscaleNodeId: '213',
  finalUpscaleNodeId: '325',
  outputNodeId: '168',
}

const H3_CONTINUATION_IMAGE_NODE_IDS = Array.from(
  { length: H3_CONTINUATION_GUIDE_FRAMES },
  (_, index) => String(400 + index),
)
const H3_CONTINUATION_BATCH_NODE_IDS = Array.from(
  { length: H3_CONTINUATION_GUIDE_FRAMES - 1 },
  (_, index) => String(422 + index),
)
const H3_CONTINUATION_GUIDE_NODE_ID = '443'

function createContinuationWorkflow(): ComfyUiPromptGraph {
  const graph = copyGraph(frameDualStageWorkflow as ComfyUiPromptGraph)
  delete graph['137']
  delete graph['198']
  delete graph['326']
  delete graph['327']
  const h3Node = graph['309']
  if (!h3Node) throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:h3-continuation-dual-stage-2mp')
  delete h3Node.inputs.first_frame
  delete h3Node.inputs.last_frame

  H3_CONTINUATION_IMAGE_NODE_IDS.forEach((nodeId, index) => {
    graph[nodeId] = {
      class_type: 'LoadImage',
      inputs: { image: `continuation-${String(index).padStart(2, '0')}.png` },
    }
  })
  H3_CONTINUATION_BATCH_NODE_IDS.forEach((nodeId, index) => {
    graph[nodeId] = {
      class_type: 'ImageBatch',
      inputs: {
        image1: index === 0
          ? [H3_CONTINUATION_IMAGE_NODE_IDS[0]!, 0]
          : [H3_CONTINUATION_BATCH_NODE_IDS[index - 1]!, 0],
        image2: [H3_CONTINUATION_IMAGE_NODE_IDS[index + 1]!, 0],
      },
    }
  })
  graph[H3_CONTINUATION_GUIDE_NODE_ID] = {
    class_type: 'MiniMaxH3AddGuide',
    inputs: {
      positive: ['309', 0],
      latent: ['309', 1],
      vae: ['119', 0],
      image: [H3_CONTINUATION_BATCH_NODE_IDS.at(-1)!, 0],
      frame_idx: 0,
    },
  }
  for (const guiderNodeId of ['126', '232']) {
    const guider = graph[guiderNodeId]
    if (!guider) throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:h3-continuation-dual-stage-2mp')
    guider.inputs.conditioning = [H3_CONTINUATION_GUIDE_NODE_ID, 0]
  }
  return graph
}

export const H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE: H3ContinuationDualStageRuntimeProfile = {
  id: H3_CONTINUATION_DUAL_STAGE_PROFILE_ID,
  workflow: createContinuationWorkflow(),
  continuationImageNodeIds: H3_CONTINUATION_IMAGE_NODE_IDS,
  continuationBatchNodeIds: H3_CONTINUATION_BATCH_NODE_IDS,
  continuationGuideNodeId: H3_CONTINUATION_GUIDE_NODE_ID,
  promptNodeId: '138',
  h3NodeId: '309',
  noiseNodeId: '129',
  firstUpscaleNodeId: '213',
  finalUpscaleNodeId: '325',
  outputNodeId: '168',
}

type H3PromptGraphCommonInput = {
  readonly prompt: string
  readonly frameCount: number
  readonly aspectRatio: H3AspectRatio
  readonly seed: number
}

export type H3ReferencePromptGraphInput = H3PromptGraphCommonInput & {
  readonly mode: 'reference'
  readonly referenceImageUrls: readonly string[]
  readonly referenceAudioFilenames: readonly string[]
}

export type H3FirstFramePromptGraphInput = H3PromptGraphCommonInput & {
  readonly mode: 'first_frame'
  readonly firstFrameUrl: string
}

export type H3FirstLastFramePromptGraphInput = H3PromptGraphCommonInput & {
  readonly mode: 'first_last_frame'
  readonly firstFrameUrl: string
  readonly lastFrameUrl: string
}

export type H3ContinuationPromptGraphInput = H3PromptGraphCommonInput & {
  readonly mode: 'continuation'
  readonly continuationFrameFilenames: readonly string[]
}

export type H3PromptGraphInput =
  | H3ReferencePromptGraphInput
  | H3FirstFramePromptGraphInput
  | H3FirstLastFramePromptGraphInput
  | H3ContinuationPromptGraphInput

function copyGraph(graph: ComfyUiPromptGraph): ComfyUiPromptGraph {
  return Object.fromEntries(Object.entries(graph).map(([nodeId, node]) => [
    nodeId,
    { class_type: node.class_type, inputs: { ...node.inputs } },
  ]))
}

function validateCommonInput(input: H3PromptGraphCommonInput): void {
  if (!input.prompt.trim()) throw new Error('COMFYUI_H3_PROMPT_REQUIRED')
  if (!Number.isSafeInteger(input.frameCount) || input.frameCount <= 0) {
    throw new Error(`COMFYUI_H3_FRAME_COUNT_INVALID:${String(input.frameCount)}`)
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error('COMFYUI_H3_SEED_INVALID')
  }
}

function applyCommonInputs(
  profile: H3DualStageRuntimeProfile,
  graph: ComfyUiPromptGraph,
  input: H3PromptGraphCommonInput,
): void {
  const firstDimensions = resolveH3Dimensions({
    megapixels: 1,
    aspectRatio: input.aspectRatio,
  })
  const finalDimensions = deriveH3DeliveryDimensions(firstDimensions)
  const h3Node = graph[profile.h3NodeId]
  const promptNode = graph[profile.promptNodeId]
  const noiseNode = graph[profile.noiseNodeId]
  const firstUpscaleNode = graph[profile.firstUpscaleNodeId]
  const finalUpscaleNode = graph[profile.finalUpscaleNodeId]
  if (!h3Node || !promptNode || !noiseNode || !firstUpscaleNode || !finalUpscaleNode) {
    throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
  }
  const finalDivisibleBy = finalUpscaleNode.inputs.divisible_by
  if (
    typeof finalDivisibleBy !== 'number'
    || !Number.isSafeInteger(finalDivisibleBy)
    || finalDivisibleBy <= 0
    || finalDimensions.width % finalDivisibleBy !== 0
    || finalDimensions.height % finalDivisibleBy !== 0
  ) {
    throw new Error('COMFYUI_H3_DELIVERY_DIMENSIONS_INCOMPATIBLE:' + profile.id)
  }
  promptNode.inputs.value = input.prompt
  h3Node.inputs.width = firstDimensions.width
  h3Node.inputs.height = firstDimensions.height
  h3Node.inputs.length = input.frameCount
  noiseNode.inputs.noise_seed = input.seed
  firstUpscaleNode.inputs.width = firstDimensions.width
  firstUpscaleNode.inputs.height = firstDimensions.height
  finalUpscaleNode.inputs.width = finalDimensions.width
  finalUpscaleNode.inputs.height = finalDimensions.height

  if (profile.id === H3_FRAME_DUAL_STAGE_PROFILE_ID) {
    for (const resizeNodeId of [profile.firstFrameResizeNodeId, profile.lastFrameResizeNodeId]) {
      const resizeNode = graph[resizeNodeId]
      if (!resizeNode) continue
      resizeNode.inputs.width = firstDimensions.width
      resizeNode.inputs.height = firstDimensions.height
    }
  }
}

function buildReferencePromptGraph(
  input: H3ReferencePromptGraphInput,
): { readonly profile: H3ReferenceDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  if (
    input.referenceImageUrls.length < 1
    || input.referenceImageUrls.length > H3_MAX_REFERENCE_IMAGES
  ) {
    throw new Error(
      'COMFYUI_H3_REFERENCE_IMAGES_COUNT_INVALID:' + String(H3_MAX_REFERENCE_IMAGES),
    )
  }
  const referenceImageUrls = input.referenceImageUrls.map((url) => url.trim())
  if (referenceImageUrls.some((url) => !url)) {
    throw new Error('COMFYUI_H3_REFERENCE_IMAGE_REQUIRED')
  }
  if (input.referenceAudioFilenames.length > H3_MAX_REFERENCE_AUDIOS) {
    throw new Error(
      'COMFYUI_H3_REFERENCE_AUDIOS_COUNT_INVALID:' + String(H3_MAX_REFERENCE_AUDIOS),
    )
  }
  const referenceAudioFilenames = input.referenceAudioFilenames.map((filename) => filename.trim())
  if (referenceAudioFilenames.some((filename) => !filename)) {
    throw new Error('COMFYUI_H3_REFERENCE_AUDIO_REQUIRED')
  }
  const profile = H3_DUAL_STAGE_RUNTIME_PROFILE
  const graph = copyGraph(profile.workflow)
  const baseLoadNode = graph[profile.referenceImageNodeIds[0]!]
  const baseResizeNode = graph[profile.referenceResizeNodeIds[0]!]
  const baseAudioNode = graph[profile.referenceAudioNodeIds[0]!]
  const h3Node = graph[profile.h3NodeId]
  if (!baseLoadNode || !baseResizeNode || !baseAudioNode || !h3Node) {
    throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
  }
  for (const nodeId of profile.referenceAudioNodeIds) delete graph[nodeId]
  for (const key of Object.keys(h3Node.inputs)) {
    if (key.startsWith('ref_images.ref_image_')) delete h3Node.inputs[key]
    if (key.startsWith('ref_audios.ref_audio_')) delete h3Node.inputs[key]
  }
  referenceImageUrls.forEach((url, index) => {
    const loadNodeId = profile.referenceImageNodeIds[index]!
    const resizeNodeId = profile.referenceResizeNodeIds[index]!
    graph[loadNodeId] = {
      class_type: baseLoadNode.class_type,
      inputs: { ...baseLoadNode.inputs, url },
    }
    graph[resizeNodeId] = {
      class_type: baseResizeNode.class_type,
      inputs: { ...baseResizeNode.inputs, image: [loadNodeId, 0] },
    }
    h3Node.inputs['ref_images.ref_image_' + String(index)] = [resizeNodeId, 0]
  })
  referenceAudioFilenames.forEach((filename, index) => {
    const loadNodeId = profile.referenceAudioNodeIds[index]!
    graph[loadNodeId] = {
      class_type: baseAudioNode.class_type,
      inputs: { ...baseAudioNode.inputs, audio: filename },
    }
    h3Node.inputs['ref_audios.ref_audio_' + String(index)] = [loadNodeId, 0]
  })
  applyCommonInputs(profile, graph, input)
  return { profile, graph }
}

function requiredUrl(value: string, code: string): string {
  const url = value.trim()
  if (!url) throw new Error(code)
  return url
}

function buildFramePromptGraph(
  input: H3FirstFramePromptGraphInput | H3FirstLastFramePromptGraphInput,
): { readonly profile: H3FrameDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  const profile = H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE
  const graph = copyGraph(profile.workflow)
  const firstFrameNode = graph[profile.firstFrameImageNodeId]
  const h3Node = graph[profile.h3NodeId]
  if (!firstFrameNode || !h3Node) {
    throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
  }
  firstFrameNode.inputs.url = requiredUrl(
    input.firstFrameUrl,
    'COMFYUI_H3_FIRST_FRAME_REQUIRED',
  )
  if (input.mode === 'first_last_frame') {
    const lastFrameNode = graph[profile.lastFrameImageNodeId]
    if (!lastFrameNode) throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
    lastFrameNode.inputs.url = requiredUrl(
      input.lastFrameUrl,
      'COMFYUI_H3_LAST_FRAME_REQUIRED',
    )
  } else {
    delete h3Node.inputs.last_frame
    delete graph[profile.lastFrameImageNodeId]
    delete graph[profile.lastFrameResizeNodeId]
  }
  applyCommonInputs(profile, graph, input)
  return { profile, graph }
}

function buildContinuationPromptGraph(
  input: H3ContinuationPromptGraphInput,
): { readonly profile: H3ContinuationDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  if (input.continuationFrameFilenames.length !== H3_CONTINUATION_GUIDE_FRAMES) {
    throw new Error('COMFYUI_H3_CONTINUATION_FRAME_COUNT_INVALID')
  }
  const filenames = input.continuationFrameFilenames.map((filename) => filename.trim())
  if (filenames.some((filename) => !filename)) {
    throw new Error('COMFYUI_H3_CONTINUATION_FRAME_REQUIRED')
  }
  if (new Set(filenames).size !== filenames.length) {
    throw new Error('COMFYUI_H3_CONTINUATION_FRAME_DUPLICATE')
  }
  const profile = H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE
  const graph = copyGraph(profile.workflow)
  profile.continuationImageNodeIds.forEach((nodeId, index) => {
    const node = graph[nodeId]
    if (!node) throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
    node.inputs.image = filenames[index]!
  })
  applyCommonInputs(profile, graph, input)
  return { profile, graph }
}

export function buildH3PromptGraph(
  input: H3ReferencePromptGraphInput,
): { readonly profile: H3ReferenceDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph }
export function buildH3PromptGraph(
  input: H3FirstFramePromptGraphInput | H3FirstLastFramePromptGraphInput,
): { readonly profile: H3FrameDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph }
export function buildH3PromptGraph(
  input: H3ContinuationPromptGraphInput,
): { readonly profile: H3ContinuationDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph }
export function buildH3PromptGraph(
  input: H3PromptGraphInput,
): { readonly profile: H3DualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  validateCommonInput(input)
  if (input.mode === 'reference') return buildReferencePromptGraph(input)
  if (input.mode === 'continuation') return buildContinuationPromptGraph(input)
  return buildFramePromptGraph(input)
}
