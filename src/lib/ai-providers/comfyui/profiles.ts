import firstFrameWorkflow from './workflows/h3-fast-first-frame.json'
import firstLastFrameWorkflow from './workflows/h3-fast-first-last-frame.json'

export const H3_PROFILE_IDS = [
  'h3-fast-first-frame',
  'h3-fast-first-last-frame',
] as const

export type H3ProfileId = (typeof H3_PROFILE_IDS)[number]

export const H3_ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '9:21',
] as const

export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]
export type H3Resolution = '480p' | '720p'

export const H3_MODELS = {
  diffusion: 'h3\\minimax_h3_ref2va_int8_convrot.safetensors',
  textEncoder: 'h3\\qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'h3\\minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'h3\\minimax_h3_audio_vae_fp32.safetensors',
  turboLora: 'h3\\minimax_h3_fl2v_turbo_4step_v0.1.safetensors',
} as const

export type ComfyUiPromptGraph = Record<string, {
  readonly class_type: string
  readonly inputs: Record<string, unknown>
}>

export type H3RuntimeProfile = {
  readonly id: H3ProfileId
  readonly workflow: ComfyUiPromptGraph
  readonly firstFrameNodeId: string
  readonly lastFrameNodeId: string | null
  readonly h3NodeId: string
  readonly outputNodeId: string
  readonly requiredNodeClasses: readonly string[]
}

export const H3_RUNTIME_PROFILES: Record<H3ProfileId, H3RuntimeProfile> = {
  'h3-fast-first-frame': {
    id: 'h3-fast-first-frame',
    workflow: firstFrameWorkflow as ComfyUiPromptGraph,
    firstFrameNodeId: '6',
    lastFrameNodeId: null,
    h3NodeId: '7',
    outputNodeId: '15',
    requiredNodeClasses: [
      'UNETLoader', 'LoraLoaderBypassModelOnly', 'PathchSageAttentionKJ', 'SolAttnPatch', 'EasyCache', 'CLIPLoader', 'VAELoader',
      'Load Image From Url (mtb)', 'MiniMaxH3ImageToVideo', 'BasicGuider',
      'RandomNoise', 'KSamplerSelect', 'BasicScheduler', 'SamplerCustomAdvanced',
      'VAEDecode', 'VAEDecodeAudio', 'VHS_VideoCombine',
    ],
  },
  'h3-fast-first-last-frame': {
    id: 'h3-fast-first-last-frame',
    workflow: firstLastFrameWorkflow as ComfyUiPromptGraph,
    firstFrameNodeId: '6',
    lastFrameNodeId: '7',
    h3NodeId: '8',
    outputNodeId: '16',
    requiredNodeClasses: [
      'UNETLoader', 'LoraLoaderBypassModelOnly', 'PathchSageAttentionKJ', 'SolAttnPatch', 'EasyCache', 'CLIPLoader', 'VAELoader',
      'Load Image From Url (mtb)', 'MiniMaxH3ImageToVideo', 'BasicGuider',
      'RandomNoise', 'KSamplerSelect', 'BasicScheduler', 'SamplerCustomAdvanced',
      'VAEDecode', 'VAEDecodeAudio', 'VHS_VideoCombine',
    ],
  },
}

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
  if (!Number.isFinite(seconds) || seconds < H3_DURATION_MIN_SECONDS || seconds > H3_DURATION_MAX_SECONDS) {
    unsupportedOption('duration', seconds)
  }
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

export function resolveH3Dimensions(input: {
  readonly resolution: H3Resolution
  readonly aspectRatio: H3AspectRatio
}): { readonly width: number; readonly height: number } {
  const megapixels = input.resolution === '480p'
    ? 0.4
    : input.resolution === '720p'
      ? 1.0
      : unsupportedOption('resolution', input.resolution)
  const [ratioWidth, ratioHeight] = parseAspectRatio(input.aspectRatio)
  const area = megapixels * 1024 * 1024
  const width = Math.sqrt(area * (ratioWidth / ratioHeight))
  const height = area / width
  return { width: roundToMultiple(width, 32), height: roundToMultiple(height, 32) }
}

function copyGraph(graph: ComfyUiPromptGraph): ComfyUiPromptGraph {
  return Object.fromEntries(Object.entries(graph).map(([nodeId, node]) => [
    nodeId,
    { class_type: node.class_type, inputs: { ...node.inputs } },
  ]))
}

export function buildH3PromptGraph(input: {
  readonly profileId: H3ProfileId
  readonly prompt: string
  readonly firstFrameUrl: string
  readonly lastFrameUrl?: string
  readonly durationSeconds: number
  readonly resolution: H3Resolution
  readonly aspectRatio: H3AspectRatio
  readonly seed: number
}): { readonly profile: H3RuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  const profile = H3_RUNTIME_PROFILES[input.profileId]
  if (!profile) throw new Error(`COMFYUI_H3_PROFILE_UNKNOWN:${input.profileId}`)
  if (!input.prompt.trim()) throw new Error('COMFYUI_H3_PROMPT_REQUIRED')
  if (!input.firstFrameUrl.trim()) throw new Error('COMFYUI_H3_FIRST_FRAME_REQUIRED')
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('COMFYUI_H3_SEED_INVALID')
  if (profile.lastFrameNodeId === null && input.lastFrameUrl !== undefined) {
    throw new Error('COMFYUI_H3_LAST_FRAME_FORBIDDEN')
  }
  if (profile.lastFrameNodeId !== null && !input.lastFrameUrl?.trim()) {
    throw new Error('COMFYUI_H3_LAST_FRAME_REQUIRED')
  }

  const dimensions = resolveH3Dimensions({ resolution: input.resolution, aspectRatio: input.aspectRatio })
  const graph = copyGraph(profile.workflow)
  graph[profile.firstFrameNodeId]!.inputs.url = input.firstFrameUrl
  if (profile.lastFrameNodeId !== null) graph[profile.lastFrameNodeId]!.inputs.url = input.lastFrameUrl!
  graph[profile.h3NodeId]!.inputs.prompt = input.prompt
  graph[profile.h3NodeId]!.inputs.width = dimensions.width
  graph[profile.h3NodeId]!.inputs.height = dimensions.height
  graph[profile.h3NodeId]!.inputs.length = resolveH3DurationFrames(input.durationSeconds)
  const noiseNode = Object.entries(graph).find(([, node]) => node.class_type === 'RandomNoise')
  if (!noiseNode) throw new Error('COMFYUI_H3_RANDOM_NOISE_NODE_MISSING')
  noiseNode[1].inputs.noise_seed = input.seed
  return { profile, graph }
}
