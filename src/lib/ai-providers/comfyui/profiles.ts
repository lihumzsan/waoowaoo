import dualStageWorkflow from './workflows/h3-dual-stage-2mp.json'

export const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const
export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]

export type ComfyUiPromptGraph = Record<string, { readonly class_type: string; readonly inputs: Record<string, unknown> }>

export const H3_DURATION_OPTIONS_SECONDS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const
export const H3_DURATION_MIN_SECONDS = H3_DURATION_OPTIONS_SECONDS[0]
export const H3_DURATION_MAX_SECONDS = H3_DURATION_OPTIONS_SECONDS.at(-1)!
const H3_FRAMES_PER_SECOND = 24
const H3_FRAME_GRID = 17
const H3_FRAME_REMAINDER = 5
const H3_MIN_FRAMES = 107
export const H3_MAX_REFERENCE_IMAGES = 8
const H3_REFERENCE_IMAGE_NODE_IDS = ['137', '326', '327', '328', '329', '330', '331', '332'] as const
const H3_REFERENCE_RESIZE_NODE_IDS = ['198', '333', '334', '335', '336', '337', '338', '339'] as const

function unsupportedOption(name: string, value: unknown): never {
  throw new Error(`COMFYUI_H3_OPTION_UNSUPPORTED:${name}=${String(value)}`)
}

export function resolveH3DurationFrames(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < H3_DURATION_MIN_SECONDS || seconds > H3_DURATION_MAX_SECONDS) unsupportedOption('duration', seconds)
  const minimumFrames = Math.max(H3_MIN_FRAMES, Math.round(seconds * H3_FRAMES_PER_SECOND))
  const framesUntilNextGrid = (H3_FRAME_REMAINDER - (minimumFrames % H3_FRAME_GRID) + H3_FRAME_GRID) % H3_FRAME_GRID
  return minimumFrames + framesUntilNextGrid
}

export function resolveH3EffectiveDurationSeconds(seconds: number): number {
  return resolveH3DurationFrames(seconds) / H3_FRAMES_PER_SECOND
}

function parseAspectRatio(value: string): [number, number] {
  if (!(H3_ASPECT_RATIOS as readonly string[]).includes(value)) unsupportedOption('aspectRatio', value)
  const [width, height] = value.split(':').map((entry) => Number.parseInt(entry, 10))
  if (!width || !height) throw new Error(`COMFYUI_H3_ASPECT_RATIO_INVALID:${value}`)
  return [width, height]
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

export function resolveH3Dimensions(input: { readonly megapixels: number; readonly aspectRatio: H3AspectRatio }): { readonly width: number; readonly height: number } {
  if (input.megapixels !== 1 && input.megapixels !== 2) unsupportedOption('megapixels', input.megapixels)
  const [ratioWidth, ratioHeight] = parseAspectRatio(input.aspectRatio)
  const area = input.megapixels * 1024 * 1024
  const width = Math.sqrt(area * (ratioWidth / ratioHeight))
  const height = area / width
  return { width: roundToMultiple(width, 32), height: roundToMultiple(height, 32) }
}

export const H3_DUAL_STAGE_PROFILE_ID = 'h3-dual-stage-2mp' as const

export type H3DualStageRuntimeProfile = {
  readonly id: typeof H3_DUAL_STAGE_PROFILE_ID
  readonly workflow: ComfyUiPromptGraph
  readonly referenceImageNodeIds: readonly string[]
  readonly referenceResizeNodeIds: readonly string[]
  readonly promptNodeId: string
  readonly h3NodeId: string
  readonly noiseNodeId: string
  readonly firstUpscaleNodeId: string
  readonly finalUpscaleNodeId: string
  readonly outputNodeId: string
  readonly requiredNodeClasses: readonly string[]
}

export const H3_DUAL_STAGE_RUNTIME_PROFILE: H3DualStageRuntimeProfile = {
  id: H3_DUAL_STAGE_PROFILE_ID,
  workflow: dualStageWorkflow as ComfyUiPromptGraph,
  referenceImageNodeIds: H3_REFERENCE_IMAGE_NODE_IDS, referenceResizeNodeIds: H3_REFERENCE_RESIZE_NODE_IDS,
  promptNodeId: '138', h3NodeId: '309', noiseNodeId: '129',
  firstUpscaleNodeId: '213', finalUpscaleNodeId: '323', outputNodeId: '168',
  requiredNodeClasses: [
    'Load Image From Url (mtb)', 'ResizeShortestToNode', 'UNETLoader', 'CLIPLoader', 'VAELoader',
    'LoraLoaderModelOnly', 'ModelAttentionBackend', 'MiniMaxH3ReferenceToVideo', 'easy clearCacheAll',
    'RandomNoise', 'KSamplerSelect', 'BasicScheduler', 'BasicGuider', 'SamplerCustomAdvanced',
    'VAEDecode', 'VAEDecodeAudio', 'ImageResizeKJv2', 'VAEEncode', 'VAEEncodeAudio', 'PT_H3ConcatAVLatent',
    'VHS_VideoCombine',
  ],
}

function copyGraph(graph: ComfyUiPromptGraph): ComfyUiPromptGraph {
  return Object.fromEntries(Object.entries(graph).map(([nodeId, node]) => [nodeId, { class_type: node.class_type, inputs: { ...node.inputs } }]))
}

export function buildH3DualStagePromptGraph(input: {
  readonly prompt: string
  readonly referenceImageUrls: readonly string[]
  readonly durationSeconds: number
  readonly aspectRatio: H3AspectRatio
  readonly seed: number
}): { readonly profile: H3DualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  if (!input.prompt.trim()) throw new Error('COMFYUI_H3_PROMPT_REQUIRED')
  if (input.referenceImageUrls.length < 1 || input.referenceImageUrls.length > H3_MAX_REFERENCE_IMAGES) throw new Error(`COMFYUI_H3_REFERENCE_IMAGES_COUNT_INVALID:${H3_MAX_REFERENCE_IMAGES}`)
  const referenceImageUrls = input.referenceImageUrls.map((url) => url.trim())
  if (referenceImageUrls.some((url) => !url)) throw new Error('COMFYUI_H3_REFERENCE_IMAGE_REQUIRED')
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_H3_SEED_INVALID')
  const graph = copyGraph(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
  const firstDimensions = resolveH3Dimensions({ megapixels: 1, aspectRatio: input.aspectRatio })
  const finalDimensions = resolveH3Dimensions({ megapixels: 2, aspectRatio: input.aspectRatio })
  const baseLoadNode = graph[H3_DUAL_STAGE_RUNTIME_PROFILE.referenceImageNodeIds[0]!]!
  const baseResizeNode = graph[H3_DUAL_STAGE_RUNTIME_PROFILE.referenceResizeNodeIds[0]!]!
  const h3Node = graph[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]!
  for (const key of Object.keys(h3Node.inputs)) {
    if (key.startsWith('ref_images.ref_image_')) delete h3Node.inputs[key]
  }
  referenceImageUrls.forEach((url, index) => {
    const loadNodeId = H3_DUAL_STAGE_RUNTIME_PROFILE.referenceImageNodeIds[index]!
    const resizeNodeId = H3_DUAL_STAGE_RUNTIME_PROFILE.referenceResizeNodeIds[index]!
    graph[loadNodeId] = { class_type: baseLoadNode.class_type, inputs: { ...baseLoadNode.inputs, url } }
    graph[resizeNodeId] = { class_type: baseResizeNode.class_type, inputs: { ...baseResizeNode.inputs, image: [loadNodeId, 0] } }
    h3Node.inputs[`ref_images.ref_image_${index}`] = [resizeNodeId, 0]
  })
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.promptNodeId]!.inputs.value = input.prompt
  h3Node.inputs.width = firstDimensions.width
  h3Node.inputs.height = firstDimensions.height
  h3Node.inputs.length = resolveH3DurationFrames(input.durationSeconds)
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.noiseNodeId]!.inputs.noise_seed = input.seed
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.firstUpscaleNodeId]!.inputs.width = firstDimensions.width
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.firstUpscaleNodeId]!.inputs.height = firstDimensions.height
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.finalUpscaleNodeId]!.inputs.width = finalDimensions.width
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.finalUpscaleNodeId]!.inputs.height = finalDimensions.height
  return { profile: H3_DUAL_STAGE_RUNTIME_PROFILE, graph }
}
