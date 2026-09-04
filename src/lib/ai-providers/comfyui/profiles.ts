import dualStageWorkflow from './workflows/h3-dual-stage-2mp.json'
import frameDualStageWorkflow from './workflows/h3-frame-dual-stage-2mp.json'

export const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const
export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]

export type ComfyUiPromptGraph = Record<string, {
  readonly class_type: string
  readonly inputs: Record<string, unknown>
}>

export const H3_MAX_REFERENCE_IMAGES = 8
const H3_REFERENCE_IMAGE_NODE_IDS = ['137', '326', '327', '328', '329', '330', '331', '332'] as const
const H3_REFERENCE_RESIZE_NODE_IDS = ['198', '333', '334', '335', '336', '337', '338', '339'] as const

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
  const area = input.megapixels * 1024 * 1024
  const width = Math.sqrt(area * (ratioWidth / ratioHeight))
  const height = area / width
  return {
    width: roundToMultiple(width, 32),
    height: roundToMultiple(height, 32),
  }
}

export const H3_REFERENCE_DUAL_STAGE_PROFILE_ID = 'h3-reference-dual-stage-2mp' as const
export const H3_FRAME_DUAL_STAGE_PROFILE_ID = 'h3-frame-dual-stage-2mp' as const
export type H3GraphProfileId =
  | typeof H3_REFERENCE_DUAL_STAGE_PROFILE_ID
  | typeof H3_FRAME_DUAL_STAGE_PROFILE_ID

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
}

export type H3FrameDualStageRuntimeProfile = H3RuntimeProfileBase & {
  readonly id: typeof H3_FRAME_DUAL_STAGE_PROFILE_ID
  readonly firstFrameImageNodeId: string
  readonly firstFrameResizeNodeId: string
  readonly lastFrameImageNodeId: string
  readonly lastFrameResizeNodeId: string
}

export type H3DualStageRuntimeProfile =
  | H3ReferenceDualStageRuntimeProfile
  | H3FrameDualStageRuntimeProfile

export const H3_DUAL_STAGE_RUNTIME_PROFILE: H3ReferenceDualStageRuntimeProfile = {
  id: H3_REFERENCE_DUAL_STAGE_PROFILE_ID,
  workflow: dualStageWorkflow as ComfyUiPromptGraph,
  referenceImageNodeIds: H3_REFERENCE_IMAGE_NODE_IDS,
  referenceResizeNodeIds: H3_REFERENCE_RESIZE_NODE_IDS,
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

type H3PromptGraphCommonInput = {
  readonly prompt: string
  readonly frameCount: number
  readonly aspectRatio: H3AspectRatio
  readonly seed: number
}

export type H3ReferencePromptGraphInput = H3PromptGraphCommonInput & {
  readonly mode: 'reference'
  readonly referenceImageUrls: readonly string[]
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

export type H3PromptGraphInput =
  | H3ReferencePromptGraphInput
  | H3FirstFramePromptGraphInput
  | H3FirstLastFramePromptGraphInput

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
  const finalDimensions = resolveH3Dimensions({
    megapixels: 2,
    aspectRatio: input.aspectRatio,
  })
  const h3Node = graph[profile.h3NodeId]
  const promptNode = graph[profile.promptNodeId]
  const noiseNode = graph[profile.noiseNodeId]
  const firstUpscaleNode = graph[profile.firstUpscaleNodeId]
  const finalUpscaleNode = graph[profile.finalUpscaleNodeId]
  if (!h3Node || !promptNode || !noiseNode || !firstUpscaleNode || !finalUpscaleNode) {
    throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
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
  const profile = H3_DUAL_STAGE_RUNTIME_PROFILE
  const graph = copyGraph(profile.workflow)
  const baseLoadNode = graph[profile.referenceImageNodeIds[0]!]
  const baseResizeNode = graph[profile.referenceResizeNodeIds[0]!]
  const h3Node = graph[profile.h3NodeId]
  if (!baseLoadNode || !baseResizeNode || !h3Node) {
    throw new Error('COMFYUI_H3_PROFILE_NODE_MISSING:' + profile.id)
  }
  for (const key of Object.keys(h3Node.inputs)) {
    if (key.startsWith('ref_images.ref_image_')) delete h3Node.inputs[key]
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

export function buildH3PromptGraph(
  input: H3ReferencePromptGraphInput,
): { readonly profile: H3ReferenceDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph }
export function buildH3PromptGraph(
  input: H3FirstFramePromptGraphInput | H3FirstLastFramePromptGraphInput,
): { readonly profile: H3FrameDualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph }
export function buildH3PromptGraph(
  input: H3PromptGraphInput,
): { readonly profile: H3DualStageRuntimeProfile; readonly graph: ComfyUiPromptGraph } {
  validateCommonInput(input)
  return input.mode === 'reference'
    ? buildReferencePromptGraph(input)
    : buildFramePromptGraph(input)
}
