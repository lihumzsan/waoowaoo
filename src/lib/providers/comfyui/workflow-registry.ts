import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

export const COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID = 'baseimage/图片生成/Flux2Klein文生图'
export const COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID = 'basevideo/图生视频/LTX2.3图生视频快速版'

const LEGACY_BUNDLED_ROOT = join(process.cwd(), 'src', 'lib', 'providers', 'comfyui', 'workflows')
const EXTERNAL_WORKFLOW_TOOL_DIR = 'tool'
const EXTERNAL_WORKFLOW_BASE_PREFIX = 'base'
const UI_ONLY_INPUT_TYPE_SUFFIXES = ['UPLOAD', '_UI']
const SEED_CONTROL_VALUES = new Set(['fixed', 'randomize', 'increment', 'decrement'])
const CONNECTED_PROMPT_SOURCE_FIELDS = ['value', 'text', 'prompt', 'string', 'input_string']
const COMFYUI_SAFE_RANDOM_SEED_MAX = 2_147_483_647

export type ComfyUiWorkflowGraphNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: {
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
  fps?: number
  durationSeconds?: number
  targetFrameCount?: number
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
      const inputName = readTrimmedString(inputDef.name)
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

    graph[nodeId] = {
      class_type: classType,
      inputs,
      ...(readTrimmedString(rawNode.title) ? { _meta: { title: readTrimmedString(rawNode.title) } } : {}),
    }
  }

  applyAnythingEverywhereBroadcast(nodes, graph, anythingEverywhereSources)
  return graph
}

function readWorkflowGraphFromFile(filePath: string): ComfyUiWorkflowGraph {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown

  if (isUiWorkflow(parsed) && isApiWorkflowGraph(parsed.extra?.prompt)) {
    return normalizeApiWorkflowGraph(parsed.extra.prompt)
  }
  if (isApiWorkflowGraph(parsed)) {
    return normalizeApiWorkflowGraph(parsed)
  }
  if (isUiWorkflow(parsed)) {
    return convertUiWorkflowToApiGraph(parsed)
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

function isConnectionValue(value: unknown): value is [unknown, unknown, ...unknown[]] {
  return Array.isArray(value) && value.length >= 2
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
}

function isNegativePromptField(inputName: string): boolean {
  return inputName === 'negative' || inputName === 'negative_prompt'
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
  for (const [, node] of nodeEntries) {
    if (!isRecord(node.inputs) || !isPromptCapableNode(node)) continue

    for (const inputName of Object.keys(node.inputs)) {
      const field = inputName.trim().toLowerCase()
      if (!field) continue
      const currentValue = node.inputs[inputName]

      if (negativeValue && (isNegativePromptField(field) || (field === 'text' && isLikelyNegativeNode(node)))) {
        if (tryAssignPromptToConnectedValueNode(graph, currentValue, negativeValue)) continue
        if (!isConnectionValue(currentValue)) {
          node.inputs[inputName] = negativeValue
        }
        continue
      }

      if (positiveValue && isPromptInputField(field) && !isLikelyNegativeNode(node)) {
        if (tryAssignPromptToConnectedValueNode(graph, currentValue, positiveValue)) continue
        if (!isConnectionValue(currentValue)) {
          node.inputs[inputName] = positiveValue
        }
      }
    }
  }
}

function clampDimension(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(64, Math.min(4096, Math.round(value)))
}

function clampPositiveInteger(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(1, Math.round(value))
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

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue

    if (nextWidth !== null && Object.prototype.hasOwnProperty.call(node.inputs, 'width') && !isConnectionValue(node.inputs.width)) {
      node.inputs.width = nextWidth
    }
    if (nextHeight !== null && Object.prototype.hasOwnProperty.call(node.inputs, 'height') && !isConnectionValue(node.inputs.height)) {
      node.inputs.height = nextHeight
    }
  }
}

function applyImageInjection(graph: ComfyUiWorkflowGraph, imageFilenames?: string[]): void {
  if (!Array.isArray(imageFilenames) || imageFilenames.length === 0) return

  const loadNodes = Object.entries(graph)
    .filter(([, node]) => node.class_type.toLowerCase().includes('loadimage'))
    .sort(([a], [b]) => compareNodeIds(a, b))

  loadNodes.forEach(([, node], index) => {
    const filename = imageFilenames[index]
    if (!filename) return
    node.inputs.image = filename
    delete node.inputs.upload
    delete node.inputs.imageUI
  })
}

function applyAudioInjection(graph: ComfyUiWorkflowGraph, audioFilenames?: string[]): void {
  if (!Array.isArray(audioFilenames) || audioFilenames.length === 0) return

  const loadNodes = Object.entries(graph)
    .filter(([, node]) => node.class_type.toLowerCase().includes('loadaudio'))
    .sort(([a], [b]) => compareNodeIds(a, b))

  loadNodes.forEach(([, node], index) => {
    const filename = audioFilenames[index]
    if (!filename) return
    node.inputs.audio = filename
    delete node.inputs.audioUI
    delete node.inputs.audioui
    delete node.inputs.upload
  })
}

function setNumericValueOnNode(node: ComfyUiWorkflowGraphNode | undefined, value: number): boolean {
  if (!node || !isRecord(node.inputs)) return false

  for (const field of ['value', 'a', 'number']) {
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
): void {
  const nextFps = clampPositiveFloat(fps)
  const nextFrames = clampPositiveInteger(targetFrameCount)
  if (nextFps === null && nextFrames === null) return

  const fpsFields = new Set(['frame_rate', 'fps'])
  const frameCountFields = new Set(['frames_number', 'frame_count', 'frames', 'length'])

  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue

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

export function resolveComfyUiWorkflow(
  workflowKey: string,
  inject: ComfyUiWorkflowInject = {},
): ComfyUiWorkflowGraph {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) {
    throw new Error(`COMFYUI_WORKFLOW_NOT_FOUND: ${workflowKey}`)
  }

  const graph = cloneWorkflow(readWorkflowGraphFromFile(filePath))
  applyPromptHeuristics(graph, inject.prompt, inject.negativePrompt)
  applyDimensionHeuristics(graph, inject.width, inject.height)
  applyImageInjection(graph, inject.imageFilenames)
  applyAudioInjection(graph, inject.audioFilenames)
  applyTemporalHeuristics(graph, inject.fps, inject.targetFrameCount)
  applySaveOutputHeuristics(graph)
  assignRandomSeedValues(graph)
  return graph
}

export function loadComfyUiWorkflowJsonFile(workflowKey: string): ComfyUiWorkflowGraph | null {
  const filePath = resolveWorkflowFilePath(workflowKey)
  if (!filePath) return null
  return readWorkflowGraphFromFile(filePath)
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
      return true
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
