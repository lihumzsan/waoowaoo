import dualStageWorkflow from './workflows/h3-dual-stage-2mp.json'

export const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const
export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]

export type ComfyUiPromptGraph = Record<string, { readonly class_type: string; readonly inputs: Record<string, unknown> }>

const H3_DURATION_MIN_SECONDS = 4
const H3_DURATION_MAX_SECONDS = 15
const H3_FRAMES_PER_SECOND = 24
const H3_FRAME_GRID = 17
const H3_FRAME_REMAINDER = 5
const H3_MIN_FRAMES = 107

function unsupportedOption(name: string, value: unknown): never {
  throw new Error(`COMFYUI_H3_OPTION_UNSUPPORTED:${name}=${String(value)}`)
}

export function resolveH3DurationFrames(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < H3_DURATION_MIN_SECONDS || seconds > H3_DURATION_MAX_SECONDS) unsupportedOption('duration', seconds)
  const minimumFrames = Math.max(H3_MIN_FRAMES, Math.round(seconds * H3_FRAMES_PER_SECOND))
  return minimumFrames + ((H3_FRAME_REMAINDER - (minimumFrames % H3_FRAME_GRID)) % H3_FRAME_GRID)
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
  readonly referenceImageNodeId: string
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
  referenceImageNodeId: '137', promptNodeId: '138', h3NodeId: '309', noiseNodeId: '129',
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
  readonly referenceImageUrl: string
  readonly durationSeconds: number
  readonly aspectRatio: H3AspectRatio
  readonly seed: number
}): { readonly profile: H3DualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  if (!input.prompt.trim()) throw new Error('COMFYUI_H3_PROMPT_REQUIRED')
  if (!input.referenceImageUrl.trim()) throw new Error('COMFYUI_H3_REFERENCE_IMAGE_REQUIRED')
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_H3_SEED_INVALID')
  const graph = copyGraph(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
  const firstDimensions = resolveH3Dimensions({ megapixels: 1, aspectRatio: input.aspectRatio })
  const finalDimensions = resolveH3Dimensions({ megapixels: 2, aspectRatio: input.aspectRatio })
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.referenceImageNodeId]!.inputs.url = input.referenceImageUrl
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.promptNodeId]!.inputs.value = input.prompt
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]!.inputs.width = firstDimensions.width
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]!.inputs.height = firstDimensions.height
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]!.inputs.length = resolveH3DurationFrames(input.durationSeconds)
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.noiseNodeId]!.inputs.noise_seed = input.seed
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.firstUpscaleNodeId]!.inputs.width = firstDimensions.width
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.firstUpscaleNodeId]!.inputs.height = firstDimensions.height
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.finalUpscaleNodeId]!.inputs.width = finalDimensions.width
  graph[H3_DUAL_STAGE_RUNTIME_PROFILE.finalUpscaleNodeId]!.inputs.height = finalDimensions.height
  return { profile: H3_DUAL_STAGE_RUNTIME_PROFILE, graph }
}
