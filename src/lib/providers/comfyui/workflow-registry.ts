import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

export const COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID = 'baseimage/图片生成/Flux2Klein文生图'
export const COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID = 'basevideo/图生视频/LTX2.3图生视频快速版'

const LEGACY_BUNDLED_ROOT = join(process.cwd(), 'src', 'lib', 'providers', 'comfyui', 'workflows')
const EXTERNAL_WORKFLOW_TOOL_DIR = 'tool'
const EXTERNAL_WORKFLOW_BASE_PREFIX = 'base'
const UI_ONLY_INPUT_TYPE_SUFFIXES = ['UPLOAD', '_UI']
const SEED_CONTROL_VALUES = new Set(['fixed', 'randomize', 'increment', 'decrement'])

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
  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue
    const nodeId = normalizeNodeId(rawNode.id)
    const classType = readTrimmedString(rawNode.type)
    if (!nodeId || !classType) continue

    const inputDefs = Array.isArray(rawNode.inputs)
      ? rawNode.inputs.filter((item): item is UiWorkflowInput => isRecord(item))
      : []
    const widgetValues = Array.isArray(rawNode.widgets_values) ? rawNode.widgets_values : []
    const inputs: Record<string, unknown> = {}
    let widgetIndex = 0

    for (const inputDef of inputDefs) {
      const inputName = readTrimmedString(inputDef.name)
      if (!inputName) continue

      const linkId = typeof inputDef.link === 'number' ? inputDef.link : Number(inputDef.link)
      const linked = Number.isFinite(linkId) ? linkMap.get(Math.trunc(linkId)) : null
      if (linked) {
        inputs[inputName] = [linked.sourceNodeId, linked.sourceSlot]
        continue
      }

      if (!inputDef.widget || shouldSkipUiOnlyInput(inputDef)) continue

      const currentValue = widgetValues[widgetIndex]
      if (currentValue !== undefined) {
        inputs[inputName] = JSON.parse(JSON.stringify(currentValue)) as unknown
      }
      widgetIndex += 1

      if (shouldSkipSeedControlValue(inputDef, widgetValues[widgetIndex])) {
        widgetIndex += 1
      }
    }

    graph[nodeId] = {
      class_type: classType,
      inputs,
      ...(readTrimmedString(rawNode.title) ? { _meta: { title: readTrimmedString(rawNode.title) } } : {}),
    }
  }

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

function isConnectionValue(value: unknown): boolean {
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
      if (!field || isConnectionValue(node.inputs[inputName])) continue

      if (negativeValue && (isNegativePromptField(field) || (field === 'text' && isLikelyNegativeNode(node)))) {
        node.inputs[inputName] = negativeValue
        continue
      }

      if (positiveValue && isPromptInputField(field) && !isLikelyNegativeNode(node)) {
        node.inputs[inputName] = positiveValue
      }
    }
  }
}

function clampDimension(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(64, Math.min(4096, Math.round(value)))
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

function assignRandomSeedValues(graph: ComfyUiWorkflowGraph): void {
  for (const node of Object.values(graph)) {
    if (!isRecord(node.inputs)) continue
    for (const seedField of ['seed', 'noise_seed']) {
      if (!Object.prototype.hasOwnProperty.call(node.inputs, seedField)) continue
      if (isConnectionValue(node.inputs[seedField])) continue
      node.inputs[seedField] = Math.floor(Math.random() * 1_000_000_000_000_000)
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
