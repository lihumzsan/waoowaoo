import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import {
  VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES,
  isValidVideoTrimFrames,
} from '@/lib/video-tools/trim-frames'
import {
  COMFYUI_LTX23_GOON_FPS,
  COMFYUI_LTX23_WORKFLOW_KEYS,
  expandLtx23WorkflowImageFilenames,
  getLtx23WorkflowProfile,
  isComfyUiLtx23GoonFirstLastFrameWorkflow,
  isComfyUiLtx23KjPromptRelayWorkflow,
  normalizeLtx23GoonDurationSeconds,
  normalizeLtx23WorkflowKey,
  resolveLtx23KjImageGuideStrength,
  resolveLtx23GoonFinalFrameIndex,
} from './ltx23-workflow-profiles'
import {
  COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID,
  SEEDANCE2_BERNINI_DEFAULT_DURATION_SECONDS,
  SEEDANCE2_BERNINI_DEFAULT_FPS,
  isSeedance2BerniniAudioWorkflowKey,
  isSeedance2BerniniWorkflowKey,
  normalizeSeedance2BerniniMotionStrength,
  resolveSeedance2BerniniMotionStrengthLabel,
} from './seedance2-bernini-workflow'

export const COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID = 'baseimage/图片生成/Flux2Klein文生图'
export const COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID = COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID

const LEGACY_BUNDLED_ROOT = join(process.cwd(), 'src', 'lib', 'providers', 'comfyui', 'workflows')
const EXTERNAL_WORKFLOW_TOOL_DIR = 'tool'
const EXTERNAL_WORKFLOW_BASE_PREFIX = 'base'
const UI_ONLY_INPUT_TYPE_SUFFIXES = ['UPLOAD', '_UI']
const SEED_CONTROL_VALUES = new Set(['fixed', 'randomize', 'increment', 'decrement'])
const CONNECTED_PROMPT_SOURCE_FIELDS = ['value', 'text', 'prompt', 'string', 'input_string']
const COMFYUI_SAFE_RANDOM_SEED_MAX = 2_147_483_647
const OPTIONAL_MODEL_BYPASS_NODE_TYPES = new Set([
  'ltxvsequenceparallelmultigpupatcher',
])
const UI_DECORATION_NODE_TYPES = new Set([
  'note',
  'markdownnote',
])
const DISPLAY_ONLY_OUTPUT_NODE_TYPES = new Set([
  'easyshowanything',
  'previewany',
  'shellagentpluginoutputtext',
  'showanythingmie',
])
const PASSTHROUGH_OUTPUT_NODE_TYPES = new Set([
  ...DISPLAY_ONLY_OUTPUT_NODE_TYPES,
  'layerutilitypurgevramv2',
  'reroute',
])
const VIDEO_OUTPUT_NODE_TYPES = new Set([
  'vhsvideocombine',
  'saveanimatedwebp',
  'savevideo',
])
const MEDIA_OUTPUT_NODE_TYPES = new Set([
  ...VIDEO_OUTPUT_NODE_TYPES,
  'saveimage',
  'saveaudio',
])
const PREVIEW_OUTPUT_NODE_TYPES = new Set([
  'previewimage',
])

export type ComfyUiWorkflowGraphNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: Record<string, unknown> & {
    title?: string
  }
}

export type ComfyUiWorkflowGraph = Record<string, ComfyUiWorkflowGraphNode>

export type ComfyUiWorkflowInject = {
  prompt?: string
  negativePrompt?: string
  width?: number
  height?: number
  imageFilenames?: string[]
  audioFilenames?: string[]
  videoFilenames?: string[]
  videoTrimFrames?: [number, number]
  llmApi?: ComfyUiWorkflowLlmApiInject
  fps?: number
  durationSeconds?: number
  targetFrameCount?: number
  motionStrength?: number
  seed?: number
  videoSeamMotionAnchors?: {
    frameIndices: [number, number, number, number]
  }
}

export type ComfyUiWorkflowLlmApiInject = {
  baseUrl: string
  apiKey: string
  model: string
}

export type ComfyUiWorkflowParameterContract = {
  name: string
  promptNodeIds: string[]
  positiveConditioningNodeIds: string[]
  negativeConditioningNodeIds: string[]
  aspectRatioNodeIds: string[]
  longestSideNodeIds: string[]
  imageInputNodeIds: string[]
  finalOutputNodeIds: string[]
  allowInternalLlmExpansion: boolean
  maxReferenceImages: number
}

export type ComfyUiWorkflowPreflightResult = {
  ok: true
  workflowKey: string
  contractName: string | null
  summary: {
    promptLocked: boolean
    aspectRatioLocked: boolean
    referenceImageCount: number
    finalOutputNodeIds: string[]
  }
}

type UiWorkflowInput = {
  name?: unknown
  type?: unknown
  link?: unknown
  widget?: {
    name?: unknown
  } | null
}

type UiWorkflow = {
  nodes?: unknown
  links?: unknown
  extra?: {
    prompt?: unknown
  } | null
}

type UiWorkflowWidgetValueRecord = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeComfyUiWorkflowRoot(raw?: string): string | null {
  const value = readTrimmedString(raw)
  if (!value) return null
  return resolve(value)
}

function isExternalWorkflowDirectoryName(name: string): boolean {
  return name.startsWith(EXTERNAL_WORKFLOW_BASE_PREFIX) || name === EXTERNAL_WORKFLOW_TOOL_DIR
}

function getExternalWorkflowRoot(): string | null {
  return normalizeComfyUiWorkflowRoot(process.env.COMFYUI_WORKFLOW_ROOT)
}

function ensurePathInsideRoot(root: string, candidatePath: string): boolean {
  const rel = relative(root, candidatePath)
  return rel !== '' && !rel.startsWith('..') && !rel.includes('..\\') && !rel.includes('../')
}

function normalizeWorkflowKey(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const withoutExtension = trimmed.replace(/\.json$/i, '')
  if (!withoutExtension || withoutExtension.length > 240) {
    throw new Error('COMFYUI_WORKFLOW_KEY_INVALID: workflow key is empty or too long')
  }

  const segments = withoutExtension.split('/')
  for (const segment of segments) {
    const value = segment.trim()
    if (!value || value === '.' || value === '..') {
      throw new Error(`COMFYUI_WORKFLOW_KEY_INVALID: unsafe path segment "${segment}"`)
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(value)) {
      throw new Error(`COMFYUI_WORKFLOW_KEY_INVALID: invalid path segment "${segment}"`)
    }
  }

  return segments.join('/')
}

export function assertSafeComfyUiWorkflowFileKey(raw: string): string {
  return normalizeWorkflowKey(raw)
}

function resolveBundledWorkflowPath(workflowKey: string): string | null {
  const candidatePath = resolve(LEGACY_BUNDLED_ROOT, `${workflowKey}.json`)
  if (!ensurePathInsideRoot(LEGACY_BUNDLED_ROOT, candidatePath) || !existsSync(candidatePath)) {
    return null
  }
  return candidatePath
}

function resolveExternalWorkflowPath(workflowKey: string): string | null {
  const externalRoot = getExternalWorkflowRoot()
  if (!externalRoot || !existsSync(externalRoot)) return null

  const firstSegment = workflowKey.split('/')[0] || ''
  if (!isExternalWorkflowDirectoryName(firstSegment)) return null

  const candidatePath = resolve(externalRoot, `${workflowKey}.json`)
  if (!ensurePathInsideRoot(externalRoot, candidatePath) || !existsSync(candidatePath)) {
    return null
  }
  return candidatePath
}

function resolveWorkflowFilePath(workflowKey: string): string | null {
  const safeKey = assertSafeComfyUiWorkflowFileKey(workflowKey)
  return resolveExternalWorkflowPath(safeKey) || resolveBundledWorkflowPath(safeKey)
}

function isApiWorkflowGraph(value: unknown): value is ComfyUiWorkflowGraph {
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  if (entries.length === 0) return false

  return entries.every(([key, node]) => {
    if (!key.trim() || !isRecord(node)) return false
    return typeof node.class_type === 'string' && isRecord(node.inputs)
  })
}

function normalizeApiWorkflowGraph(raw: ComfyUiWorkflowGraph): ComfyUiWorkflowGraph {
  const normalized: ComfyUiWorkflowGraph = {}
  for (const [key, rawNode] of Object.entries(raw)) {
    const nodeId = readTrimmedString(key)
    if (!nodeId || !isRecord(rawNode) || !isRecord(rawNode.inputs)) continue

    const classType = readTrimmedString(rawNode.class_type)
    if (!classType) continue

    const nextNode: ComfyUiWorkflowGraphNode = {
      class_type: classType,
      inputs: JSON.parse(JSON.stringify(rawNode.inputs)) as Record<string, unknown>,
    }

    if (isRecord(rawNode._meta)) {
      const title = readTrimmedString(rawNode._meta.title)
      if (title) nextNode._meta = { title }
    }

    normalized[nodeId] = nextNode
  }
  return normalized
}

function isUiWorkflow(raw: unknown): raw is UiWorkflow {
  return isRecord(raw) && Array.isArray(raw.nodes) && Array.isArray(raw.links)
}

function isUiWorkflowLink(raw: unknown): raw is [unknown, unknown, unknown, unknown, unknown, unknown] {
  return Array.isArray(raw) && raw.length >= 5
}

function normalizeNodeId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  return readTrimmedString(value)
}

function readUiLinkId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const linkId = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(linkId)) return null
  return Math.trunc(linkId)
}

function readUiWidgetName(inputDef: UiWorkflowInput, inputName: string): string {
  return readTrimmedString(inputDef.widget?.name) || inputName
}

function readUiWidgetValue(
  widgetValuesArray: unknown[] | null,
  widgetValuesRecord: UiWorkflowWidgetValueRecord | null,
  widgetIndex: number,
  inputDef: UiWorkflowInput,
  inputName: string,
): unknown {
  if (widgetValuesArray) return widgetValuesArray[widgetIndex]
  if (!widgetValuesRecord) return undefined

  const widgetName = readUiWidgetName(inputDef, inputName)
  if (Object.prototype.hasOwnProperty.call(widgetValuesRecord, widgetName)) {
    return widgetValuesRecord[widgetName]
  }
  if (Object.prototype.hasOwnProperty.call(widgetValuesRecord, inputName)) {
    return widgetValuesRecord[inputName]
  }
  return undefined
}

function shouldSkipUiOnlyInput(inputDef: UiWorkflowInput): boolean {
  const inputName = readTrimmedString(inputDef.name).toLowerCase()
  const inputType = readTrimmedString(inputDef.type).toUpperCase()
  if (!inputName) return true
  if (inputName === 'imageui' || inputName === 'audioui' || inputName === 'videoui') return true
  return UI_ONLY_INPUT_TYPE_SUFFIXES.some((suffix) => inputType.endsWith(suffix))
}

function shouldSkipSeedControlValue(inputDef: UiWorkflowInput, nextValue: unknown): boolean {
  const name = readTrimmedString(inputDef.name).toLowerCase()
  if (!(name === 'seed' || name === 'noise_seed' || name.endsWith('_seed'))) return false
  return typeof nextValue === 'string' && SEED_CONTROL_VALUES.has(nextValue.toLowerCase())
}

function isAnythingEverywhereNodeClass(classType: string): boolean {
  return classType.toLowerCase().includes('anything everywhere')
}

function collectAnythingEverywhereSources(
  nodes: unknown[],
  linkMap: Map<number, { sourceNodeId: string; sourceSlot: number }>,
): Map<string, [string, number]> {
  const sources = new Map<string, [string, number]>()

  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue

    const classType = readTrimmedString(rawNode.type)
    if (!classType || !isAnythingEverywhereNodeClass(classType)) continue

    const inputDefs = Array.isArray(rawNode.inputs)
      ? rawNode.inputs.filter((item): item is UiWorkflowInput => isRecord(item))
      : []

    for (const inputDef of inputDefs) {
      const inputType = readTrimmedString(inputDef.type).toUpperCase()
      if (!inputType || inputType === '*' || sources.has(inputType)) continue

      const linkId = readUiLinkId(inputDef.link)
      const linked = linkId !== null ? linkMap.get(linkId) : null
      if (!linked) continue

      sources.set(inputType, [linked.sourceNodeId, linked.sourceSlot])
    }
  }

  return sources
}

function resolveSetNodeVariableName(rawNode: Record<string, unknown>): string {
  const widgetValues = Array.isArray(rawNode.widgets_values) ? rawNode.widgets_values : []
  const fromWidget = readTrimmedString(widgetValues[0])
  if (fromWidget) return fromWidget

  const previousName = isRecord(rawNode.properties)
    ? readTrimmedString(rawNode.properties.previousName)
    : ''
  if (previousName) return previousName

  const title = readTrimmedString(rawNode.title)
  const titleMatch = /^Set_(.+)$/i.exec(title)
  return titleMatch?.[1]?.trim() || ''
}

function collectSetNodeSources(
  nodes: unknown[],
  graph: ComfyUiWorkflowGraph,
): Map<string, unknown> {
  const sources = new Map<string, unknown>()

  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue
    if (readTrimmedString(rawNode.type) !== 'SetNode') continue

    const nodeId = normalizeNodeId(rawNode.id)
    if (!nodeId) continue

    const graphNode = graph[nodeId]
    if (!graphNode || !isRecord(graphNode.inputs)) continue

    const variableName = resolveSetNodeVariableName(rawNode)
    if (!variableName) continue

    const firstEntry = Object.entries(graphNode.inputs)[0]
    if (!firstEntry) continue

    sources.set(variableName, cloneConnectionValue(firstEntry[1]))
  }

  return sources
}

function resolveGetNodeVariableName(rawNode: Record<string, unknown>): string {
  const widgetValues = Array.isArray(rawNode.widgets_values) ? rawNode.widgets_values : []
  const fromWidget = readTrimmedString(widgetValues[0])
  if (fromWidget) return fromWidget

  const title = readTrimmedString(rawNode.title)
  const titleMatch = /^Get_(.+)$/i.exec(title)
  return titleMatch?.[1]?.trim() || ''
}

function resolveSetGetNodes(
  nodes: unknown[],
  graph: ComfyUiWorkflowGraph,
): void {
  const sourceByVariable = collectSetNodeSources(nodes, graph)
  if (sourceByVariable.size === 0) return

  const getNodeVariableById = new Map<string, string>()
  const removableNodeIds = new Set<string>()

  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue
    const nodeId = normalizeNodeId(rawNode.id)
    if (!nodeId) continue

    const nodeType = readTrimmedString(rawNode.type)
    if (nodeType === 'SetNode') {
      removableNodeIds.add(nodeId)
      continue
    }
    if (nodeType !== 'GetNode') continue

    const variableName = resolveGetNodeVariableName(rawNode)
    if (!variableName || !sourceByVariable.has(variableName)) continue
    getNodeVariableById.set(nodeId, variableName)
    removableNodeIds.add(nodeId)
  }

  if (getNodeVariableById.size === 0 && !Array.from(removableNodeIds).some((id) => graph[id]?.class_type === 'SetNode')) {
    return
  }

  for (const candidate of Object.values(graph)) {
    if (!isRecord(candidate.inputs)) continue
    for (const [field, rawValue] of Object.entries(candidate.inputs)) {
      if (!isConnectionValue(rawValue)) continue
      const sourceNodeId = normalizeNodeId(rawValue[0])
      if (!sourceNodeId) continue

      const variableName = getNodeVariableById.get(sourceNodeId)
      if (!variableName) continue

      const replacement = sourceByVariable.get(variableName)
      if (replacement === undefined) continue
      candidate.inputs[field] = cloneConnectionValue(replacement)
    }
  }

  for (const nodeId of removableNodeIds) {
    delete graph[nodeId]
  }
}

function normalizeUiDecorationNodeType(classType: string): string {
  return classType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function isUiDecorationNode(node: ComfyUiWorkflowGraphNode): boolean {
  const normalizedClassType = normalizeUiDecorationNodeType(node.class_type)
  if (UI_DECORATION_NODE_TYPES.has(normalizedClassType)) return true

  // Some ComfyUI UIs serialize pure note widgets as custom "*Note" nodes.
  // They carry no runnable inputs, so we can safely strip them before submit.
  return normalizedClassType.endsWith('note') && Object.keys(node.inputs).length === 0
}

function isPassthroughOutputNode(node: ComfyUiWorkflowGraphNode): boolean {
  return PASSTHROUGH_OUTPUT_NODE_TYPES.has(normalizeUiDecorationNodeType(node.class_type))
}

function removeUiOnlyNodes(graph: ComfyUiWorkflowGraph): void {
  for (const [nodeId, node] of Object.entries(graph)) {
    if (isUiDecorationNode(node)) {
      delete graph[nodeId]
    }
  }
}

function findFirstConnectedInput(node: ComfyUiWorkflowGraphNode): unknown | null {
  if (!isRecord(node.inputs)) return null

  for (const field of ['anything', '*', 'text', 'value', 'input_string']) {
    const value = node.inputs[field]
    if (isConnectionValue(value)) return value
  }

  for (const value of Object.values(node.inputs)) {
    if (isConnectionValue(value)) return value
  }

  return null
}

function graphHasConsumers(graph: ComfyUiWorkflowGraph, sourceNodeId: string): boolean {
  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue
    for (const value of Object.values(node.inputs)) {
      if (!isConnectionValue(value)) continue
      if (normalizeNodeId(value[0]) === sourceNodeId) return true
    }
  }
  return false
}

function replaceConsumers(
  graph: ComfyUiWorkflowGraph,
  sourceNodeId: string,
  replacement: unknown,
): void {
  for (const candidate of Object.values(graph)) {
    if (!isRecord(candidate.inputs)) continue
    for (const [field, rawValue] of Object.entries(candidate.inputs)) {
      if (!isConnectionValue(rawValue)) continue
      if (normalizeNodeId(rawValue[0]) !== sourceNodeId) continue
      candidate.inputs[field] = cloneConnectionValue(replacement)
    }
  }
}

function bypassPassthroughOutputNodes(graph: ComfyUiWorkflowGraph): void {
  let changed = true
  while (changed) {
    changed = false
    const removableNodeIds = Object.entries(graph)
      .filter(([, node]) => isPassthroughOutputNode(node))
      .map(([nodeId]) => nodeId)
      .sort(compareNodeIds)

    for (const nodeId of removableNodeIds) {
      const node = graph[nodeId]
      if (!node) continue

      const upstream = findFirstConnectedInput(node)
      if (upstream) {
        replaceConsumers(graph, nodeId, upstream)
        delete graph[nodeId]
        changed = true
        continue
      }

      if (!graphHasConsumers(graph, nodeId)) {
        delete graph[nodeId]
        changed = true
      }
    }
  }
}

function applyAnythingEverywhereBroadcast(
  nodes: unknown[],
  graph: ComfyUiWorkflowGraph,
  sources: Map<string, [string, number]>,
): void {
  if (sources.size === 0) return

  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue

    const nodeId = normalizeNodeId(rawNode.id)
    const classType = readTrimmedString(rawNode.type)
    if (!nodeId || !classType || isAnythingEverywhereNodeClass(classType)) continue

    const graphNode = graph[nodeId]
    if (!graphNode || !isRecord(graphNode.inputs)) continue

    const inputDefs = Array.isArray(rawNode.inputs)
      ? rawNode.inputs.filter((item): item is UiWorkflowInput => isRecord(item))
      : []

    for (const inputDef of inputDefs) {
      const inputName = readTrimmedString(inputDef.name)
      const inputType = readTrimmedString(inputDef.type).toUpperCase()
      if (!inputName || !inputType || inputType === '*' || shouldSkipUiOnlyInput(inputDef)) continue

      const linkId = readUiLinkId(inputDef.link)
      if (linkId !== null) continue
      if (Object.prototype.hasOwnProperty.call(graphNode.inputs, inputName)) continue

      const source = sources.get(inputType)
      if (!source) continue

      graphNode.inputs[inputName] = [source[0], source[1]]
    }
  }
}

function convertUiWorkflowToApiGraph(raw: UiWorkflow): ComfyUiWorkflowGraph {
  const linkMap = new Map<number, { sourceNodeId: string; sourceSlot: number }>()
  const links = Array.isArray(raw.links) ? raw.links : []
  for (const link of links) {
    if (!isUiWorkflowLink(link)) continue
    const linkId = typeof link[0] === 'number' ? link[0] : Number(link[0])
    const sourceNodeId = normalizeNodeId(link[1])
    const sourceSlot = typeof link[2] === 'number' ? link[2] : Number(link[2])
    if (!Number.isFinite(linkId) || !sourceNodeId || !Number.isFinite(sourceSlot)) continue
    linkMap.set(linkId, { sourceNodeId, sourceSlot: Math.trunc(sourceSlot) })
  }

  const graph: ComfyUiWorkflowGraph = {}
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const anythingEverywhereSources = collectAnythingEverywhereSources(nodes, linkMap)
  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue
    const nodeId = normalizeNodeId(rawNode.id)
    const classType = readTrimmedString(rawNode.type)
    if (!nodeId || !classType) continue

    const inputDefs = Array.isArray(rawNode.inputs)
      ? rawNode.inputs.filter((item): item is UiWorkflowInput => isRecord(item))
      : []
    const widgetValuesArray = Array.isArray(rawNode.widgets_values) ? rawNode.widgets_values : null
    const widgetValuesRecord = isRecord(rawNode.widgets_values) ? rawNode.widgets_values : null
    const inputs: Record<string, unknown> = {}
    let widgetIndex = 0

    for (const inputDef of inputDefs) {
      const rawInputName = readTrimmedString(inputDef.name)
      const inputName = rawInputName || (classType === 'Reroute' ? '*' : '')
      if (!inputName) continue

      const hasWidgetValue = !!inputDef.widget
      const currentValue = hasWidgetValue
        ? readUiWidgetValue(widgetValuesArray, widgetValuesRecord, widgetIndex, inputDef, inputName)
        : undefined
      const linkId = readUiLinkId(inputDef.link)
      const linked = linkId !== null ? linkMap.get(linkId) : null
      if (linked) {
        inputs[inputName] = [linked.sourceNodeId, linked.sourceSlot]
      } else if (hasWidgetValue && !shouldSkipUiOnlyInput(inputDef) && currentValue !== undefined) {
        inputs[inputName] = JSON.parse(JSON.stringify(currentValue)) as unknown
      }

      if (hasWidgetValue && widgetValuesArray) {
        widgetIndex += 1
        if (shouldSkipSeedControlValue(inputDef, widgetValuesArray[widgetIndex])) {
          widgetIndex += 1
        }
      }
    }

    if (classType === 'PrimitiveNode' && Array.isArray(rawNode.outputs)) {
      for (const rawOutputDef of rawNode.outputs) {
        if (!isRecord(rawOutputDef)) continue
        const outputDef = rawOutputDef as UiWorkflowInput
        if (!outputDef.widget) continue

        const outputName = readTrimmedString(outputDef.name)
        const widgetName = readUiWidgetName(outputDef, outputName || 'value')
        if (!widgetName || Object.prototype.hasOwnProperty.call(inputs, widgetName)) continue

        const currentValue = readUiWidgetValue(widgetValuesArray, widgetValuesRecord, widgetIndex, outputDef, widgetName)
        if (currentValue !== undefined) {
          inputs[widgetName] = JSON.parse(JSON.stringify(currentValue)) as unknown
        }

        if (widgetValuesArray) {
          widgetIndex += 1
          if (shouldSkipSeedControlValue(outputDef, widgetValuesArray[widgetIndex])) {
            widgetIndex += 1
          }
        }
      }
    }

    graph[nodeId] = {
      class_type: classType,
      inputs,
      ...(readTrimmedString(rawNode.title) ? { _meta: { title: readTrimmedString(rawNode.title) } } : {}),
    }
  }

  applyAnythingEverywhereBroadcast(nodes, graph, anythingEverywhereSources)
  resolveSetGetNodes(nodes, graph)
  bypassPassthroughOutputNodes(graph)
  removeUiOnlyNodes(graph)
  return graph
}

function readWorkflowGraphFromFile(filePath: string): ComfyUiWorkflowGraph {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown

  if (isUiWorkflow(parsed)) {
    return convertUiWorkflowToApiGraph(parsed)
  }
  if (isApiWorkflowGraph(parsed)) {
    return normalizeApiWorkflowGraph(parsed)
  }

  throw new Error(`COMFYUI_WORKFLOW_INVALID: unsupported workflow file format at ${filePath}`)
}

function compareNodeIds(a: string, b: string): number {
  const aNum = Number(a)
  const bNum = Number(b)
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum
  return a.localeCompare(b, 'zh-Hans-CN')
}

function cloneWorkflow(graph: ComfyUiWorkflowGraph): ComfyUiWorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as ComfyUiWorkflowGraph
}

function isRhLlmApiNode(node: ComfyUiWorkflowGraphNode): boolean {
  return node.class_type.trim().toLowerCase() === 'rh_llmapi_node'
}

export function comfyUiWorkflowGraphRequiresLlmApi(graph: ComfyUiWorkflowGraph): boolean {
  return Object.values(graph).some((node) => isRhLlmApiNode(node))
}

export function comfyUiWorkflowRequiresLlmApi(workflowKey: string): boolean {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) {
    throw new Error(`COMFYUI_WORKFLOW_NOT_FOUND: ${workflowKey}`)
  }
  return comfyUiWorkflowGraphRequiresLlmApi(readWorkflowGraphFromFile(filePath))
}

function applyRhLlmApiInjection(
  graph: ComfyUiWorkflowGraph,
  llmApi?: ComfyUiWorkflowLlmApiInject,
): void {
  const llmNodes = Object.values(graph).filter((node) => isRhLlmApiNode(node))
  if (llmNodes.length === 0) return

  const baseUrl = readTrimmedString(llmApi?.baseUrl).replace(/\/+$/, '')
  const apiKey = readTrimmedString(llmApi?.apiKey)
  const model = readTrimmedString(llmApi?.model)
  if (!baseUrl || !apiKey || !model) {
    throw new Error('COMFYUI_LLM_MODEL_NOT_CONFIGURED: configure analysisModel with an OpenRouter/OpenAI-compatible LLM')
  }

  for (const node of llmNodes) {
    node.inputs.api_baseurl = baseUrl
    node.inputs.api_key = apiKey
    node.inputs.model = model
  }
}

function isConnectionValue(value: unknown): value is [unknown, unknown, ...unknown[]] {
  return Array.isArray(value) && value.length >= 2
}

function cloneConnectionValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function bypassOptionalModelNodes(graph: ComfyUiWorkflowGraph): void {
  const removableNodeIds = Object.entries(graph)
    .filter(([, node]) => OPTIONAL_MODEL_BYPASS_NODE_TYPES.has(node.class_type.trim().toLowerCase()))
    .map(([nodeId]) => nodeId)
    .sort(compareNodeIds)

  for (const nodeId of removableNodeIds) {
    const node = graph[nodeId]
    if (!node || !isRecord(node.inputs)) continue

    const upstreamModel = node.inputs.model
    if (!upstreamModel) continue

    for (const candidate of Object.values(graph)) {
      if (!isRecord(candidate.inputs)) continue
      for (const [field, rawValue] of Object.entries(candidate.inputs)) {
        if (!isConnectionValue(rawValue)) continue
        if (normalizeNodeId(rawValue[0]) !== nodeId) continue
        candidate.inputs[field] = cloneConnectionValue(upstreamModel)
      }
    }

    delete graph[nodeId]
  }
}

function readStaticInputValue(
  graph: ComfyUiWorkflowGraph,
  value: unknown,
  seen: Set<string>,
): unknown {
  if (!isConnectionValue(value)) return value
  const sourceNodeId = normalizeNodeId(value[0])
  if (!sourceNodeId) return undefined
  return resolveStaticNodeValue(graph, sourceNodeId, seen)
}

function readStaticInputByName(
  graph: ComfyUiWorkflowGraph,
  node: ComfyUiWorkflowGraphNode,
  inputNames: string[],
  seen: Set<string>,
): unknown {
  for (const inputName of inputNames) {
    if (!Object.prototype.hasOwnProperty.call(node.inputs, inputName)) continue
    const value = readStaticInputValue(graph, node.inputs[inputName], seen)
    if (value !== undefined) return value
  }
  return undefined
}

function toStaticString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toStaticNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

type StaticNumericToken =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'leftParen' }
  | { type: 'rightParen' }
  | { type: 'comma' }
  | { type: 'eof' }

const STATIC_NUMERIC_FUNCTIONS: Record<string, (values: number[]) => number | null> = {
  floor: (values) => values.length === 1 ? Math.floor(values[0] ?? 0) : null,
  ceil: (values) => values.length === 1 ? Math.ceil(values[0] ?? 0) : null,
  round: (values) => values.length === 1 ? Math.round(values[0] ?? 0) : null,
  min: (values) => values.length > 0 ? Math.min(...values) : null,
  max: (values) => values.length > 0 ? Math.max(...values) : null,
}

function isIdentifierStart(char: string): boolean {
  return /[a-zA-Z_]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char)
}

function tokenizeStaticNumericExpression(expression: string): StaticNumericToken[] | null {
  const tokens: StaticNumericToken[] = []
  let index = 0

  while (index < expression.length) {
    const char = expression[index] ?? ''
    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'operator', value: char })
      index += 1
      continue
    }
    if (char === '(') {
      tokens.push({ type: 'leftParen' })
      index += 1
      continue
    }
    if (char === ')') {
      tokens.push({ type: 'rightParen' })
      index += 1
      continue
    }
    if (char === ',') {
      tokens.push({ type: 'comma' })
      index += 1
      continue
    }

    if (isIdentifierStart(char)) {
      const start = index
      index += 1
      while (index < expression.length && isIdentifierPart(expression[index] ?? '')) {
        index += 1
      }
      tokens.push({ type: 'identifier', value: expression.slice(start, index) })
      continue
    }

    if (/\d/.test(char) || (char === '.' && /\d/.test(expression[index + 1] ?? ''))) {
      const start = index
      if (char === '.') {
        index += 1
        while (index < expression.length && /\d/.test(expression[index] ?? '')) index += 1
      } else {
        while (index < expression.length && /\d/.test(expression[index] ?? '')) index += 1
        if (expression[index] === '.') {
          index += 1
          while (index < expression.length && /\d/.test(expression[index] ?? '')) index += 1
        }
      }
      if ((expression[index] === 'e' || expression[index] === 'E') && /[\d+-]/.test(expression[index + 1] ?? '')) {
        const exponentStart = index
        index += 1
        if (expression[index] === '+' || expression[index] === '-') index += 1
        const digitsStart = index
        while (index < expression.length && /\d/.test(expression[index] ?? '')) index += 1
        if (digitsStart === index) index = exponentStart
      }
      const value = Number(expression.slice(start, index))
      if (!Number.isFinite(value)) return null
      tokens.push({ type: 'number', value })
      continue
    }

    return null
  }

  tokens.push({ type: 'eof' })
  return tokens
}

function evaluateStaticNumericExpression(
  expression: string,
  variables: Record<string, number>,
): number | null {
  const tokens = tokenizeStaticNumericExpression(expression.trim())
  if (!tokens) return null
  let cursor = 0
  const peek = () => tokens[cursor] ?? { type: 'eof' as const }
  const consume = () => tokens[cursor++] ?? { type: 'eof' as const }

  const parseExpression = (): number | null => parseAdditive()

  const parsePrimary = (): number | null => {
    const token = consume()
    if (token.type === 'number') return token.value
    if (token.type === 'leftParen') {
      const value = parseExpression()
      if (value === null || peek().type !== 'rightParen') return null
      consume()
      return value
    }
    if (token.type !== 'identifier') return null

    if (peek().type === 'leftParen') {
      consume()
      const args: number[] = []
      if (peek().type !== 'rightParen') {
        while (true) {
          const arg = parseExpression()
          if (arg === null) return null
          args.push(arg)
          if (peek().type !== 'comma') break
          consume()
        }
      }
      if (peek().type !== 'rightParen') return null
      consume()

      const fn = STATIC_NUMERIC_FUNCTIONS[token.value]
      if (!fn) return null
      const result = fn(args)
      return result !== null && Number.isFinite(result) ? result : null
    }

    if (!Object.prototype.hasOwnProperty.call(variables, token.value)) return null
    const value = variables[token.value]
    return Number.isFinite(value) ? value : null
  }

  const parseUnary = (): number | null => {
    const token = peek()
    if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
      consume()
      const value = parseUnary()
      if (value === null) return null
      return token.value === '-' ? -value : value
    }
    return parsePrimary()
  }

  const parseMultiplicative = (): number | null => {
    let value = parseUnary()
    if (value === null) return null

    while (true) {
      const token = peek()
      if (token.type !== 'operator' || (token.value !== '*' && token.value !== '/')) break
      consume()
      const right = parseUnary()
      if (right === null) return null
      value = token.value === '*' ? value * right : value / right
      if (!Number.isFinite(value)) return null
    }

    return value
  }

  function parseAdditive(): number | null {
    let value = parseMultiplicative()
    if (value === null) return null

    while (true) {
      const token = peek()
      if (token.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break
      consume()
      const right = parseMultiplicative()
      if (right === null) return null
      value = token.value === '+' ? value + right : value - right
      if (!Number.isFinite(value)) return null
    }

    return value
  }

  const result = parseExpression()
  return result !== null && peek().type === 'eof' && Number.isFinite(result) ? result : null
}

function resolveStaticNodeValue(
  graph: ComfyUiWorkflowGraph,
  nodeId: string,
  seen: Set<string>,
): unknown {
  if (seen.has(nodeId)) return undefined
  const node = graph[nodeId]
  if (!node) return undefined
  seen.add(nodeId)

  const normalizedClassType = normalizeUiDecorationNodeType(node.class_type)
  if (
    normalizedClassType === 'textinput'
    || normalizedClassType === 'primitivestringmultiline'
    || normalizedClassType === 'primitivestring'
    || normalizedClassType === 'jjktext'
  ) {
    return readStaticInputByName(graph, node, ['text', 'value', 'input_string', 'prompt'], seen)
  }
  if (
    normalizedClassType === 'impactint'
    || normalizedClassType === 'primitiveint'
    || normalizedClassType === 'int'
    || normalizedClassType === 'intconstant'
    || normalizedClassType === 'integer'
    || normalizedClassType === 'floatconstant'
    || normalizedClassType === 'float'
  ) {
    return readStaticInputByName(graph, node, ['value'], seen)
  }
  if (normalizedClassType === 'primitivenode') {
    for (const value of Object.values(node.inputs)) {
      const resolved = readStaticInputValue(graph, value, seen)
      if (resolved !== undefined && !isConnectionValue(resolved)) return resolved
    }
    return undefined
  }
  if (normalizedClassType === 'toint') {
    const value = toStaticNumber(readStaticInputByName(graph, node, ['any', 'value'], seen))
    if (value === null) return undefined
    const roundMethod = toStaticString(node.inputs.round_method)?.trim().toLowerCase()
    if (roundMethod === 'floor') return Math.floor(value)
    if (roundMethod === 'ceil') return Math.ceil(value)
    return Math.round(value)
  }
  if (normalizedClassType === 'inttostring') {
    const value = toStaticNumber(readStaticInputByName(graph, node, ['value', 'int'], seen))
    return value === null ? undefined : String(Math.trunc(value))
  }
  if (normalizedClassType === 'numberclamp') {
    const value = toStaticNumber(readStaticInputByName(graph, node, ['value'], seen))
    if (value === null) return undefined
    const min = toStaticNumber(readStaticInputByName(graph, node, ['min_value', 'min'], seen))
    const max = toStaticNumber(readStaticInputByName(graph, node, ['max_value', 'max'], seen))
    return Math.min(max ?? value, Math.max(min ?? value, value))
  }
  if (
    normalizedClassType === 'comfymathexpression'
    || normalizedClassType === 'commymathexpression'
    || normalizedClassType === 'mathexpressionpysssss'
  ) {
    const expression = toStaticString(readStaticInputByName(graph, node, ['expression'], seen))
    if (!expression) return undefined
    const variables: Record<string, number> = {}
    for (const [field, rawValue] of Object.entries(node.inputs)) {
      if (field === 'expression') continue
      const variableName = field.startsWith('values.')
        ? field.slice('values.'.length).trim()
        : field.trim()
      if (!/^[a-zA-Z_]\w*$/.test(variableName)) continue
      const value = toStaticNumber(readStaticInputValue(graph, rawValue, seen))
      if (value !== null) variables[variableName] = value
    }
    const result = evaluateStaticNumericExpression(expression, variables)
    return result === null ? undefined : result
  }
  if (normalizedClassType === 'batchtextreplace') {
    const source = toStaticString(readStaticInputByName(graph, node, ['输入文本', 'input', 'text', 'source'], seen))
    if (source === null) return undefined
    let output = source
    for (let index = 1; index <= 20; index += 1) {
      const search = toStaticString(readStaticInputByName(graph, node, [`查找文本${index}`, `find${index}`, `search${index}`], seen))
      if (!search) continue
      const replacement = toStaticString(readStaticInputByName(graph, node, [`替换为${index}`, `replace${index}`, `replacement${index}`], seen)) ?? ''
      output = output.split(search).join(replacement)
    }
    return output
  }
  if (
    normalizedClassType === 'previewany'
    || normalizedClassType === 'showanythingmie'
    || normalizedClassType === 'easyshowanything'
  ) {
    return readStaticInputByName(graph, node, ['source', 'anything', '*', 'text', 'value'], seen)
  }

  return undefined
}

function inlineValueHelperNodes(graph: ComfyUiWorkflowGraph): void {
  const inlineNodeTypes = new Set([
    'batchtextreplace',
    'comfymathexpression',
    'easyshowanything',
    'inttostring',
    'mathexpressionpysssss',
    'numberclamp',
    'previewany',
    'primitivenode',
    'showanythingmie',
    'textinput',
    'toint',
  ])
  let changed = true
  while (changed) {
    changed = false
    const inlineNodeIds = Object.entries(graph)
      .filter(([, node]) => inlineNodeTypes.has(normalizeUiDecorationNodeType(node.class_type)))
      .map(([nodeId]) => nodeId)
      .sort(compareNodeIds)

    for (const nodeId of inlineNodeIds) {
      const node = graph[nodeId]
      if (!node) continue

      const replacement = resolveStaticNodeValue(graph, nodeId, new Set())
      if (replacement === undefined || isConnectionValue(replacement)) continue

      replaceConsumers(graph, nodeId, replacement)
      delete graph[nodeId]
      changed = true
    }
  }
}

function collectMediaOutputNodeIds(graph: ComfyUiWorkflowGraph): string[] {
  return Object.entries(graph)
    .filter(([, node]) => MEDIA_OUTPUT_NODE_TYPES.has(normalizeUiDecorationNodeType(node.class_type)))
    .map(([nodeId]) => nodeId)
    .sort(compareNodeIds)
}

function hasAnyInput(node: ComfyUiWorkflowGraphNode, inputNames: string[]): boolean {
  if (!isRecord(node.inputs)) return false
  return inputNames.some((inputName) => Object.prototype.hasOwnProperty.call(node.inputs, inputName))
}

function hasRequiredVideoOutputInput(node: ComfyUiWorkflowGraphNode): boolean {
  const normalizedClassType = normalizeUiDecorationNodeType(node.class_type)
  if (normalizedClassType === 'vhsvideocombine' || normalizedClassType === 'saveanimatedwebp') {
    return hasAnyInput(node, ['images'])
  }
  if (normalizedClassType === 'savevideo') {
    return hasAnyInput(node, ['images', 'video', 'frames'])
  }
  return true
}

function removeDanglingVideoOutputNodes(graph: ComfyUiWorkflowGraph): void {
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!VIDEO_OUTPUT_NODE_TYPES.has(normalizeUiDecorationNodeType(node.class_type))) continue
    if (hasRequiredVideoOutputInput(node)) continue
    delete graph[nodeId]
  }
}

function removeDisabledVideoOutputNodes(graph: ComfyUiWorkflowGraph): void {
  const videoOutputEntries = Object.entries(graph).filter(([, node]) =>
    VIDEO_OUTPUT_NODE_TYPES.has(normalizeUiDecorationNodeType(node.class_type))
  )
  const hasActiveVideoOutput = videoOutputEntries.some(([, node]) =>
    hasRequiredVideoOutputInput(node) && node.inputs.save_output !== false
  )
  if (!hasActiveVideoOutput) return

  for (const [nodeId, node] of videoOutputEntries) {
    if (node.inputs.save_output !== false) continue
    if (graphHasConsumers(graph, nodeId)) continue
    delete graph[nodeId]
  }
}

function collectInputConnectionNodeIds(node: ComfyUiWorkflowGraphNode): string[] {
  if (!isRecord(node.inputs)) return []
  return Object.values(node.inputs)
    .filter(isConnectionValue)
    .map((value) => normalizeNodeId(value[0]))
    .filter((nodeId): nodeId is string => !!nodeId)
}

function pruneUnreachableFromMediaOutputs(graph: ComfyUiWorkflowGraph): void {
  const mediaOutputNodeIds = collectMediaOutputNodeIds(graph)
  if (mediaOutputNodeIds.length === 0) return

  const reachableNodeIds = new Set<string>()
  const stack = [...mediaOutputNodeIds]
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId || reachableNodeIds.has(nodeId)) continue
    const node = graph[nodeId]
    if (!node) continue
    reachableNodeIds.add(nodeId)
    stack.push(...collectInputConnectionNodeIds(node))
  }

  for (const nodeId of Object.keys(graph)) {
    if (!reachableNodeIds.has(nodeId)) {
      delete graph[nodeId]
    }
  }
}

function isLikelyNegativeNode(node: ComfyUiWorkflowGraphNode): boolean {
  const title = readTrimmedString(node._meta?.title).toLowerCase()
  return title.includes('negative') || title.includes('neg') || title.includes('负面')
}

function isPromptInputField(inputName: string): boolean {
  return inputName === 'prompt'
    || inputName === 'text'
    || inputName === 'positive'
    || inputName === 'positive_prompt'
    || inputName === 'global_prompt'
    || inputName === 'local_prompts'
}

function isNegativePromptField(inputName: string): boolean {
  return inputName === 'negative' || inputName === 'negative_prompt'
}

type ConditioningRole = 'positive' | 'negative'

function isTextEncodeNode(node: ComfyUiWorkflowGraphNode): boolean {
  return node.class_type.toLowerCase().includes('textencode')
}

function isPromptRelayEncodeNode(node: ComfyUiWorkflowGraphNode): boolean {
  return node.class_type.trim().toLowerCase().includes('promptrelay')
}

function isPromptRelaySmartEncodeNode(node: ComfyUiWorkflowGraphNode): boolean {
  return normalizeUiDecorationNodeType(node.class_type).includes('promptrelaysmart')
}

function isAudioTranscriptionNode(node: ComfyUiWorkflowGraphNode): boolean {
  const classType = node.class_type.toLowerCase()
  const title = readTrimmedString(node._meta?.title).toLowerCase()
  return classType.includes('whisper')
    || classType.includes('transcrib')
    || classType.includes('speechrecognition')
    || title.includes('whisper')
    || title.includes('转写')
    || title.includes('识别')
}

type PromptRelaySectionName = 'GLOBAL' | 'LOCAL' | 'LENGTHS'

function normalizePromptRelaySectionName(value: string): PromptRelaySectionName | null {
  const normalized = value.trim().toUpperCase()
  if (normalized === 'GLOBAL') return 'GLOBAL'
  if (normalized === 'LENGTHS') return 'LENGTHS'
  if (/^LOCAL(?:\s+\d+)?$/.test(normalized)) return 'LOCAL'
  return null
}

function collectPromptRelaySectionMarkers(text: string): Array<{
  section: PromptRelaySectionName
  markerStart: number
  valueStart: number
}> {
  const markers: Array<{
    section: PromptRelaySectionName
    markerStart: number
    valueStart: number
  }> = []
  const pattern = /\b(GLOBAL|LOCAL(?:\s+\d+)?|LENGTHS)\s*[:\uFF1A]/gi

  for (const match of text.matchAll(pattern)) {
    const markerStart = match.index ?? -1
    if (markerStart < 0) continue
    const previous = markerStart > 0 ? text[markerStart - 1] : ''
    if (previous && /[A-Za-z0-9_]/.test(previous)) continue

    const section = normalizePromptRelaySectionName(match[1] || '')
    if (!section) continue
    markers.push({
      section,
      markerStart,
      valueStart: markerStart + match[0].length,
    })
  }

  return markers
}

function extractPromptRelaySection(text: string, section: 'GLOBAL' | 'LOCAL'): string {
  const markers = collectPromptRelaySectionMarkers(text)
  const sectionValues = markers.flatMap((marker, index) => {
    if (marker.section !== section) return []
    const nextMarker = markers[index + 1]
    const value = text.slice(marker.valueStart, nextMarker?.markerStart ?? text.length).trim()
    return value ? [value] : []
  })
  return sectionValues.join(' | ')
}

function extractPromptRelayLengths(text: string): number[] | null {
  const markers = collectPromptRelaySectionMarkers(text)
  const markerIndex = markers.findIndex((marker) => marker.section === 'LENGTHS')
  if (markerIndex < 0) return null

  const marker = markers[markerIndex]
  const rawValue = text.slice(marker.valueStart, markers[markerIndex + 1]?.markerStart ?? text.length).trim()
  const numericPrefix = rawValue.match(/^(\d+(?:\s*,\s*\d+)*)(?=\s*(?:$|[\r\n.!?。；;]))/)?.[1]
  if (!numericPrefix) return null

  const parts = numericPrefix.split(',').map((item) => item.trim())
  if (parts.length === 0 || parts.some((item) => !/^\d+$/.test(item))) return null

  const values = parts.map(Number)
  return values.every((value) => Number.isSafeInteger(value) && value > 0) ? values : null
}

function derivePromptRelayInput(prompt: string, field: 'global_prompt' | 'local_prompts'): string {
  const explicitGlobal = extractPromptRelaySection(prompt, 'GLOBAL')
  const explicitLocal = extractPromptRelaySection(prompt, 'LOCAL')
  if (field === 'global_prompt') {
    return explicitGlobal || prompt
  }
  return explicitLocal || prompt
}

function assignStringInputValue(
  graph: ComfyUiWorkflowGraph,
  node: ComfyUiWorkflowGraphNode,
  inputName: string,
  value: string,
): void {
  const currentValue = node.inputs[inputName]
  if (tryAssignPromptToConnectedValueNode(graph, currentValue, value)) return
  if (!isConnectionValue(currentValue)) {
    node.inputs[inputName] = value
  }
}

function collectConditioningRolesBySource(graph: ComfyUiWorkflowGraph): Map<string, Set<ConditioningRole>> {
  const rolesBySource = new Map<string, Set<ConditioningRole>>()

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue

    for (const [field, value] of Object.entries(node.inputs)) {
      if (!isConnectionValue(value)) continue

      const normalizedField = field.trim().toLowerCase()
      const role: ConditioningRole | null =
        normalizedField === 'positive' || normalizedField === 'positive_prompt'
          ? 'positive'
          : normalizedField === 'negative' || normalizedField === 'negative_prompt'
            ? 'negative'
            : null
      if (!role) continue

      const sourceNodeId = normalizeNodeId(value[0])
      if (!sourceNodeId) continue

      const roles = rolesBySource.get(sourceNodeId) ?? new Set<ConditioningRole>()
      roles.add(role)
      rolesBySource.set(sourceNodeId, roles)
    }
  }

  return rolesBySource
}

function getSoleConditioningRole(
  rolesBySource: Map<string, Set<ConditioningRole>>,
  nodeId: string,
): ConditioningRole | null {
  const roles = rolesBySource.get(nodeId)
  if (!roles || roles.size !== 1) return null
  return Array.from(roles)[0] ?? null
}

function isPromptCapableNode(node: ComfyUiWorkflowGraphNode): boolean {
  const fieldNames = Object.keys(node.inputs).map((field) => field.trim().toLowerCase())
  if (fieldNames.some((field) =>
    field === 'prompt'
    || field === 'text'
    || field === 'positive'
    || field === 'positive_prompt'
    || field === 'negative'
    || field === 'negative_prompt'
  )) {
    return true
  }

  const classType = node.class_type.toLowerCase()
  const title = readTrimmedString(node._meta?.title).toLowerCase()
  return classType.includes('prompt')
    || classType.includes('textencode')
    || classType.includes('string')
    || title.includes('prompt')
    || title.includes('提示')
    || title.includes('文案')
    || title.includes('文本')
}

function tryAssignPromptToConnectedValueNode(
  graph: ComfyUiWorkflowGraph,
  connection: unknown,
  value: string,
): boolean {
  if (!isConnectionValue(connection)) return false

  const sourceNodeId = normalizeNodeId(connection[0])
  if (!sourceNodeId) return false

  const sourceNode = graph[sourceNodeId]
  if (!sourceNode || !isRecord(sourceNode.inputs)) return false

  for (const field of CONNECTED_PROMPT_SOURCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(sourceNode.inputs, field)) continue
    if (isConnectionValue(sourceNode.inputs[field])) continue

    sourceNode.inputs[field] = value
    return true
  }

  return false
}

function applyPromptHeuristics(
  graph: ComfyUiWorkflowGraph,
  prompt?: string,
  negativePrompt?: string,
): void {
  const positiveValue = readTrimmedString(prompt)
  const negativeValue = readTrimmedString(negativePrompt)
  if (!positiveValue && !negativeValue) return

  const nodeEntries = Object.entries(graph).sort(([a], [b]) => compareNodeIds(a, b))
  const conditioningRolesBySource = collectConditioningRolesBySource(graph)
  for (const [nodeId, node] of nodeEntries) {
    if (!isRecord(node.inputs) || !isPromptCapableNode(node)) continue

    const conditioningRole = getSoleConditioningRole(conditioningRolesBySource, nodeId)
    for (const inputName of Object.keys(node.inputs)) {
      const field = inputName.trim().toLowerCase()
      if (!field) continue
      const currentValue = node.inputs[inputName]

      if (field === 'prompt' && isAudioTranscriptionNode(node)) {
        continue
      }

      if (
        conditioningRole === 'negative'
        && isTextEncodeNode(node)
        && isPromptInputField(field)
      ) {
        node.inputs[inputName] = negativeValue
        continue
      }

      if (
        positiveValue
        && conditioningRole === 'positive'
        && isTextEncodeNode(node)
        && field === 'prompt'
      ) {
        node.inputs[inputName] = positiveValue
        continue
      }

      if (negativeValue && (isNegativePromptField(field) || (field === 'text' && isLikelyNegativeNode(node)))) {
        if (tryAssignPromptToConnectedValueNode(graph, currentValue, negativeValue)) continue
        if (!isConnectionValue(currentValue)) {
          node.inputs[inputName] = negativeValue
        }
        continue
      }

      if (positiveValue && isPromptInputField(field) && !isLikelyNegativeNode(node)) {
        const nextValue = isPromptRelayEncodeNode(node) && (field === 'global_prompt' || field === 'local_prompts')
          ? derivePromptRelayInput(positiveValue, field)
          : positiveValue
        assignStringInputValue(graph, node, inputName, nextValue)
      }
    }
  }

  if (positiveValue) {
    for (const node of Object.values(graph)) {
      if (!isRecord(node.inputs) || !isPromptRelayEncodeNode(node)) continue
      if (Object.prototype.hasOwnProperty.call(node.inputs, 'global_prompt')) {
        assignStringInputValue(graph, node, 'global_prompt', derivePromptRelayInput(positiveValue, 'global_prompt'))
      }
      if (Object.prototype.hasOwnProperty.call(node.inputs, 'local_prompts')) {
        assignStringInputValue(graph, node, 'local_prompts', derivePromptRelayInput(positiveValue, 'local_prompts'))
      }
    }
  }
}

function clampDimension(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(64, Math.min(4096, Math.round(value)))
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b > 0) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

function formatAspectRatio(width: number, height: number): string {
  const ratio = width / height
  const supportedRatios: Array<[string, number]> = [
    ['1:1', 1],
    ['3:2', 3 / 2],
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['2:3', 2 / 3],
    ['3:4', 3 / 4],
    ['9:16', 9 / 16],
  ]
  const nearest = supportedRatios
    .map(([label, value]) => ({ label, distance: Math.abs(ratio - value) / value }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (nearest && nearest.distance <= 0.05) return nearest.label

  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function clampPositiveInteger(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(1, Math.round(value))
}

function ceilPositiveInteger(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(1, Math.ceil(value))
}

function clampPositiveFloat(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0.1, Number(value.toFixed(3)))
}

function applyDimensionHeuristics(
  graph: ComfyUiWorkflowGraph,
  width?: number,
  height?: number,
): void {
  const nextWidth = clampDimension(width)
  const nextHeight = clampDimension(height)
  if (nextWidth === null && nextHeight === null) return
  const longestSide = Math.max(nextWidth ?? 0, nextHeight ?? 0)
  const aspectRatio = nextWidth !== null && nextHeight !== null
    ? formatAspectRatio(nextWidth, nextHeight)
    : null

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue

    if (nextWidth !== null && Object.prototype.hasOwnProperty.call(node.inputs, 'width')) {
      const currentValue = node.inputs.width
      if (isConnectionValue(currentValue)) {
        const sourceNodeId = normalizeNodeId(currentValue[0])
        if (sourceNodeId) setNumericValueOnNode(graph[sourceNodeId], nextWidth)
      } else {
        node.inputs.width = nextWidth
      }
    }
    if (nextHeight !== null && Object.prototype.hasOwnProperty.call(node.inputs, 'height')) {
      const currentValue = node.inputs.height
      if (isConnectionValue(currentValue)) {
        const sourceNodeId = normalizeNodeId(currentValue[0])
        if (sourceNodeId) setNumericValueOnNode(graph[sourceNodeId], nextHeight)
      } else {
        node.inputs.height = nextHeight
      }
    }
    if (aspectRatio && Object.prototype.hasOwnProperty.call(node.inputs, 'aspect_ratio')) {
      const currentValue = node.inputs.aspect_ratio
      if (isConnectionValue(currentValue)) {
        const sourceNodeId = normalizeNodeId(currentValue[0])
        if (sourceNodeId) setStringValueOnNode(graph[sourceNodeId], aspectRatio)
      } else {
        node.inputs.aspect_ratio = aspectRatio
      }
    }
    if (longestSide > 0 && Object.prototype.hasOwnProperty.call(node.inputs, 'scale_to_length')) {
      const currentValue = node.inputs.scale_to_length
      if (isConnectionValue(currentValue)) {
        const sourceNodeId = normalizeNodeId(currentValue[0])
        if (sourceNodeId) setNumericValueOnNode(graph[sourceNodeId], longestSide)
      } else {
        node.inputs.scale_to_length = longestSide
      }
    }
  }
}

function applyImageInjection(graph: ComfyUiWorkflowGraph, imageFilenames?: string[]): void {
  const loadNodes = Object.entries(graph)
    .filter(([, node]) => node.class_type.toLowerCase().includes('loadimage'))
    .sort(([a], [b]) => compareNodeIds(a, b))

  if (loadNodes.length === 0) return

  const filenames = Array.isArray(imageFilenames)
    ? imageFilenames.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0)
    : []
  const fallbackFilename = filenames[filenames.length - 1] || null

  loadNodes.forEach(([, node], index) => {
    const filename = filenames[index] || fallbackFilename
    if (filename) {
      node.inputs.image = filename
    } else {
      delete node.inputs.image
    }
    delete node.inputs.upload
    delete node.inputs.imageUI
    delete node.inputs.imageui
  })
}

function applyAudioInjection(graph: ComfyUiWorkflowGraph, audioFilenames?: string[]): void {
  const loadNodes = Object.entries(graph)
    .filter(([, node]) => node.class_type.toLowerCase().includes('loadaudio'))
    .sort(([a], [b]) => compareNodeIds(a, b))

  if (loadNodes.length === 0) return

  const filenames = Array.isArray(audioFilenames)
    ? audioFilenames.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0)
    : []
  const fallbackFilename = filenames[filenames.length - 1] || null

  loadNodes.forEach(([, node], index) => {
    const filename = filenames[index] || fallbackFilename
    if (filename) {
      node.inputs.audio = filename
    }
    delete node.inputs.audioUI
    delete node.inputs.audioui
    delete node.inputs.upload
  })
}

function applyVideoInjection(graph: ComfyUiWorkflowGraph, videoFilenames?: string[]): void {
  const loadNodes = Object.entries(graph)
    .filter(([, node]) => node.class_type.toLowerCase().includes('loadvideo'))
    .sort(([a], [b]) => compareNodeIds(a, b))

  if (loadNodes.length === 0) return

  const filenames = Array.isArray(videoFilenames)
    ? videoFilenames.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0)
    : []
  const fallbackFilename = filenames[filenames.length - 1] || null

  loadNodes.forEach(([, node], index) => {
    const filename = filenames[index] || fallbackFilename
    if (filename) {
      node.inputs.file = filename
    } else {
      delete node.inputs.file
    }
    delete node.inputs.upload
  })
}

function validateVideoSeamWorkflowContract(
  graph: ComfyUiWorkflowGraph,
  workflowKey: string,
): void {
  if (normalizeWorkflowKey(workflowKey) !== 'basevideo/tools/video-seam-concat-nvenc') return

  const expectedNodes = [
    { nodeId: '1', classType: 'LoadVideo', inputField: 'file' },
    { nodeId: '2', classType: 'LoadVideo', inputField: 'file' },
    { nodeId: '7', classType: 'ComfyMathExpression', inputField: 'values.b' },
    { nodeId: '8', classType: 'ComfyMathExpression', inputField: 'values.b' },
    { nodeId: '10', classType: 'ImageFromBatch', inputField: 'batch_index' },
    { nodeId: '13', classType: 'ComfyMathExpression', inputField: 'values.a' },
  ] as const

  for (const { nodeId, classType, inputField } of expectedNodes) {
    const node = graph[nodeId]
    if (
      !node
      || node.class_type !== classType
      || !isRecord(node.inputs)
      || !Object.prototype.hasOwnProperty.call(node.inputs, inputField)
    ) {
      throw new Error(
        `COMFYUI_VIDEO_SEAM_WORKFLOW_CONTRACT_INVALID: node ${nodeId} must be ${classType} with input ${inputField}`,
      )
    }
  }
}

function applyVideoSeamTrimInjection(
  graph: ComfyUiWorkflowGraph,
  workflowKey: string,
  videoTrimFrames?: [number, number],
): void {
  if (normalizeWorkflowKey(workflowKey) !== 'basevideo/tools/video-seam-concat-nvenc') return
  if (!videoTrimFrames) return

  const [trimEndFrames, trimStartFrames] = videoTrimFrames
  if (!isValidVideoTrimFrames(trimEndFrames)) {
    throw new Error(
      `COMFYUI_VIDEO_SEAM_TRIM_END_FRAMES_INVALID: expected an integer between 0 and ${VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES}`,
    )
  }
  if (!isValidVideoTrimFrames(trimStartFrames)) {
    throw new Error(
      `COMFYUI_VIDEO_SEAM_TRIM_START_FRAMES_INVALID: expected an integer between 0 and ${VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES}`,
    )
  }
  const video1RetainedFrames = graph['7']
  const video2RetainedFrames = graph['8']
  const video2Images = graph['10']

  video1RetainedFrames.inputs['values.b'] = trimEndFrames
  video2RetainedFrames.inputs['values.b'] = trimStartFrames
  video2Images.inputs.batch_index = trimStartFrames
  const video2AudioStart = graph['13']
  video2AudioStart.inputs['values.a'] = trimStartFrames
}

function applyKjResizeHeuristics(graph: ComfyUiWorkflowGraph): void {
  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue
    if (node.class_type.trim().toLowerCase() !== 'imageresizekjv2') continue

    const upscaleMethod = readTrimmedString(node.inputs.upscale_method).toLowerCase()
    const device = readTrimmedString(node.inputs.device).toLowerCase()

    // Current KJNodes rejects lanczos on GPU at execution time.
    // Keep the workflow's requested lanczos resize, but move it to CPU.
    if (upscaleMethod === 'lanczos' && device === 'gpu') {
      node.inputs.device = 'cpu'
    }
  }
}

function setNumericValueOnNode(node: ComfyUiWorkflowGraphNode | undefined, value: number): boolean {
  if (!node || !isRecord(node.inputs)) return false

  for (const field of ['value', 'length', 'duration', 'a', 'number']) {
    if (!Object.prototype.hasOwnProperty.call(node.inputs, field)) continue
    if (isConnectionValue(node.inputs[field])) continue
    node.inputs[field] = value
    return true
  }

  return false
}

function setStringValueOnNode(node: ComfyUiWorkflowGraphNode | undefined, value: string): boolean {
  if (!node || !isRecord(node.inputs)) return false

  for (const field of ['value', 'text', 'string', 'input_string']) {
    if (!Object.prototype.hasOwnProperty.call(node.inputs, field)) continue
    if (isConnectionValue(node.inputs[field])) continue
    node.inputs[field] = value
    return true
  }

  return false
}

function applyTemporalHeuristics(
  graph: ComfyUiWorkflowGraph,
  fps?: number,
  targetFrameCount?: number,
  durationSeconds?: number,
): void {
  const nextFps = clampPositiveFloat(fps)
  const nextFrames = clampPositiveInteger(targetFrameCount)
  const nextDurationSteps = ceilPositiveInteger(durationSeconds)
  if (nextFps === null && nextFrames === null && nextDurationSteps === null) return

  const fpsFields = new Set(['frame_rate', 'fps'])
  const frameCountFields = new Set(['frames_number', 'frame_count', 'frames', 'length', 'max_frames'])

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue
    const nodeTitle = readTrimmedString(node._meta?.title).toLowerCase().replace(/[^a-z0-9]+/g, '')

    if (
      nextDurationSteps !== null
      && nodeTitle.includes('configframecount')
      && !isConnectionValue(node.inputs.value)
      && Object.prototype.hasOwnProperty.call(node.inputs, 'value')
    ) {
      node.inputs.value = nextDurationSteps
    }

    if (
      nextFps !== null
      && nodeTitle.includes('configframerate')
      && !isConnectionValue(node.inputs.value)
      && Object.prototype.hasOwnProperty.call(node.inputs, 'value')
    ) {
      node.inputs.value = nextFps
    }

    for (const [field, rawValue] of Object.entries(node.inputs)) {
      const normalizedField = field.trim().toLowerCase()
      const wantsFps = nextFps !== null && fpsFields.has(normalizedField)
      const wantsFrames = nextFrames !== null && frameCountFields.has(normalizedField)
      if (!wantsFps && !wantsFrames) continue

      const nextValue = wantsFps ? nextFps : nextFrames!
      if (isConnectionValue(rawValue)) {
        const sourceNodeId = normalizeNodeId(rawValue[0])
        if (!sourceNodeId) continue
        if (setNumericValueOnNode(graph[sourceNodeId], nextValue)) continue
      } else {
        node.inputs[field] = nextValue
      }
    }
  }
}

type Ltx23WorkflowNodeContract = {
  durationNodeIds?: string[]
  audioTrimDurationNodeIds?: string[]
  fpsNodeIds?: string[]
  frameCountNodeIds?: string[]
  promptRelaySegmentCount?: number
  promptRelaySmartSegmentCount?: number
  lockPromptRelayInputs?: boolean
  fixedResizeNodeIds?: string[]
  fixedResizeLongestSide?: number
}

const LTX23_WORKFLOW_NODE_CONTRACTS: Record<string, Ltx23WorkflowNodeContract> = {
  [COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise]: {
    audioTrimDurationNodeIds: ['628'],
    promptRelaySmartSegmentCount: 4,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.microDetail]: {
    promptRelaySmartSegmentCount: 4,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion]: {
    frameCountNodeIds: ['1372'],
    fpsNodeIds: ['1375'],
    promptRelaySegmentCount: 4,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame]: {
    durationNodeIds: ['236'],
    fpsNodeIds: ['233'],
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s]: {
    durationNodeIds: ['164'],
    fpsNodeIds: ['142'],
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay]: {
    durationNodeIds: ['361'],
    fpsNodeIds: ['405'],
    promptRelaySegmentCount: 5,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2]: {
    durationNodeIds: ['472'],
    fpsNodeIds: ['474'],
    promptRelaySegmentCount: 3,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.multiShotPromptRelayKj]: {
    frameCountNodeIds: ['618'],
    promptRelaySegmentCount: 8,
    lockPromptRelayInputs: true,
    fixedResizeNodeIds: ['619'],
    fixedResizeLongestSide: 1280,
  },
}

function setNumericNodeValue(graph: ComfyUiWorkflowGraph, nodeId: string, value: number): void {
  const node = graph[nodeId]
  if (!node || !isRecord(node.inputs)) return
  if (setNumericValueOnNode(node, value)) return
  node.inputs.value = value
}

function splitFramesEvenly(totalFrames: number, segmentCount: number): number[] {
  const safeTotal = Math.max(1, Math.round(totalFrames))
  const safeCount = Math.max(1, Math.round(segmentCount))
  const base = Math.floor(safeTotal / safeCount)
  let remainder = safeTotal - (base * safeCount)
  return Array.from({ length: safeCount }, () => {
    const value = base + (remainder > 0 ? 1 : 0)
    remainder -= 1
    return Math.max(1, value)
  })
}

function normalizePromptRelayLengths(
  lengths: number[] | null,
  totalFrames: number,
  segmentCount: number,
): number[] | null {
  const safeTotal = Math.max(1, Math.round(totalFrames))
  const safeCount = Math.max(1, Math.round(segmentCount))
  if (!lengths || lengths.length !== safeCount || safeTotal < safeCount) return null
  if (!lengths.every((value) => Number.isSafeInteger(value) && value > 0)) return null

  const sourceTotal = lengths.reduce((sum, value) => sum + value, 0)
  if (sourceTotal <= 0) return null

  const exact = lengths.map((value) => (value * safeTotal) / sourceTotal)
  const normalized = exact.map((value) => Math.max(1, Math.floor(value)))
  let remaining = safeTotal - normalized.reduce((sum, value) => sum + value, 0)

  const addOrder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  let cursor = 0
  while (remaining > 0) {
    normalized[addOrder[cursor % addOrder.length].index] += 1
    remaining -= 1
    cursor += 1
  }

  const removeOrder = [...addOrder].reverse()
  cursor = 0
  while (remaining < 0) {
    const candidate = removeOrder[cursor % removeOrder.length].index
    if (normalized[candidate] > 1) {
      normalized[candidate] -= 1
      remaining += 1
    }
    cursor += 1
  }

  return normalized
}

function parsePromptRelaySegmentCount(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const count = raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .length
  return count > 0 ? count : null
}

function parsePromptRelaySmartSegmentCount(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const count = Array.from(raw.matchAll(/\[\s*\d+\s*-\s*\d+\s*\]/g)).length
  return count > 0 ? count : null
}

const PROMPT_RELAY_COLORS = ['#4f8edc', '#e07b3a', '#5cb85c', '#d9534f', '#9b6cd6', '#5bc0de']
const LARGE_MOTION_STAGE_SUFFIXES = [
  'Stage 1: start from the source frame, prepare the motion, keep subject identity, clothing, and environment consistent.',
  'Stage 2: expand the visible action with continuous body movement or smooth camera movement, no cuts.',
  'Stage 3: reach the largest motion beat, allow the strongest continuous movement while preserving the same subject and scene.',
  'Stage 4: settle into the new motion state, keep continuity and stabilize the final frame.',
]
const SLOW_CAMERA_MOTION_PATTERNS = [
  /\u6781\u8f7b\u5fae.{0,12}\u7f13(?:\u6162|\u7f13).{0,12}\u63a8(?:\u8fdb|\u8fd1)/u,
  /\u6781\u8f7b\u5fae.{0,18}(?:\u7a33\u5b9a|\u5185\u538b|\u8282\u594f)/u,
  /\u7f13(?:\u6162|\u7f13).{0,8}\u63a8(?:\u8fdb|\u8fd1)/u,
  /\u7f13(?:\u6162|\u7f13).{0,16}\u538b\u8fd1/u,
  /\u8fde\u7eed.{0,8}\u63a8\u8fdb/u,
  /\u63a8\u8fdb.{0,12}(?:\u7a33\u5b9a|\u7d27\u5f20\u611f|\u8282\u594f)/u,
  /(?:\u7f13\u6162|\u7ec6\u5fae|\u6781\u8f7b|\u51e0\u4e4e\u4e0d\u53ef\u5bdf\u89c9).{0,120}(?:\u538b\u8fd1|\u63a8\u8fdb|\u63a8\u8fd1|\u7a33\u5b9a|\u6784\u56fe)/u,
  /\u7a33\u5b9a\u6784\u56fe.{0,140}(?:\u514b\u5236|\u8f7b\u5fae|\u7ec6\u5fae|\u6781\u7ec6\u5c0f)/u,
  /\u53ea\u4fdd\u7559.{0,80}(?:\u514b\u5236|\u8f7b\u5fae|\u7ec6\u5fae|\u6781\u7ec6\u5c0f)/u,
  /\b(?:very\s+)?subtle\s+(?:slow\s+)?(?:push[-\s]?in|dolly|zoom)\b/i,
  /\b(?:continuous|steady)\s+push[-\s]?in\b/i,
  /\bslow\s+(?:push[-\s]?in|dolly|zoom)\b/i,
  /\bstable\s+composition\b.{0,220}\b(?:subtle|tiny|restrained|minimal)\b/i,
]
const SLOW_CAMERA_STAGE_SUFFIXES = [
  'Stage 1: hold the source-frame composition; keep subject identity, clothing, lighting, and room layout fixed.',
  'Stage 2: continue an extremely slow, almost imperceptible camera push-in; no composition jump or new action.',
  'Stage 3: maintain the same slow restrained push-in speed; do not increase motion intensity or reframe the subjects.',
  'Stage 4: gently settle while keeping the final frame close to the source composition and visible subject count.',
]
const AUDIO_TALKING_HEAD_PATTERNS = [
  /\b(?:speak|speaks|speaking|talk|talks|talking|say|says|dialogue|voice|mouth|lip|lips|lip[-\s]?sync)\b/i,
  /(?:\u8bf4\u8bdd|\u8bb2\u8bdd|\u53d1\u8a00|\u5f00\u53e3|\u53e3\u578b|\u5634\u5507|\u5634\u5df4|\u53f0\u8bcd|\u914d\u97f3|\u56de\u7b54|\u63d0\u95ee|\u95ee\u8bdd)/u,
]
const AUDIO_TALKING_HEAD_CLEAN_FRAME_PROMPT =
  'The lower portion of the frame stays clean and unobstructed, with clothing, desk edge, and room background remaining visible and free of glyph-like marks.'
const AUDIO_TALKING_HEAD_STABILITY_PROMPT = [
  'Audio-backed talking-head:',
  'same source-frame composition and same visible subject count throughout.',
  'The speaker follows the requested head and gaze direction with stable identity, clothing, lighting, desk, and room layout.',
  'Use subtle reference audio mouth movement, tiny facial motion, and a restrained slow push-in.',
  AUDIO_TALKING_HEAD_CLEAN_FRAME_PROMPT,
].join(' ')
const AUDIO_TALKING_HEAD_TEXT_ARTIFACT_NEGATIVE_PROMPT = [
  'subtitles',
  'caption',
  'captions',
  'closed captions',
  'lower third',
  'text overlay',
  'on-screen text',
  'readable text',
  'dialogue text',
  'speech text',
  'Chinese characters',
  'English letters',
  'glyph-like marks',
  'signage',
  'watermark',
  'logo',
  'blurry text',
  'distorted text',
  'artifacts around text',
].join(', ')
const KJ_NO_SUBTITLES_NEGATIVE_PROMPT = [
  'subtitles',
  'caption',
  'captions',
  'closed captions',
  'burned-in text',
  'bottom-center subtitle',
  'white subtitle text',
  'lower third',
  'text overlay',
  'on-screen text',
  'readable text',
  'dialogue text',
  'speech text',
  'Chinese characters',
  'English letters',
  'glyph-like marks',
  'signage',
  'watermark',
  'logo',
  'blurry text',
  'distorted text',
  'artifacts around text',
].join(', ')
const AUDIO_TALKING_HEAD_PACKET_LINE_PATTERN =
  /^\s*(?:Panel continuity packet|Mode|Source text|Current shot action|Visible characters|Location lock|Shot\/camera lock|Props lock|Previous shot context|Next shot context|Dialogue lines|Target duration|Creator prompt intent|Hard constraints|Source-frame continuity lock|Allowed visible subjects|Forbidden additions)\s*:/i
const AUDIO_TALKING_HEAD_NEGATIVE_LINE_PATTERN =
  /\b(?:do\s+not|don't|must\s+not|cannot|can't|without|avoid|never|forbidden|no\s+(?:subtitles?|captions?|readable\s+text|new\s+people|new\s+characters|extra\s+people|rotation|profile\s+turns?|head\s+turns?|crowds?|guards?|police|scene\s+cuts?|scene\s+changes?))\b|(?:\u4e0d\u8981|\u4e0d\u5f97|\u4e0d\u80fd|\u7981\u6b62|\u907f\u514d)/iu
const AUDIO_TALKING_HEAD_UNSTABLE_TERM_PATTERN =
  /\b(?:subtitles?|captions?|watermarks?|crowds?|guards?|police|profile\s+turns?|head\s+turns?|extra\s+people|new\s+people|new\s+characters|rotation|rotating|orbiting|spinning|scene\s+cuts?|scene\s+changes?)\b/i
const AUDIO_TALKING_HEAD_TEXT_CONTENT_TERM_PATTERN =
  /(?:字幕|台词|对白字幕|对白文字|画面文字|屏幕文字|可读文字|可读文本|中文字符|英文字符|\bsubtitles?\b|\bcaptions?\b|\bclosed captions?\b|\btext overlays?\b|\breadable text\b|\bdialogue text\b|\bspeech text\b|\bon-screen text\b)/iu

function stripAudioTalkingHeadTextContentClauses(value: string): string {
  const pieces = value.split(/([，,。；;|])/u)
  const kept: string[] = []

  for (let index = 0; index < pieces.length; index += 2) {
    const clause = readTrimmedString(pieces[index])
    const separator = pieces[index + 1] || ''
    if (!clause) continue
    if (AUDIO_TALKING_HEAD_TEXT_CONTENT_TERM_PATTERN.test(clause)) continue
    kept.push(`${clause}${separator}`)
  }

  return kept.join('')
    .replace(/[，,。；;|]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAudioTalkingHeadPositiveIntent(value: string): string {
  const preferred = [
    /^\s*Current shot action\s*:\s*(.+)$/im,
    /^\s*Creator prompt intent\s*:\s*(.+)$/im,
    /^\s*Source text\s*:\s*(.+)$/im,
  ]

  for (const pattern of preferred) {
    const match = value.match(pattern)
    const text = readTrimmedString(match?.[1])
    if (text && !AUDIO_TALKING_HEAD_NEGATIVE_LINE_PATTERN.test(text)) {
      return text
    }
  }

  return ''
}

function sanitizeAudioTalkingHeadPrompt(value: string): string {
  const text = readTrimmedString(value)
  if (!text) return ''
  const intent = extractAudioTalkingHeadPositiveIntent(text)
  const source = intent || text
  const sanitizedIntent = intent ? stripAudioTalkingHeadTextContentClauses(intent) : ''

  const cleaned = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map(stripAudioTalkingHeadTextContentClauses)
    .filter((line) =>
      line.length > 0
      && !AUDIO_TALKING_HEAD_PACKET_LINE_PATTERN.test(line)
      && !AUDIO_TALKING_HEAD_NEGATIVE_LINE_PATTERN.test(line)
      && !AUDIO_TALKING_HEAD_UNSTABLE_TERM_PATTERN.test(line))
    .join('\n')
    .trim()

  return cleaned || sanitizedIntent
}

function derivePromptRelayPositiveInput(
  prompt: string,
  field: 'global_prompt' | 'local_prompts',
  audioTalkingHeadStages: boolean,
): string {
  const value = derivePromptRelayInput(prompt, field)
  return audioTalkingHeadStages ? sanitizeAudioTalkingHeadPrompt(value) : value
}

function shouldUseAudioTalkingHeadStages(prompt: string): boolean {
  return AUDIO_TALKING_HEAD_PATTERNS.some((pattern) => pattern.test(prompt))
}

function alignToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

const SEEDANCE2_BERNINI_LANDSCAPE_SIZE = {
  width: 848,
  height: 464,
  longestSide: 848,
} as const

function isSeedance2BerniniLandscapeSize(size: { width: number; height: number }): boolean {
  return size.width === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.width
    && size.height === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.height
}

function resolveSeedance2BerniniSize(width?: number, height?: number): { width: number; height: number; longestSide: number } {
  const inputWidth = clampDimension(width) ?? 480
  const inputHeight = clampDimension(height) ?? 848
  if (inputWidth === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.width
    && inputHeight === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.height) {
    return { ...SEEDANCE2_BERNINI_LANDSCAPE_SIZE }
  }
  const ratio = inputWidth > 0 && inputHeight > 0 ? inputWidth / inputHeight : 480 / 848
  const shortSide = 480
  const maxLongSide = 848

  if (ratio >= 1) {
    const resolvedWidth = Math.min(maxLongSide, alignToMultiple(shortSide * ratio, 16))
    return {
      width: resolvedWidth,
      height: shortSide,
      longestSide: Math.max(resolvedWidth, shortSide),
    }
  }

  const resolvedHeight = Math.min(maxLongSide, alignToMultiple(shortSide / ratio, 16))
  return {
    width: shortSide,
    height: resolvedHeight,
    longestSide: Math.max(shortSide, resolvedHeight),
  }
}

function formatSeedance2BerniniDuration(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/g, '').replace(/\.$/, '')
}

const SEEDANCE2_BERNINI_NO_ONSCREEN_TEXT_RULES = [
  'Hard visual constraint: Do not render subtitles, captions, lyrics, dialogue text, speech bubbles, lower thirds, karaoke text, UI text, signs, labels, watermarks, logos, Chinese characters, English letters, or any readable text.',
  'Dialogue must stay in audio and lip movement only; never convert spoken words, prompt text, or narration into on-screen text.',
]

const SEEDANCE2_BERNINI_LTX_STYLE_TEXT_NEGATIVE_TERMS = [
  'bad video',
  'Font',
  'Chinese characters',
  'Subtitles',
  'subtitle',
  'subtitles',
  'caption',
  'captions',
  'closed captions',
  'text',
  'watermark',
  'logo',
  'signage',
  'writing',
  'letters',
  'blurry text',
  'distorted text',
  'overlay',
  'lower third',
  'burned-in subtitles',
  'hardcoded subtitles',
  'bottom subtitles',
  'bottom-center subtitles',
  'large white subtitles',
  'Chinese subtitles',
  'white subtitle line',
  'white subtitle text',
  'white outlined glyphs',
  'white text with black shadow',
  'SRT subtitles',
  'incorrect dialogue',
  'added dialogue',
  'karaoke lyrics',
  'lyrics text',
  'dialogue text',
  'spoken dialogue text',
  'transcribed speech text',
  'onscreen transcript',
  'speaker labels',
  'speech bubbles',
  'lower thirds',
  'lower-third text',
  'text overlay',
  'UI text',
  'readable text',
  'unreadable text on shirt or hat',
  'garbled Chinese glyphs',
  'floating Chinese glyphs',
  'English letters',
  '字幕',
  '中文字幕',
  '对白字幕',
  '文字',
]

const SEEDANCE2_BERNINI_VISUAL_NEGATIVE_PROMPT =
  SEEDANCE2_BERNINI_LTX_STYLE_TEXT_NEGATIVE_TERMS.join(', ')

const SEEDANCE2_BERNINI_LIPSYNC_POSITIVE_PROMPT = [
  'natural mouth movement',
  'stable facial identity',
  'clear mouth articulation',
  'subtle head movement',
  'consistent lighting',
  'clean cinematic frame',
  'unmarked background surfaces',
  'plain natural image details',
  'no scene change',
].join(', ')

const SEEDANCE2_BERNINI_LIPSYNC_NEGATIVE_PROMPT =
  SEEDANCE2_BERNINI_LTX_STYLE_TEXT_NEGATIVE_TERMS.join(', ')

const SEEDANCE2_BERNINI_CLEAN_FRAME_PHRASE = 'clean unmarked cinematic frame with plain surfaces and natural visual detail only'
const CJK_TEXT_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/
const SEEDANCE2_BERNINI_AUDIO_INTENT_FALLBACK =
  'the reference-image subject sits in a quiet office behind a desk, leans slightly forward, glasses reflecting cool overhead light, performs natural rhythmic mouth movement with restrained head and eye motion, and the camera makes a slow gentle push-in'

const SEEDANCE2_BERNINI_AUDIO_INTENT_QUOTED_DIALOGUE_PATTERNS = [
  /"[^"\n]{1,320}"/g,
  /\u201c[^\u201d\n]{1,320}\u201d/g,
  /\u300c[^\u300d\n]{1,320}\u300d/g,
  /\u300e[^\u300f\n]{1,320}\u300f/g,
]

const SEEDANCE2_BERNINI_AUDIO_INTENT_SPEECH_CUE_PATTERNS = [
  /\b(says?|speaks?|talks?|asks?|answers?|utters?)\s*[:\uff1a]\s*[^.\n]+/gi,
  /((?:\u5bf9[^\n:\uff1a]{0,32})?[\u8bf4\u95ee\u7b54]\u9053?)\s*[:\uff1a]\s*[^.\u3002\n]+/g,
]

const SEEDANCE2_BERNINI_AUDIO_INTENT_TEXT_TERM_PATTERNS = [
  /\b(?:no|without|avoid|never render|do not render|do not add)\s+(?:subtitles?|captions?|closed captions?|text overlays?|watermarks?|logos?|signs?|labels?|ui text|readable text|chinese characters|english letters|lower thirds?)\b/gi,
  /\b(?:subtitles?|captions?|closed captions?|text overlays?|watermarks?|logos?|ui text|readable text|chinese characters|english letters|lower thirds?|karaoke text|lyrics text|dialogue text|speech bubbles|on-screen text)\b/gi,
]

function sanitizeSeedance2BerniniAudioVisualIntent(prompt: string): string {
  let next = prompt.trim()
  for (const pattern of SEEDANCE2_BERNINI_AUDIO_INTENT_QUOTED_DIALOGUE_PATTERNS) {
    next = next.replace(pattern, '')
  }
  for (const pattern of SEEDANCE2_BERNINI_AUDIO_INTENT_SPEECH_CUE_PATTERNS) {
    next = next.replace(pattern, '$1')
  }
  for (const pattern of SEEDANCE2_BERNINI_AUDIO_INTENT_TEXT_TERM_PATTERNS) {
    next = next.replace(pattern, '')
  }

  return next
    .replace(/\blip[- ]sync\b/gi, 'mouth movement')
    .replace(/\bspeech\b/gi, 'mouth movement')
    .replace(/\bspeaking\b/gi, 'natural mouth movement')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*,[ \t]*(?=[,.;:\n])/g, '')
    .replace(/(?:,[ \t]*){2,}/g, ', ')
    .replace(/[ \t]+([,.;:])/g, '$1')
    .replace(/^[\s,.;:-]+$/gm, '')
    .trim()
}

function buildSeedance2BerniniAudioVisualIntent(prompt: string): string {
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt || CJK_TEXT_PATTERN.test(trimmedPrompt)) {
    return SEEDANCE2_BERNINI_AUDIO_INTENT_FALLBACK
  }
  return sanitizeSeedance2BerniniAudioVisualIntent(trimmedPrompt) || SEEDANCE2_BERNINI_AUDIO_INTENT_FALLBACK
}

function buildSeedance2BerniniRolePrompt(params: {
  durationSeconds: number
  fps: number
  frameCount: number
  motionStrength: number
  motionLabel: string
  audioDriven: boolean
}): string {
  const durationText = formatSeedance2BerniniDuration(params.durationSeconds)
  if (params.audioDriven) {
    return [
      `You are writing a Seedance2.0 Bernini image-to-video prompt for a ${durationText}-second 480p talking-head shot with lip sync.`,
      `Target timing: ${params.frameCount} frames at ${params.fps} fps.`,
      `Motion policy: motion strength ${params.motionStrength} (${params.motionLabel}); keep motion restrained enough for stable mouth articulation.`,
      'Use the reference image as the visual authority: preserve identity, face, clothing, location, lighting, and composition.',
      'Keep the subject facing camera when possible, with the mouth clearly visible, natural speech motion, small blinks, subtle head movement, and no hand or prop blocking the lips.',
      'Avoid scene cuts, face changes, wardrobe changes, and fast camera movement.',
      ...SEEDANCE2_BERNINI_NO_ONSCREEN_TEXT_RULES,
      'Return one concise cinematic video prompt in English, optimized for Bernini i2v followed by audio-driven lip sync.',
    ].join('\n')
  }

  return [
    `You are writing a Seedance2.0 Bernini image-to-video prompt for a ${durationText}-second 480p shot.`,
    `Target timing: ${params.frameCount} frames at ${params.fps} fps.`,
    `Motion policy: motion strength ${params.motionStrength} (${params.motionLabel}).`,
    'Use the reference image as the visual authority: preserve identity, face, clothing, location, lighting, and composition.',
    'Describe one continuous shot with natural motion and no scene cuts.',
    ...SEEDANCE2_BERNINI_NO_ONSCREEN_TEXT_RULES,
    'Return a concise cinematic video prompt in English, optimized for Bernini i2v.',
  ].join('\n')
}

function buildSeedance2BerniniUserPrompt(params: {
  prompt: string
  durationSeconds: number
  fps: number
  frameCount: number
  motionStrength: number
  motionLabel: string
  width: number
  height: number
  audioDriven: boolean
}): string {
  const durationText = formatSeedance2BerniniDuration(params.durationSeconds)
  if (params.audioDriven) {
    return [
      `Write the Bernini i2v prompt for this ${durationText}-second audio-driven lip sync shot.`,
      `Canvas: ${params.width}x${params.height}, ${params.frameCount} frames, ${params.fps} fps.`,
      `motion strength: ${params.motionStrength} (${params.motionLabel}).`,
      'The subject should naturally speak to camera with a visible mouth, clear facial articulation, stable identity, stable lighting, and no mouth occlusion.',
      ...SEEDANCE2_BERNINI_NO_ONSCREEN_TEXT_RULES,
      'Creator prompt intent:',
      params.prompt || 'animate the source image as a stable talking-head shot for lip sync',
    ].join('\n')
  }

  return [
    `Write the Bernini i2v prompt for this ${durationText}-second shot.`,
    `Canvas: ${params.width}x${params.height}, ${params.frameCount} frames, ${params.fps} fps.`,
    `motion strength: ${params.motionStrength} (${params.motionLabel}).`,
    ...SEEDANCE2_BERNINI_NO_ONSCREEN_TEXT_RULES,
    'Creator prompt intent:',
    params.prompt || 'animate the source image with stable identity and natural motion',
  ].join('\n')
}

function buildSeedance2BerniniAudioFinalPositivePrompt(params: {
  prompt: string
  durationSeconds: number
  fps: number
  frameCount: number
  motionLabel: string
}): string {
  const durationText = formatSeedance2BerniniDuration(params.durationSeconds)
  const intent = buildSeedance2BerniniAudioVisualIntent(params.prompt)
  return [
    `A ${durationText}-second vertical 480p image-to-video portrait shot, ${params.frameCount} frames at ${params.fps} fps.`,
    `Creator visual intent: ${intent}.`,
    'Preserve the reference image identity, face, clothing, office room, cool overhead lighting, desk, wall clock, blinds, and camera composition.',
    `Use restrained ${params.motionLabel} with natural mouth articulation, slight breathing, subtle blinks, stable facial detail, and a gentle slow push-in when compatible with the scene.`,
    'The lower frame stays clean, showing only natural clothing, desk edge, and shadow detail.',
    SEEDANCE2_BERNINI_CLEAN_FRAME_PHRASE,
  ].join(' ')
}

function buildSeedance2BerniniFoleyRolePrompt(params: {
  durationSeconds: number
  fps: number
  frameCount: number
}): string {
  const durationText = formatSeedance2BerniniDuration(params.durationSeconds)
  return [
    `You are writing a concise English Foley prompt for a ${durationText}-second, ${params.frameCount}-frame, ${params.fps} fps talking-head video.`,
    'Describe only natural environmental sound effects and room tone that can mix under voice audio.',
    'Do not include dialogue, lyrics, music, captions, or commentary.',
  ].join('\n')
}

function buildSeedance2BerniniFoleyUserPrompt(params: {
  prompt: string
  durationSeconds: number
}): string {
  const durationText = formatSeedance2BerniniDuration(params.durationSeconds)
  return [
    `Write one Foley prompt under 100 English words for this ${durationText}-second lip sync video.`,
    'Keep the voice line dominant; add only subtle ambience, clothing rustle, breathing, and scene-appropriate small sounds.',
    'Video intent:',
    params.prompt || 'stable talking-head lip sync shot',
  ].join('\n')
}

function applySeedance2BerniniVisualTextGuards(
  graph: ComfyUiWorkflowGraph,
  audioDriven: boolean,
): void {
  const berniniNegativeNode = graph['373']
  if (berniniNegativeNode && isRecord(berniniNegativeNode.inputs)) {
    assignStringInputValue(graph, berniniNegativeNode, 'text', SEEDANCE2_BERNINI_VISUAL_NEGATIVE_PROMPT)
  }

  if (!audioDriven) return

  const lipsyncPositiveNode = graph['1490']
  if (lipsyncPositiveNode && isRecord(lipsyncPositiveNode.inputs)) {
    assignStringInputValue(graph, lipsyncPositiveNode, 'text', SEEDANCE2_BERNINI_LIPSYNC_POSITIVE_PROMPT)
  }

  const lipsyncNegativeNode = graph['1492']
  if (lipsyncNegativeNode && isRecord(lipsyncNegativeNode.inputs)) {
    lipsyncNegativeNode.class_type = 'CLIPTextEncode'
    lipsyncNegativeNode.inputs = {
      clip: ['1491', 0],
      text: SEEDANCE2_BERNINI_LIPSYNC_NEGATIVE_PROMPT,
    }
    lipsyncNegativeNode._meta = {
      ...(lipsyncNegativeNode._meta || {}),
      title: lipsyncNegativeNode._meta?.title || 'Lipsync negative prompt',
    }
  }
}

function applySeedance2BerniniAudioFinalPromptControls(
  graph: ComfyUiWorkflowGraph,
  params: {
    prompt: string
    durationSeconds: number
    fps: number
    frameCount: number
    motionStrength: number
    motionLabel: string
    width: number
    height: number
  },
): void {
  const finalPositiveNode = graph['378']
  if (finalPositiveNode && isRecord(finalPositiveNode.inputs)) {
    finalPositiveNode.inputs.text = buildSeedance2BerniniAudioFinalPositivePrompt(params)
    finalPositiveNode._meta = {
      ...(finalPositiveNode._meta || {}),
      title: finalPositiveNode._meta?.title || 'Bernini final positive prompt',
      waoowaooPromptTrace: {
        stage: 'audio_lipsync_final_positive_prompt',
        source: 'app-controlled-direct',
        cleanFramePhrase: SEEDANCE2_BERNINI_CLEAN_FRAME_PHRASE,
      },
    }
  }

  for (const nodeId of ['386', '412', '532', '409']) {
    delete graph[nodeId]
  }
}

function applySeedance2BerniniWorkflowControls(
  graph: ComfyUiWorkflowGraph,
  workflowKey: string,
  inject: ComfyUiWorkflowInject,
): void {
  if (!isSeedance2BerniniWorkflowKey(workflowKey)) return

  const fps = clampPositiveFloat(inject.fps) ?? SEEDANCE2_BERNINI_DEFAULT_FPS
  const durationSeconds = clampPositiveFloat(inject.durationSeconds) ?? SEEDANCE2_BERNINI_DEFAULT_DURATION_SECONDS
  const frameCount = Math.max(1, Math.round(durationSeconds * fps) + 1)
  const motionStrength = normalizeSeedance2BerniniMotionStrength(inject.motionStrength)
  const motionLabel = resolveSeedance2BerniniMotionStrengthLabel(motionStrength)
  const size = resolveSeedance2BerniniSize(inject.width, inject.height)
  const audioDriven = isSeedance2BerniniAudioWorkflowKey(workflowKey)

  setNumericNodeValue(graph, '390', frameCount)
  if (graph['384'] && !isConnectionValue(graph['384'].inputs.length)) {
    graph['384'].inputs.length = frameCount
  }

  const createVideoNode = graph['374']
  if (createVideoNode && isRecord(createVideoNode.inputs)) {
    createVideoNode.inputs.fps = fps
  }

  const motionLoraNode = graph['399']
  if (motionLoraNode && isRecord(motionLoraNode.inputs)) {
    motionLoraNode.inputs.strength_model = motionStrength
  }
  for (const nodeId of ['398', '400', '402']) {
    const loraNode = graph[nodeId]
    if (loraNode && isRecord(loraNode.inputs)) {
      loraNode.inputs.strength_model = 1
    }
  }

  setNumericNodeValue(graph, '417', size.longestSide)
  const resizeNode = graph['416']
  if (resizeNode && isRecord(resizeNode.inputs)) {
    if (isSeedance2BerniniLandscapeSize(size)) {
      resizeNode.inputs.aspect_ratio = 'custom'
      resizeNode.inputs.proportional_width = 53
      resizeNode.inputs.proportional_height = 29
    } else {
      resizeNode.inputs.aspect_ratio = formatAspectRatio(size.width, size.height)
    }
    resizeNode.inputs.fit = 'crop'
    resizeNode.inputs.method = 'lanczos'
    resizeNode.inputs.round_to_multiple = '16'
    resizeNode.inputs.scale_to_side = 'longest'
  }

  const conditioningNode = graph['384']
  if (conditioningNode && isRecord(conditioningNode.inputs)) {
    if (!isConnectionValue(conditioningNode.inputs.width)) conditioningNode.inputs.width = size.width
    if (!isConnectionValue(conditioningNode.inputs.height)) conditioningNode.inputs.height = size.height
  }

  const promptParams = {
    prompt: readTrimmedString(inject.prompt),
    durationSeconds,
    fps,
    frameCount,
    motionStrength,
    motionLabel,
    width: size.width,
    height: size.height,
    audioDriven,
  }
  const roleNode = graph['421']
  if (roleNode && isRecord(roleNode.inputs)) {
    assignStringInputValue(graph, roleNode, 'prompt', buildSeedance2BerniniRolePrompt(promptParams))
  }
  const userNode = graph['422']
  if (userNode && isRecord(userNode.inputs)) {
    assignStringInputValue(graph, userNode, 'prompt', buildSeedance2BerniniUserPrompt(promptParams))
  }

  applySeedance2BerniniVisualTextGuards(graph, audioDriven)

  if (!audioDriven) return

  applySeedance2BerniniAudioFinalPromptControls(graph, promptParams)

  const foleyMixNode = graph['2524']
  const finalVideoNode = graph['1503']
  if (finalVideoNode && isRecord(finalVideoNode.inputs)) {
    finalVideoNode.inputs.save_output = true
    if (foleyMixNode) {
      finalVideoNode.inputs.audio = ['2524', 0]
    } else if (graph['1507']) {
      finalVideoNode.inputs.audio = ['1507', 0]
    }
    if (!isConnectionValue(finalVideoNode.inputs.filename_prefix)) {
      finalVideoNode.inputs.filename_prefix = 'video/Bernini-T10-lipsync'
    }
  }

  const foleyPreviewNode = graph['2523']
  if (foleyPreviewNode && isRecord(foleyPreviewNode.inputs)) {
    foleyPreviewNode.inputs.save_output = false
  }
  delete graph['2467']

  const foleyRoleNode = graph['2463']
  if (foleyRoleNode && isRecord(foleyRoleNode.inputs)) {
    assignStringInputValue(graph, foleyRoleNode, 'prompt', buildSeedance2BerniniFoleyRolePrompt({
      durationSeconds,
      fps,
      frameCount,
    }))
  }

  const foleyPromptNode = graph['2458']
  if (foleyPromptNode && isRecord(foleyPromptNode.inputs)) {
    assignStringInputValue(graph, foleyPromptNode, 'prompt', buildSeedance2BerniniFoleyUserPrompt({
      prompt: promptParams.prompt,
      durationSeconds,
    }))
  }
}

function shouldUseSlowCameraStages(prompt: string): boolean {
  return SLOW_CAMERA_MOTION_PATTERNS.some((pattern) => pattern.test(prompt))
}

function stripPromptRelayFrameRange(value: string): string {
  return value.replace(/\s*\[\s*\d+\s*-\s*\d+\s*\]\s*$/g, '').trim()
}

export function splitPromptRelayLocalSegments(prompt: string): string[] {
  const localPrompt = derivePromptRelayInput(prompt, 'local_prompts')
  const segments = localPrompt
    .split('|')
    .map((segment) => stripPromptRelayFrameRange(segment))
    .filter((segment) => segment.length > 0)
  return segments.length > 1 ? segments : []
}

function countPromptRelayLocalSegments(prompt: string): number | null {
  const count = splitPromptRelayLocalSegments(prompt).length
  return count > 1 ? count : null
}

function buildPromptRelaySegmentPrompts(
  prompt: string,
  segmentCount: number,
  largeMotionStages: boolean,
  audioTalkingHeadStages: boolean = false,
): string[] {
  const explicitSegments = splitPromptRelayLocalSegments(prompt)
  if (explicitSegments.length > 0) {
    return Array.from({ length: segmentCount }, (_, index) => {
      const segment = explicitSegments[index] || explicitSegments[explicitSegments.length - 1] || ''
      if (!audioTalkingHeadStages || !shouldUseAudioTalkingHeadStages(segment)) return segment
      return [
        sanitizeAudioTalkingHeadPrompt(segment),
        AUDIO_TALKING_HEAD_STABILITY_PROMPT,
      ].filter(Boolean).join('\n')
    })
  }

  const localPrompt = derivePromptRelayPositiveInput(prompt, 'local_prompts', audioTalkingHeadStages)
  const fallbackPrompt = localPrompt || derivePromptRelayPositiveInput(prompt, 'global_prompt', audioTalkingHeadStages) || prompt
  if (audioTalkingHeadStages && shouldUseAudioTalkingHeadStages(fallbackPrompt)) {
    const stablePrompt = [
      sanitizeAudioTalkingHeadPrompt(fallbackPrompt),
      AUDIO_TALKING_HEAD_STABILITY_PROMPT,
    ].filter(Boolean).join('\n')
    return Array.from({ length: segmentCount }, () => stablePrompt)
  }
  if (!largeMotionStages) {
    return Array.from({ length: segmentCount }, () => fallbackPrompt)
  }

  const stageSuffixes = shouldUseSlowCameraStages(fallbackPrompt)
    ? SLOW_CAMERA_STAGE_SUFFIXES
    : LARGE_MOTION_STAGE_SUFFIXES

  return Array.from({ length: segmentCount }, (_, index) => {
    const suffix = stageSuffixes[index] || stageSuffixes[stageSuffixes.length - 1]
    return `${fallbackPrompt}\n${suffix}`
  })
}

function buildPromptRelayTimelineData(segmentPrompts: string[], lengths: number[]): string {
  return JSON.stringify({
    segments: lengths.map((length, index) => ({
      prompt: segmentPrompts[index] || segmentPrompts[segmentPrompts.length - 1] || '',
      length,
      color: PROMPT_RELAY_COLORS[index % PROMPT_RELAY_COLORS.length],
    })),
  })
}

function buildPromptRelaySmartPrompt(
  prompt: string,
  targetFrameCount: number,
  segmentCount: number,
  largeMotionStages: boolean,
  audioTalkingHeadStages: boolean = false,
): string {
  const lengths = splitFramesEvenly(targetFrameCount, segmentCount)
  const segmentPrompts = buildPromptRelaySegmentPrompts(prompt, lengths.length, largeMotionStages, audioTalkingHeadStages)
  let startFrame = 0

  return lengths.map((length, index) => {
    const endFrame = startFrame + length
    const text = segmentPrompts[index] || segmentPrompts[segmentPrompts.length - 1] || prompt
    const segment = `${text} [${startFrame}-${endFrame}]`
    startFrame = endFrame
    return segment
  }).join(' | ')
}

function applyPromptRelayTimelineControls(
  graph: ComfyUiWorkflowGraph,
  params: {
    prompt: string
    fps: number | null
    targetFrameCount: number | null
    segmentCount?: number
    largeMotionStages?: boolean
    audioTalkingHeadStages?: boolean
    lockInputs?: boolean
  },
): void {
  if (!params.prompt || params.targetFrameCount === null) return

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs) || !isPromptRelayEncodeNode(node)) continue

    const segmentCount = countPromptRelayLocalSegments(params.prompt)
      || params.segmentCount
      || parsePromptRelaySegmentCount(node.inputs.segment_lengths)
      || 1
    const lengths = normalizePromptRelayLengths(
      params.lockInputs ? extractPromptRelayLengths(params.prompt) : null,
      params.targetFrameCount,
      segmentCount,
    ) || splitFramesEvenly(params.targetFrameCount, segmentCount)
    const segmentPrompts = buildPromptRelaySegmentPrompts(
      params.prompt,
      lengths.length,
      params.largeMotionStages === true,
      params.audioTalkingHeadStages === true,
    )

    if (Object.prototype.hasOwnProperty.call(node.inputs, 'global_prompt')) {
      const globalPrompt = derivePromptRelayPositiveInput(
        params.prompt,
        'global_prompt',
        params.audioTalkingHeadStages === true,
      )
      if (params.lockInputs) node.inputs.global_prompt = globalPrompt
      else assignStringInputValue(graph, node, 'global_prompt', globalPrompt)
    }
    if (Object.prototype.hasOwnProperty.call(node.inputs, 'local_prompts')) {
      const localPrompts = segmentPrompts.join(' | ')
      if (params.lockInputs) node.inputs.local_prompts = localPrompts
      else assignStringInputValue(graph, node, 'local_prompts', localPrompts)
    }
    if (Object.prototype.hasOwnProperty.call(node.inputs, 'segment_lengths')) {
      node.inputs.segment_lengths = lengths.join(', ')
    }
    if (Object.prototype.hasOwnProperty.call(node.inputs, 'timeline_data')) {
      node.inputs.timeline_data = buildPromptRelayTimelineData(segmentPrompts, lengths)
    }
    if (Object.prototype.hasOwnProperty.call(node.inputs, 'max_frames')) {
      const currentValue = node.inputs.max_frames
      if (isConnectionValue(currentValue)) {
        const sourceNodeId = normalizeNodeId(currentValue[0])
        if (sourceNodeId) setNumericNodeValue(graph, sourceNodeId, params.targetFrameCount)
      } else {
        node.inputs.max_frames = params.targetFrameCount
      }
    }
    if (params.fps !== null && Object.prototype.hasOwnProperty.call(node.inputs, 'fps')) {
      node.inputs.fps = params.fps
    }
  }
}

function applyPromptRelaySmartControls(
  graph: ComfyUiWorkflowGraph,
  params: {
    prompt: string
    targetFrameCount: number | null
    segmentCount?: number
    largeMotionStages?: boolean
    audioTalkingHeadStages?: boolean
  },
): void {
  if (!params.prompt || params.targetFrameCount === null) return

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs) || !isPromptRelaySmartEncodeNode(node)) continue

    const currentSmartPrompt = readStaticInputValue(graph, node.inputs.smart_prompt, new Set())
    const segmentCount = countPromptRelayLocalSegments(params.prompt)
      || params.segmentCount
      || parsePromptRelaySmartSegmentCount(currentSmartPrompt)
      || 1

    if (Object.prototype.hasOwnProperty.call(node.inputs, 'global_prompt')) {
      assignStringInputValue(
        graph,
        node,
        'global_prompt',
        derivePromptRelayPositiveInput(params.prompt, 'global_prompt', params.audioTalkingHeadStages === true),
      )
    }
    if (Object.prototype.hasOwnProperty.call(node.inputs, 'smart_prompt')) {
      assignStringInputValue(
        graph,
        node,
        'smart_prompt',
        buildPromptRelaySmartPrompt(
          params.prompt,
          params.targetFrameCount,
          segmentCount,
          params.largeMotionStages === true,
          params.audioTalkingHeadStages === true,
        ),
      )
    }
  }
}

function isConditioningZeroOutNode(node: ComfyUiWorkflowGraphNode): boolean {
  return normalizeUiDecorationNodeType(node.class_type) === 'conditioningzeroout'
}

function applyAudioTalkingHeadTextArtifactNegativeConditioning(graph: ComfyUiWorkflowGraph): void {
  const promptRelayClipByNodeId = new Map<string, unknown>()

  for (const [nodeId, node] of Object.entries(graph)) {
    if (!isRecord(node.inputs) || !isPromptRelaySmartEncodeNode(node)) continue
    if (!isConnectionValue(node.inputs.clip)) continue
    promptRelayClipByNodeId.set(normalizeNodeId(nodeId), cloneConnectionValue(node.inputs.clip))
  }

  if (promptRelayClipByNodeId.size === 0) return

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs) || !isConditioningZeroOutNode(node)) continue
    const sourceNodeId = readConnectionNodeId(node.inputs.conditioning)
    if (!sourceNodeId) continue
    const clipConnection = promptRelayClipByNodeId.get(sourceNodeId)
    if (!clipConnection) continue

    node.class_type = 'CLIPTextEncode'
    node.inputs = {
      clip: cloneConnectionValue(clipConnection),
      text: AUDIO_TALKING_HEAD_TEXT_ARTIFACT_NEGATIVE_PROMPT,
    }
    node._meta = {
      ...(isRecord(node._meta) ? node._meta : {}),
      title: 'Smart VBVR text artifact negative prompt',
    }
  }
}

function applyKjNoSubtitlesNegativeConditioning(graph: ComfyUiWorkflowGraph): void {
  const promptRelayNode = graph['605']
  const zeroOutNode = graph['420']
  const ltxConditioningNode = graph['164']
  const hasExpectedContract = Boolean(
    promptRelayNode
    && isRecord(promptRelayNode.inputs)
    && normalizeUiDecorationNodeType(promptRelayNode.class_type) === 'promptrelayencode'
    && isConnectionValue(promptRelayNode.inputs.clip)
    && normalizeNodeId(promptRelayNode.inputs.clip[0]) === '416'
    && Number(promptRelayNode.inputs.clip[1]) === 0
    && zeroOutNode
    && isRecord(zeroOutNode.inputs)
    && isConditioningZeroOutNode(zeroOutNode)
    && isConnectionValue(zeroOutNode.inputs.conditioning)
    && normalizeNodeId(zeroOutNode.inputs.conditioning[0]) === '605'
    && Number(zeroOutNode.inputs.conditioning[1]) === 1
    && ltxConditioningNode
    && isRecord(ltxConditioningNode.inputs)
    && normalizeUiDecorationNodeType(ltxConditioningNode.class_type) === 'ltxvconditioning'
    && isConnectionValue(ltxConditioningNode.inputs.positive)
    && normalizeNodeId(ltxConditioningNode.inputs.positive[0]) === '605'
    && Number(ltxConditioningNode.inputs.positive[1]) === 1
    && isConnectionValue(ltxConditioningNode.inputs.negative)
    && normalizeNodeId(ltxConditioningNode.inputs.negative[0]) === '420'
    && Number(ltxConditioningNode.inputs.negative[1]) === 0
  )

  if (!hasExpectedContract || !promptRelayNode || !isRecord(promptRelayNode.inputs) || !zeroOutNode) {
    throw new Error('COMFYUI_LTX23_KJ_NO_SUBTITLE_CONDITIONING_INVALID')
  }

  zeroOutNode.class_type = 'CLIPTextEncode'
  zeroOutNode.inputs = {
    clip: cloneConnectionValue(promptRelayNode.inputs.clip),
    text: KJ_NO_SUBTITLES_NEGATIVE_PROMPT,
  }
  zeroOutNode._meta = {
    ...(isRecord(zeroOutNode._meta) ? zeroOutNode._meta : {}),
    title: 'KJ no-subtitles negative prompt',
  }
}

function applyLtx23WorkflowProfileControls(
  graph: ComfyUiWorkflowGraph,
  workflowKey: string,
  inject: ComfyUiWorkflowInject,
): void {
  const profile = getLtx23WorkflowProfile(workflowKey)
  if (!profile) return

  const normalizedKey = normalizeLtx23WorkflowKey(workflowKey)
  const contract = LTX23_WORKFLOW_NODE_CONTRACTS[normalizedKey]
  const fps = clampPositiveFloat(inject.fps) ?? profile.fps
  const durationSeconds = clampPositiveFloat(inject.durationSeconds) ?? profile.defaultDurationSeconds
  const targetFrameCount = clampPositiveInteger(inject.targetFrameCount)
    ?? Math.max(1, Math.round(durationSeconds * fps))
  const audioTalkingHeadStages = normalizedKey === COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise
    && Array.isArray(inject.audioFilenames)
    && inject.audioFilenames.some((filename) => typeof filename === 'string' && filename.trim().length > 0)

  for (const nodeId of contract?.durationNodeIds || []) {
    setNumericNodeValue(graph, nodeId, durationSeconds)
  }
  for (const nodeId of contract?.audioTrimDurationNodeIds || []) {
    setNumericNodeValue(graph, nodeId, durationSeconds)
  }
  for (const nodeId of contract?.fpsNodeIds || []) {
    setNumericNodeValue(graph, nodeId, fps)
  }
  for (const nodeId of contract?.frameCountNodeIds || []) {
    setNumericNodeValue(graph, nodeId, targetFrameCount)
  }
  for (const nodeId of contract?.fixedResizeNodeIds || []) {
    const resizeNode = graph[nodeId]
    if (!resizeNode || !isRecord(resizeNode.inputs) || !contract?.fixedResizeLongestSide) continue
    resizeNode.inputs.scale_to_length = contract.fixedResizeLongestSide
    resizeNode.inputs.scale_to_side = 'longest'
    resizeNode.inputs.round_to_multiple = '8'
  }

  if (isComfyUiLtx23KjPromptRelayWorkflow(normalizedKey)) {
    const imageGuideNode = graph['620']
    if (imageGuideNode && isRecord(imageGuideNode.inputs)) {
      imageGuideNode.inputs['num_images.strength_1'] = resolveLtx23KjImageGuideStrength(inject.motionStrength)
    }
    applyKjNoSubtitlesNegativeConditioning(graph)
  }

  applyPromptRelayTimelineControls(graph, {
    prompt: readTrimmedString(inject.prompt),
    fps,
    targetFrameCount,
    segmentCount: contract?.promptRelaySegmentCount,
    largeMotionStages: profile.promptPolicy === 'large_motion_single_image',
    audioTalkingHeadStages,
    lockInputs: contract?.lockPromptRelayInputs,
  })
  applyPromptRelaySmartControls(graph, {
    prompt: readTrimmedString(inject.prompt),
    targetFrameCount,
    segmentCount: contract?.promptRelaySmartSegmentCount,
    largeMotionStages: profile.promptPolicy === 'large_motion_single_image',
    audioTalkingHeadStages,
  })
  if (audioTalkingHeadStages) {
    applyAudioTalkingHeadTextArtifactNegativeConditioning(graph)
  }
}

const GOON_FIRST_LAST_FRAME_NODE_CONTRACT = {
  positivePrompt: '121',
  firstImage: '149',
  lastImage: '269',
  width: '237',
  height: '238',
  duration: '236',
  fps: '233',
  frameFormula: '235',
  imageConditioning: ['265', '275'],
  output: '75',
} as const

const GOON_FIRST_LAST_FRAME_FORMULA = '1+8*round(a*b/8)'

function applyGoonFirstLastFrameWorkflowControls(
  graph: ComfyUiWorkflowGraph,
  workflowKey: string,
  inject: ComfyUiWorkflowInject,
): void {
  if (!isComfyUiLtx23GoonFirstLastFrameWorkflow(workflowKey)) return

  const prompt = readTrimmedString(inject.prompt)
  const positivePromptNode = graph[GOON_FIRST_LAST_FRAME_NODE_CONTRACT.positivePrompt]
  if (prompt && positivePromptNode && isRecord(positivePromptNode.inputs)) {
    positivePromptNode.inputs.text = prompt
  }

  const rawImageFilenames = Array.isArray(inject.imageFilenames) ? inject.imageFilenames : []
  const imageFilenames = rawImageFilenames.filter(
    (filename): filename is string => typeof filename === 'string' && filename.trim().length > 0,
  )
  const seamMotionAnchors = inject.videoSeamMotionAnchors
  if (seamMotionAnchors) {
    const frameIndices = seamMotionAnchors.frameIndices
    const fps = typeof inject.fps === 'number' && Number.isFinite(inject.fps) && inject.fps > 0
      ? inject.fps
      : null
    const width = clampDimension(inject.width)
    const height = clampDimension(inject.height)
    const durationSeconds = normalizeLtx23GoonDurationSeconds(inject.durationSeconds)
    const generatedFinalFrameIndex = fps === null
      ? null
      : 8 * Math.round((durationSeconds * fps) / 8)
    const validFilenames = rawImageFilenames.length === 4
      && rawImageFilenames.every(
        (filename) => typeof filename === 'string' && filename.trim().length > 0,
      )
    const validFrameIndices = Array.isArray(frameIndices)
      && frameIndices.length === 4
      && frameIndices.every((value) => Number.isInteger(value) && value >= 0)
      && frameIndices.every((value, index) => index === 0 || value > frameIndices[index - 1])
      && frameIndices[3] === generatedFinalFrameIndex

    if (!validFilenames || !validFrameIndices || width === null || height === null || fps === null) {
      throw new Error('COMFYUI_VIDEO_SEAM_FOUR_ANCHOR_CONTRACT_INVALID')
    }

    const longerEdge = Math.max(width, height)
    graph['300'] = { class_type: 'LoadImage', inputs: { image: imageFilenames[1] } }
    graph['301'] = {
      class_type: 'ResizeImagesByLongerEdge',
      inputs: { images: ['300', 0], longer_edge: longerEdge },
    }
    graph['302'] = {
      class_type: 'LTXVPreprocess',
      inputs: { image: ['301', 0], img_compression: 18 },
    }
    graph['303'] = { class_type: 'LoadImage', inputs: { image: imageFilenames[2] } }
    graph['304'] = {
      class_type: 'ResizeImagesByLongerEdge',
      inputs: { images: ['303', 0], longer_edge: longerEdge },
    }
    graph['305'] = {
      class_type: 'LTXVPreprocess',
      inputs: { image: ['304', 0], img_compression: 18 },
    }

    const firstResizeNode = graph['151']
    const lastResizeNode = graph['272']
    if (firstResizeNode && isRecord(firstResizeNode.inputs)) {
      firstResizeNode.inputs.longer_edge = longerEdge
    }
    if (lastResizeNode && isRecord(lastResizeNode.inputs)) {
      lastResizeNode.inputs.longer_edge = longerEdge
    }

    for (const nodeId of GOON_FIRST_LAST_FRAME_NODE_CONTRACT.imageConditioning) {
      const conditioningNode = graph[nodeId]
      if (!conditioningNode || !isRecord(conditioningNode.inputs)) continue
      for (const inputName of Object.keys(conditioningNode.inputs)) {
        if (/^num_images\.(?:strength|image|index)_\d+$/.test(inputName)) {
          delete conditioningNode.inputs[inputName]
        }
      }
      conditioningNode.inputs.num_images = '4'
      for (let index = 0; index < 4; index += 1) {
        const slot = index + 1
        conditioningNode.inputs[`num_images.strength_${slot}`] = 1
        conditioningNode.inputs[`num_images.image_${slot}`] = [
          ['152', '302', '305', '271'][index],
          0,
        ]
        conditioningNode.inputs[`num_images.index_${slot}`] = frameIndices[index]
      }
    }
    setNumericNodeValue(graph, GOON_FIRST_LAST_FRAME_NODE_CONTRACT.fps, fps)
  }
  const firstImage = imageFilenames[0]
  const lastImage = imageFilenames[imageFilenames.length - 1] ?? firstImage
  const firstImageNode = graph[GOON_FIRST_LAST_FRAME_NODE_CONTRACT.firstImage]
  const lastImageNode = graph[GOON_FIRST_LAST_FRAME_NODE_CONTRACT.lastImage]
  if (firstImage && firstImageNode && isRecord(firstImageNode.inputs)) {
    firstImageNode.inputs.image = firstImage
  }
  if (lastImage && lastImageNode && isRecord(lastImageNode.inputs)) {
    lastImageNode.inputs.image = lastImage
  }

  const width = clampDimension(inject.width)
  const height = clampDimension(inject.height)
  if (width !== null) setNumericNodeValue(graph, GOON_FIRST_LAST_FRAME_NODE_CONTRACT.width, width)
  if (height !== null) setNumericNodeValue(graph, GOON_FIRST_LAST_FRAME_NODE_CONTRACT.height, height)

  const durationSeconds = normalizeLtx23GoonDurationSeconds(inject.durationSeconds)
  setNumericNodeValue(graph, GOON_FIRST_LAST_FRAME_NODE_CONTRACT.duration, durationSeconds)
  if (!seamMotionAnchors) {
    setNumericNodeValue(graph, GOON_FIRST_LAST_FRAME_NODE_CONTRACT.fps, COMFYUI_LTX23_GOON_FPS)
  }

  const finalPixelFrameIndex = resolveLtx23GoonFinalFrameIndex(durationSeconds)
  if (!seamMotionAnchors) {
    for (const nodeId of GOON_FIRST_LAST_FRAME_NODE_CONTRACT.imageConditioning) {
      const conditioningNode = graph[nodeId]
      if (conditioningNode && isRecord(conditioningNode.inputs)) {
        conditioningNode.inputs['num_images.index_2'] = finalPixelFrameIndex
      }
    }
  }

  const formulaNode = graph[GOON_FIRST_LAST_FRAME_NODE_CONTRACT.frameFormula]
  if (formulaNode && isRecord(formulaNode.inputs)) {
    formulaNode.inputs.expression = GOON_FIRST_LAST_FRAME_FORMULA
  }
}

function formatDateSegment(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeSegment(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}-${minutes}-${seconds}`
}

function sanitizeFilenamePrefix(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'waoowaoo'

  const now = new Date()
  const withExpandedMacros = trimmed
    .replace(/%date:[^%]+%/gi, formatDateSegment(now))
    .replace(/%time:[^%]+%/gi, formatTimeSegment(now))

  const normalized = withExpandedMacros
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim())
    .filter(Boolean)
    .join('/')

  return normalized || 'waoowaoo'
}

function applySaveOutputHeuristics(graph: ComfyUiWorkflowGraph): void {
  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue
    if (!Object.prototype.hasOwnProperty.call(node.inputs, 'filename_prefix')) continue
    if (isConnectionValue(node.inputs.filename_prefix)) continue
    if (typeof node.inputs.filename_prefix !== 'string') continue

    node.inputs.filename_prefix = sanitizeFilenamePrefix(node.inputs.filename_prefix)
  }
}

function removePreviewImageOutputsFromVideoGraphs(graph: ComfyUiWorkflowGraph): void {
  const hasVideoOutputNode = Object.values(graph).some((node) =>
    VIDEO_OUTPUT_NODE_TYPES.has(normalizeUiDecorationNodeType(node.class_type))
  )
  if (!hasVideoOutputNode) return

  for (const [nodeId, node] of Object.entries(graph)) {
    if (PREVIEW_OUTPUT_NODE_TYPES.has(normalizeUiDecorationNodeType(node.class_type))) {
      delete graph[nodeId]
    }
  }
}

function assignRandomSeedValues(graph: ComfyUiWorkflowGraph): void {
  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue
    for (const seedField of ['seed', 'noise_seed']) {
      if (!Object.prototype.hasOwnProperty.call(node.inputs, seedField)) continue
      if (isConnectionValue(node.inputs[seedField])) continue
      node.inputs[seedField] = Math.floor(Math.random() * (COMFYUI_SAFE_RANDOM_SEED_MAX + 1))
    }
  }
}

const STABLE_AUDIO_3_MEDIUM_WORKFLOW_KEY = 'baseaudio/environment/stable-audio-3-medium'

function applyStableAudio3MediumControls(
  graph: ComfyUiWorkflowGraph,
  workflowKey: string,
  inject: ComfyUiWorkflowInject,
): void {
  if (workflowKey.trim().replace(/\\/g, '/') !== STABLE_AUDIO_3_MEDIUM_WORKFLOW_KEY) return

  const prompt = readTrimmedString(inject.prompt)
  const negativePrompt = readTrimmedString(inject.negativePrompt)
  if (prompt) graph['86']!.inputs.text = prompt
  if (negativePrompt) graph['81']!.inputs.text = negativePrompt

  if (typeof inject.durationSeconds === 'number' && Number.isFinite(inject.durationSeconds)) {
    if (inject.durationSeconds <= 0 || inject.durationSeconds > 150) {
      throw new Error('COMFYUI_STABLE_AUDIO_DURATION_INVALID')
    }
    graph['83']!.inputs.seconds = Math.round(inject.durationSeconds * 1000) / 1000
  }

  if (inject.seed !== undefined) {
    if (!Number.isSafeInteger(inject.seed) || inject.seed < 0) {
      throw new Error('COMFYUI_STABLE_AUDIO_SEED_INVALID')
    }
    graph['84']!.inputs.seed = inject.seed
  }
}

function isQwenStoryboardWorkflowKey(workflowKey: string): boolean {
  const normalized = workflowKey.trim().replace(/\\/g, '/')
  return normalized.includes('baseimage/')
    && normalized.includes('Qwen')
    && (normalized.includes('分镜') || normalized.toLowerCase().includes('storyboard'))
}

export function getComfyUiWorkflowParameterContract(workflowKey: string): ComfyUiWorkflowParameterContract | null {
  if (!isQwenStoryboardWorkflowKey(workflowKey)) return null

  return {
    name: 'qwen-storyboard-controlled-single-panel',
    promptNodeIds: ['103'],
    positiveConditioningNodeIds: ['68'],
    negativeConditioningNodeIds: ['61'],
    aspectRatioNodeIds: ['91'],
    longestSideNodeIds: ['104'],
    imageInputNodeIds: ['74'],
    finalOutputNodeIds: ['105'],
    allowInternalLlmExpansion: false,
    maxReferenceImages: 1,
  }
}

function preflightFail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`)
}

function normalizeWorkflowNodeClass(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function readConnectionNodeId(value: unknown): string | null {
  if (!isConnectionValue(value)) return null
  return normalizeNodeId(value[0]) || null
}

function nodeHasClassToken(node: ComfyUiWorkflowGraphNode | undefined, tokens: string[]): boolean {
  if (!node) return false
  const normalized = normalizeWorkflowNodeClass(node.class_type)
  return tokens.some((token) => normalized.includes(token))
}

function upstreamPathHasNodeClass(
  graph: ComfyUiWorkflowGraph,
  startNodeId: string,
  tokens: string[],
  visited = new Set<string>(),
): boolean {
  if (visited.has(startNodeId)) return false
  visited.add(startNodeId)

  const node = graph[startNodeId]
  if (!node) return false
  if (nodeHasClassToken(node, tokens)) return true

  for (const value of Object.values(node.inputs)) {
    const nextNodeId = readConnectionNodeId(value)
    if (!nextNodeId) continue
    if (upstreamPathHasNodeClass(graph, nextNodeId, tokens, visited)) return true
  }

  return false
}

function validateQwenStoryboardPreflight(
  workflowKey: string,
  graph: ComfyUiWorkflowGraph,
  inject: ComfyUiWorkflowInject,
  contract: ComfyUiWorkflowParameterContract,
): ComfyUiWorkflowPreflightResult {
  const prompt = readTrimmedString(inject.prompt)
  const negativePrompt = readTrimmedString(inject.negativePrompt)
  const imageFilenames = Array.isArray(inject.imageFilenames)
    ? inject.imageFilenames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  if (imageFilenames.length > contract.maxReferenceImages) {
    preflightFail(
      'COMFYUI_PREFLIGHT_REFERENCE_OVER_CONTRACT',
      `${workflowKey} accepts at most ${contract.maxReferenceImages} reference image(s), got ${imageFilenames.length}`,
    )
  }

  const positiveNode = graph[contract.positiveConditioningNodeIds[0] || '']
  if (!positiveNode) {
    preflightFail('COMFYUI_PREFLIGHT_NODE_MISSING', `${workflowKey} missing positive conditioning node`)
  }

  const positivePrompt = positiveNode.inputs.prompt
  const positivePromptSourceId = readConnectionNodeId(positivePrompt)
  if (positivePromptSourceId) {
    const leaksLlmRewrite = upstreamPathHasNodeClass(graph, positivePromptSourceId, [
      'rhllmapinode',
      'processstring',
      'easypromptline',
      'promptline',
    ])
    if (leaksLlmRewrite) {
      preflightFail(
        'COMFYUI_PREFLIGHT_LLM_REWRITE_LEAK',
        `${workflowKey} routes internal LLM rewrite output into final positive conditioning`,
      )
    }
    preflightFail('COMFYUI_PREFLIGHT_PROMPT_NOT_LOCKED', `${workflowKey} final positive prompt is still connected`)
  }

  if (prompt && positivePrompt !== prompt) {
    preflightFail('COMFYUI_PREFLIGHT_PROMPT_NOT_LOCKED', `${workflowKey} final positive prompt is not locked`)
  }

  const promptNode = graph[contract.promptNodeIds[0] || '']
  if (prompt && promptNode && promptNode.inputs.text !== prompt) {
    preflightFail('COMFYUI_PREFLIGHT_PROMPT_NOT_LOCKED', `${workflowKey} relay prompt node is not locked`)
  }

  const negativeNode = graph[contract.negativeConditioningNodeIds[0] || '']
  if (negativePrompt && negativeNode && negativeNode.inputs.prompt !== negativePrompt) {
    preflightFail('COMFYUI_PREFLIGHT_NEGATIVE_PROMPT_NOT_LOCKED', `${workflowKey} negative prompt is not locked`)
  }

  const width = clampDimension(inject.width)
  const height = clampDimension(inject.height)
  if (width !== null && height !== null) {
    const expectedAspect = formatAspectRatio(width, height)
    const aspectNode = graph[contract.aspectRatioNodeIds[0] || '']
    if (aspectNode?.inputs.aspect_ratio !== expectedAspect) {
      preflightFail(
        'COMFYUI_PREFLIGHT_ASPECT_RATIO_NOT_LOCKED',
        `${workflowKey} aspect ratio is not locked to ${expectedAspect}`,
      )
    }

    const longestSideNode = graph[contract.longestSideNodeIds[0] || '']
    if (longestSideNode?.inputs.value !== Math.max(width, height)) {
      preflightFail(
        'COMFYUI_PREFLIGHT_SIZE_NOT_LOCKED',
        `${workflowKey} longest side is not locked to ${Math.max(width, height)}`,
      )
    }
  }

  if (imageFilenames.length > 0) {
    const inputNode = graph[contract.imageInputNodeIds[0] || '']
    if (inputNode?.inputs.image !== imageFilenames[0]) {
      preflightFail('COMFYUI_PREFLIGHT_REFERENCE_NOT_LOCKED', `${workflowKey} reference image slot is not locked`)
    }
  }

  for (const outputNodeId of contract.finalOutputNodeIds) {
    if (!nodeHasClassToken(graph[outputNodeId], ['saveimage'])) {
      preflightFail('COMFYUI_PREFLIGHT_OUTPUT_NODE_INVALID', `${workflowKey} missing final SaveImage output ${outputNodeId}`)
    }
  }

  for (const node of Object.values(graph)) {
    if (!nodeHasClassToken(node, ['ksampler'])) continue
    const positiveSourceNodeId = readConnectionNodeId(node.inputs.positive)
    if (!positiveSourceNodeId || !contract.positiveConditioningNodeIds.includes(positiveSourceNodeId)) {
      preflightFail('COMFYUI_PREFLIGHT_CONDITIONING_ROUTE_INVALID', `${workflowKey} sampler positive conditioning is not locked`)
    }
  }

  return {
    ok: true,
    workflowKey,
    contractName: contract.name,
    summary: {
      promptLocked: true,
      aspectRatioLocked: width !== null && height !== null,
      referenceImageCount: imageFilenames.length,
      finalOutputNodeIds: contract.finalOutputNodeIds,
    },
  }
}

export function validateResolvedWorkflowPreflight(
  workflowKey: string,
  graph: ComfyUiWorkflowGraph,
  inject: ComfyUiWorkflowInject = {},
  _options: { expect?: 'image' | 'video' | 'audio' } = {},
): ComfyUiWorkflowPreflightResult {
  void _options
  const contract = getComfyUiWorkflowParameterContract(workflowKey)
  if (!contract) {
    return {
      ok: true,
      workflowKey,
      contractName: null,
      summary: {
        promptLocked: false,
        aspectRatioLocked: false,
        referenceImageCount: inject.imageFilenames?.length ?? 0,
        finalOutputNodeIds: [],
      },
    }
  }

  return validateQwenStoryboardPreflight(workflowKey, graph, inject, contract)
}

export function resolveComfyUiWorkflow(
  workflowKey: string,
  inject: ComfyUiWorkflowInject = {},
): ComfyUiWorkflowGraph {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) {
    throw new Error(`COMFYUI_WORKFLOW_NOT_FOUND: ${workflowKey}`)
  }

  const graph = cloneWorkflow(readWorkflowGraphFromFile(filePath))
  const isBerniniWorkflow = isSeedance2BerniniWorkflowKey(workflowKey)
  const isGoonFirstLastFrameWorkflow = isComfyUiLtx23GoonFirstLastFrameWorkflow(workflowKey)
  bypassOptionalModelNodes(graph)
  if (!isBerniniWorkflow && !isGoonFirstLastFrameWorkflow) {
    applyPromptHeuristics(graph, inject.prompt, inject.negativePrompt)
  }
  applyDimensionHeuristics(graph, inject.width, inject.height)
  const imageFilenames = isGoonFirstLastFrameWorkflow && inject.videoSeamMotionAnchors
    ? inject.imageFilenames
    : expandLtx23WorkflowImageFilenames(workflowKey, inject.imageFilenames)
  applyImageInjection(graph, imageFilenames)
  applyAudioInjection(graph, inject.audioFilenames)
  validateVideoSeamWorkflowContract(graph, workflowKey)
  applyVideoInjection(graph, inject.videoFilenames)
  applyVideoSeamTrimInjection(graph, workflowKey, inject.videoTrimFrames)
  applyRhLlmApiInjection(graph, inject.llmApi)
  applyKjResizeHeuristics(graph)
  applyTemporalHeuristics(graph, inject.fps, inject.targetFrameCount, inject.durationSeconds)
  applyLtx23WorkflowProfileControls(graph, workflowKey, inject)
  applyGoonFirstLastFrameWorkflowControls(graph, workflowKey, {
    ...inject,
    imageFilenames,
  })
  applySeedance2BerniniWorkflowControls(graph, workflowKey, inject)
  applySaveOutputHeuristics(graph)
  inlineValueHelperNodes(graph)
  bypassPassthroughOutputNodes(graph)
  removePreviewImageOutputsFromVideoGraphs(graph)
  removeDanglingVideoOutputNodes(graph)
  removeDisabledVideoOutputNodes(graph)
  pruneUnreachableFromMediaOutputs(graph)
  assignRandomSeedValues(graph)
  applyStableAudio3MediumControls(graph, workflowKey, inject)
  return graph
}

export function loadComfyUiWorkflowJsonFile(workflowKey: string): ComfyUiWorkflowGraph | null {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) return null
  return readWorkflowGraphFromFile(filePath)
}

export function getComfyUiWorkflowImageInputCount(workflowKey: string): number {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) return 0

  return Object.values(readWorkflowGraphFromFile(filePath))
    .filter((node) => node.class_type.toLowerCase().includes('loadimage'))
    .length
}

export function getComfyUiWorkflowAudioInputCount(workflowKey: string): number {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) return 0

  return Object.values(readWorkflowGraphFromFile(filePath))
    .filter((node) => node.class_type.toLowerCase().includes('loadaudio'))
    .length
}

export function getComfyUiWorkflowVideoInputCount(workflowKey: string): number {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) return 0

  return Object.values(readWorkflowGraphFromFile(filePath))
    .filter((node) => node.class_type.toLowerCase().includes('loadvideo'))
    .length
}

function walkWorkflowFiles(baseDir: string, currentDir: string, output: string[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      walkWorkflowFiles(baseDir, absolutePath, output)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
    const relativePath = relative(baseDir, absolutePath).replace(/\\/g, '/').replace(/\.json$/i, '')
    output.push(relativePath)
  }
}

export function listComfyUiWorkflowKeys(): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  const externalRoot = getExternalWorkflowRoot()

  if (externalRoot && existsSync(externalRoot)) {
    for (const entry of readdirSync(externalRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isExternalWorkflowDirectoryName(entry.name)) continue
      walkWorkflowFiles(externalRoot, join(externalRoot, entry.name), output)
    }
  }

  if (existsSync(LEGACY_BUNDLED_ROOT)) {
    walkWorkflowFiles(LEGACY_BUNDLED_ROOT, LEGACY_BUNDLED_ROOT, output)
  }

  return output
    .filter((key) => {
      if (seen.has(key)) return false
      seen.add(key)
      return !!resolveWorkflowFilePath(key)
    })
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

export function hasComfyUiWorkflowKey(workflowKey: string): boolean {
  return !!resolveWorkflowFilePath(workflowKey)
}

export function hasExternalComfyUiWorkflowRoot(): boolean {
  const root = getExternalWorkflowRoot()
  return !!root && existsSync(root) && statSync(root).isDirectory()
}
