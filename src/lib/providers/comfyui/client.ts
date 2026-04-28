import { basename, extname } from 'path'
import {
  COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID,
  COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID,
  getComfyUiWorkflowImageInputCount,
  resolveComfyUiWorkflow,
  type ComfyUiWorkflowGraph,
} from './workflow-registry'
import { COMFYUI_NEUTRAL_REFERENCE_IMAGE } from './neutral-reference'

function normalizeComfyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

type ComfyHistoryEntry = {
  status?: { completed?: boolean; status_str?: string }
  outputs?: Record<string, Record<string, unknown>>
}

type ComfyQueueResponse = {
  queue_running?: unknown[]
  queue_pending?: unknown[]
}

type MediaRef = {
  filename: string
  subfolder: string
  type: string
}

type MediaRefOutputGroup = {
  nodeId: string
  refs: MediaRef[]
}

const LOW_PRIORITY_OUTPUT_SOURCE_TYPES = [
  'concat',
  'comparer',
  'compare',
  'preview',
  'show',
  'display',
]

const HIGH_PRIORITY_OUTPUT_SOURCE_TYPES = [
  'decode',
  'saveanimated',
  'savevideo',
  'vhs_videocombine',
]

type ComfyPromptQueuePhase = 'pending' | 'running' | 'absent' | 'unknown'

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp)$/i
const VIDEO_EXTENSIONS = /\.(mp4|webm|gif|mov|mkv|avi)$/i
const AUDIO_EXTENSIONS = /\.(wav|mp3|ogg|m4a|flac|aac)$/i

function guessMimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.aac')) return 'audio/aac'
  return 'application/octet-stream'
}

function isMediaFilename(filename: string): boolean {
  return IMAGE_EXTENSIONS.test(filename) || VIDEO_EXTENSIONS.test(filename) || AUDIO_EXTENSIONS.test(filename)
}

function parseMediaRefFromPathLike(raw: string): MediaRef | null {
  const trimmed = raw.trim()
  if (!trimmed || /\r|\n/.test(trimmed)) return null

  try {
    const parsedUrl = new URL(trimmed, 'http://comfyui.local')
    if (parsedUrl.pathname === '/view' || parsedUrl.pathname.endsWith('/view')) {
      const filename = parsedUrl.searchParams.get('filename')?.trim() || ''
      if (!filename || !isMediaFilename(filename)) return null
      return {
        filename,
        subfolder: parsedUrl.searchParams.get('subfolder')?.trim() || '',
        type: parsedUrl.searchParams.get('type')?.trim() || 'output',
      }
    }
  } catch {
    // Fall back to path-like parsing below.
  }

  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
  const segments = normalized.split('/').filter(Boolean)
  const filename = segments[segments.length - 1]?.trim() || ''
  if (!filename || !isMediaFilename(filename)) return null

  let type = 'output'
  let subfolderSegments = segments.slice(0, -1)
  const firstSegment = subfolderSegments[0]?.toLowerCase()
  if (firstSegment === 'input' || firstSegment === 'output' || firstSegment === 'temp') {
    type = firstSegment
    subfolderSegments = subfolderSegments.slice(1)
  }

  return {
    filename,
    subfolder: subfolderSegments.join('/'),
    type,
  }
}

function collectMediaRefs(value: unknown, refs: MediaRef[]): void {
  if (typeof value === 'string') {
    const ref = parseMediaRefFromPathLike(value)
    if (ref) refs.push(ref)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMediaRefs(item, refs)
    }
    return
  }

  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const filename = typeof record.filename === 'string' ? record.filename.trim() : ''
  if (filename && isMediaFilename(filename)) {
    refs.push({
      filename,
      subfolder: typeof record.subfolder === 'string' ? record.subfolder : '',
      type: typeof record.type === 'string' ? record.type : 'output',
    })
    return
  }

  for (const nested of Object.values(record)) {
    collectMediaRefs(nested, refs)
  }
}

export function collectMediaRefsFromOutputs(outputs: Record<string, Record<string, unknown>> | undefined): MediaRef[] {
  return collectMediaRefOutputGroups(outputs).flatMap((group) => group.refs)
}

function collectMediaRefOutputGroups(
  outputs: Record<string, Record<string, unknown>> | undefined,
): MediaRefOutputGroup[] {
  if (!outputs) return []

  const groups: MediaRefOutputGroup[] = []
  for (const [nodeId, block] of Object.entries(outputs)) {
    const refs: MediaRef[] = []
    collectMediaRefs(block, refs)
    if (refs.length > 0) {
      groups.push({ nodeId, refs })
    }
  }

  return groups
}

function pickMediaRef(refs: MediaRef[], expect: 'image' | 'video' | 'audio'): MediaRef | null {
  if (refs.length === 0) return null
  if (expect === 'image') {
    return refs.find((ref) => IMAGE_EXTENSIONS.test(ref.filename)) ?? null
  }
  if (expect === 'video') {
    return refs.find((ref) => VIDEO_EXTENSIONS.test(ref.filename)) ?? null
  }
  return refs.find((ref) => AUDIO_EXTENSIONS.test(ref.filename)) ?? null
}

function compareOutputNodeIdsDescending(left: string, right: string): number {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  const leftIsNumber = Number.isFinite(leftNumber)
  const rightIsNumber = Number.isFinite(rightNumber)

  if (leftIsNumber && rightIsNumber) {
    return rightNumber - leftNumber
  }
  if (leftIsNumber) return -1
  if (rightIsNumber) return 1
  return right.localeCompare(left)
}

function normalizeWorkflowClassType(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function resolveConnectedNodeId(inputValue: unknown): string | null {
  if (!Array.isArray(inputValue) || inputValue.length < 1) return null
  const nodeId = inputValue[0]
  return typeof nodeId === 'string'
    ? nodeId.trim() || null
    : typeof nodeId === 'number' && Number.isFinite(nodeId)
      ? String(Math.trunc(nodeId))
      : null
}

function scoreWorkflowOutputNode(nodeId: string, workflow: ComfyUiWorkflowGraph): number {
  const outputNode = workflow[nodeId]
  if (!outputNode) return 0

  const connectedNodeIds = Object.values(outputNode.inputs)
    .map((value) => resolveConnectedNodeId(value))
    .filter((value): value is string => !!value)

  if (connectedNodeIds.length === 0) return 0

  const directSources = connectedNodeIds
    .map((connectedNodeId) => normalizeWorkflowClassType(workflow[connectedNodeId]?.class_type))
    .filter(Boolean)

  if (directSources.some((classType) => LOW_PRIORITY_OUTPUT_SOURCE_TYPES.some((token) => classType.includes(token)))) {
    return 100
  }

  if (directSources.some((classType) => HIGH_PRIORITY_OUTPUT_SOURCE_TYPES.some((token) => classType.includes(token)))) {
    return 0
  }

  return 10
}

function pickPreferredMediaRefFromOutputs(
  outputs: Record<string, Record<string, unknown>> | undefined,
  expect: 'image' | 'video' | 'audio',
  workflow?: ComfyUiWorkflowGraph,
): MediaRef | null {
  const groups = collectMediaRefOutputGroups(outputs)
  if (groups.length === 0) return null

  const rankedGroups = [...groups].sort((left, right) => {
    const leftScore = workflow ? scoreWorkflowOutputNode(left.nodeId, workflow) : 0
    const rightScore = workflow ? scoreWorkflowOutputNode(right.nodeId, workflow) : 0
    if (leftScore !== rightScore) return leftScore - rightScore
    return compareOutputNodeIdsDescending(left.nodeId, right.nodeId)
  })
  for (const group of rankedGroups) {
    const ref = pickMediaRef(group.refs, expect)
    if (ref) return ref
  }

  return null
}

function readTimeoutOverride(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs
  return Math.round(parsed)
}

function getComfyUiQueueTimeoutMs(expect: 'image' | 'video' | 'audio'): number {
  if (expect === 'video') {
    return readTimeoutOverride(process.env.COMFYUI_VIDEO_QUEUE_TIMEOUT_MS, 7_200_000)
  }
  if (expect === 'audio') {
    return readTimeoutOverride(process.env.COMFYUI_AUDIO_QUEUE_TIMEOUT_MS, 2_700_000)
  }
  return readTimeoutOverride(process.env.COMFYUI_IMAGE_QUEUE_TIMEOUT_MS, 1_800_000)
}

function getComfyUiExecutionTimeoutMs(expect: 'image' | 'video' | 'audio'): number {
  if (expect === 'video') {
    return readTimeoutOverride(process.env.COMFYUI_VIDEO_EXECUTION_TIMEOUT_MS, 900_000)
  }
  if (expect === 'audio') {
    return readTimeoutOverride(process.env.COMFYUI_AUDIO_EXECUTION_TIMEOUT_MS, 300_000)
  }
  return readTimeoutOverride(process.env.COMFYUI_IMAGE_EXECUTION_TIMEOUT_MS, 300_000)
}

function getComfyUiHistoryGraceMs(expect: 'image' | 'video' | 'audio'): number {
  if (expect === 'video') {
    return readTimeoutOverride(process.env.COMFYUI_VIDEO_HISTORY_GRACE_MS, 30_000)
  }
  if (expect === 'audio') {
    return readTimeoutOverride(process.env.COMFYUI_AUDIO_HISTORY_GRACE_MS, 15_000)
  }
  return readTimeoutOverride(process.env.COMFYUI_IMAGE_HISTORY_GRACE_MS, 15_000)
}

function getComfyUiQueuePollIntervalMs(expect: 'image' | 'video' | 'audio'): number {
  if (expect === 'video') {
    return readTimeoutOverride(process.env.COMFYUI_VIDEO_QUEUE_POLL_INTERVAL_MS, 5_000)
  }
  if (expect === 'audio') {
    return readTimeoutOverride(process.env.COMFYUI_AUDIO_QUEUE_POLL_INTERVAL_MS, 2_000)
  }
  return readTimeoutOverride(process.env.COMFYUI_IMAGE_QUEUE_POLL_INTERVAL_MS, 2_000)
}

function readPromptIdFromQueueItem(entry: unknown): string | null {
  if (Array.isArray(entry)) {
    const promptId = entry[1]
    return typeof promptId === 'string' && promptId.trim() ? promptId.trim() : null
  }

  if (!entry || typeof entry !== 'object') return null
  const promptId = (entry as { prompt_id?: unknown }).prompt_id
  return typeof promptId === 'string' && promptId.trim() ? promptId.trim() : null
}

export function resolveComfyUiPromptQueuePhase(
  queue: ComfyQueueResponse | null | undefined,
  promptId: string,
): ComfyPromptQueuePhase {
  if (!queue || typeof queue !== 'object') return 'unknown'

  const isRunning = Array.isArray(queue.queue_running)
    && queue.queue_running.some((entry) => readPromptIdFromQueueItem(entry) === promptId)
  if (isRunning) return 'running'

  const isPending = Array.isArray(queue.queue_pending)
    && queue.queue_pending.some((entry) => readPromptIdFromQueueItem(entry) === promptId)
  if (isPending) return 'pending'

  return 'absent'
}

async function fetchComfyUiPromptQueuePhase(baseUrl: string, promptId: string): Promise<ComfyPromptQueuePhase> {
  try {
    const response = await fetch(`${baseUrl}/queue`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return 'unknown'

    const queue = await response.json() as ComfyQueueResponse
    return resolveComfyUiPromptQueuePhase(queue, promptId)
  } catch {
    return 'unknown'
  }
}

function parseDataUrl(source: string): { buffer: Buffer; mimeType: string; filename: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(source.trim())
  if (!match) return null

  const mimeType = match[1] || 'application/octet-stream'
  const payload = match[2] || ''
  const extension = mimeType.split('/')[1] || 'bin'
  return {
    buffer: Buffer.from(payload, 'base64'),
    mimeType,
    filename: `upload.${extension.replace(/[^a-z0-9]+/gi, '') || 'bin'}`,
  }
}

async function loadBinarySource(source: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const dataUrl = parseDataUrl(source)
  if (dataUrl) return dataUrl

  const response = await fetch(source, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`COMFYUI_SOURCE_FETCH_FAILED: ${response.status} ${detail.slice(0, 200)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const mimeType = response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream'
  let filename = 'upload.bin'

  try {
    const url = new URL(source)
    const candidate = basename(url.pathname || '')
    if (candidate) filename = candidate
  } catch {
    if (source.includes('/')) {
      filename = basename(source)
    }
  }

  return { buffer, mimeType, filename }
}

function toBlobPart(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return arrayBuffer
}

function buildUploadFilename(originalFilename: string, mimeType: string, index: number): string {
  const sanitizedBase = basename(originalFilename, extname(originalFilename))
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  const extension = extname(originalFilename)
    || (() => {
      const guessed = mimeType.split('/')[1] || 'bin'
      return `.${guessed.replace(/[^a-z0-9]+/gi, '') || 'bin'}`
    })()
  return `waoowaoo-${Date.now()}-${index}-${sanitizedBase || 'upload'}${extension}`
}

async function uploadComfyUiImage(baseUrl: string, imageUrl: string, index: number): Promise<string> {
  const { buffer, mimeType, filename } = await loadBinarySource(imageUrl)
  const formData = new FormData()
  formData.set(
    'image',
    new Blob([toBlobPart(buffer)], { type: mimeType }),
    buildUploadFilename(filename, mimeType, index),
  )
  formData.set('type', 'input')

  const response = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(120_000),
  })
  const rawText = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`COMFYUI_UPLOAD_FAILED: ${response.status} ${rawText.slice(0, 300)}`)
  }

  let payload: unknown = null
  try {
    payload = rawText.trim() ? JSON.parse(rawText) as unknown : null
  } catch {
    payload = null
  }

  const uploadedName = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { name?: unknown }).name
    : null
  if (typeof uploadedName === 'string' && uploadedName.trim()) {
    return uploadedName.trim()
  }

  throw new Error('COMFYUI_UPLOAD_FAILED: missing uploaded filename')
}

async function uploadComfyUiImages(baseUrl: string, imageUrls: string[]): Promise<string[]> {
  const filenames: string[] = []
  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = imageUrls[index]
    if (!imageUrl) continue
    filenames.push(await uploadComfyUiImage(baseUrl, imageUrl, index))
  }
  return filenames
}

async function uploadComfyUiAudio(baseUrl: string, audioUrl: string, index: number): Promise<string> {
  const { buffer, mimeType, filename } = await loadBinarySource(audioUrl)
  const formData = new FormData()
  formData.set(
    'image',
    new Blob([toBlobPart(buffer)], { type: mimeType }),
    buildUploadFilename(filename, mimeType, index),
  )
  formData.set('type', 'input')

  const response = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(120_000),
  })
  const rawText = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`COMFYUI_UPLOAD_FAILED: ${response.status} ${rawText.slice(0, 300)}`)
  }

  let payload: unknown = null
  try {
    payload = rawText.trim() ? JSON.parse(rawText) as unknown : null
  } catch {
    payload = null
  }

  const uploadedName = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { name?: unknown }).name
    : null
  if (typeof uploadedName === 'string' && uploadedName.trim()) {
    return uploadedName.trim()
  }

  throw new Error('COMFYUI_UPLOAD_FAILED: missing uploaded filename')
}

async function uploadComfyUiAudios(baseUrl: string, audioUrls: string[]): Promise<string[]> {
  const filenames: string[] = []
  for (let index = 0; index < audioUrls.length; index += 1) {
    const audioUrl = audioUrls[index]
    if (!audioUrl) continue
    filenames.push(await uploadComfyUiAudio(baseUrl, audioUrl, index))
  }
  return filenames
}

let comfyUiAudioWorkflowTail: Promise<void> = Promise.resolve()

function shouldSerializeComfyUiAudioWorkflow(): boolean {
  const raw = process.env.COMFYUI_AUDIO_SERIALIZE?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

async function runSerializedComfyUiAudioWorkflow<T>(operation: () => Promise<T>): Promise<T> {
  const previous = comfyUiAudioWorkflowTail
  let releaseCurrent: (() => void) | undefined

  comfyUiAudioWorkflowTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })

  await previous.catch(() => undefined)

  try {
    return await operation()
  } finally {
    if (releaseCurrent) {
      releaseCurrent()
    }
  }
}

export async function runComfyUiWorkflow(params: {
  baseUrl: string
  workflow: ComfyUiWorkflowGraph
  expect: 'image' | 'video' | 'audio'
}): Promise<{ dataBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const promptResponse = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: params.workflow, client_id: 'waoowaoo' }),
    signal: AbortSignal.timeout(params.expect === 'video' ? 600_000 : 180_000),
  })

  if (!promptResponse.ok) {
    const detail = await promptResponse.text().catch(() => '')
    throw new Error(`COMFYUI_PROMPT_FAILED: ${promptResponse.status} ${detail.slice(0, 400)}`)
  }

  const promptJson = await promptResponse.json() as { prompt_id?: unknown; error?: unknown }
  if (promptJson.error) {
    throw new Error(`COMFYUI_PROMPT_ERROR: ${JSON.stringify(promptJson.error).slice(0, 400)}`)
  }

  const promptId = typeof promptJson.prompt_id === 'string' ? promptJson.prompt_id.trim() : ''
  if (!promptId) {
    throw new Error('COMFYUI_PROMPT_ERROR: missing prompt_id')
  }

  const submittedAt = Date.now()
  const queueTimeoutMs = getComfyUiQueueTimeoutMs(params.expect)
  const executionTimeoutMs = getComfyUiExecutionTimeoutMs(params.expect)
  const historyGraceMs = getComfyUiHistoryGraceMs(params.expect)
  const queuePollIntervalMs = getComfyUiQueuePollIntervalMs(params.expect)
  let mediaRef: MediaRef | null = null
  let executionStartedAt: number | null = null
  let leftQueueWithoutHistoryAt: number | null = null
  let hasEverAppearedInQueue = false
  let lastQueuePollAt = 0
  let lastKnownQueuePhase: ComfyPromptQueuePhase = 'unknown'

  while (true) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))

    const now = Date.now()
    const historyResponse = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (historyResponse.ok) {
      const history = await historyResponse.json() as Record<string, ComfyHistoryEntry>
      const entry = history[promptId]
      if (entry) {
        mediaRef = pickPreferredMediaRefFromOutputs(entry.outputs, params.expect, params.workflow)
        if (mediaRef) break

        if (executionStartedAt === null) {
          executionStartedAt = now
        }
        leftQueueWithoutHistoryAt ??= now
      }
    }

    if (executionStartedAt === null || leftQueueWithoutHistoryAt !== null) {
      const shouldPollQueue = now - lastQueuePollAt >= queuePollIntervalMs
      if (shouldPollQueue) {
        lastQueuePollAt = now
        const queuePhase = await fetchComfyUiPromptQueuePhase(base, promptId)
        if (queuePhase !== 'unknown') {
          lastKnownQueuePhase = queuePhase
        }

        if (queuePhase === 'pending') {
          hasEverAppearedInQueue = true
          leftQueueWithoutHistoryAt = null
        } else if (queuePhase === 'running') {
          hasEverAppearedInQueue = true
          executionStartedAt ??= now
          leftQueueWithoutHistoryAt = null
        } else if (queuePhase === 'absent' && hasEverAppearedInQueue) {
          executionStartedAt ??= now
          leftQueueWithoutHistoryAt ??= now
        }
      }
    }

    if (executionStartedAt === null) {
      if (now - submittedAt > queueTimeoutMs) {
        throw new Error(`COMFYUI_QUEUE_TIMEOUT: prompt stayed queued too long without starting ${params.expect} generation`)
      }
      continue
    }

    if (
      leftQueueWithoutHistoryAt !== null
      && lastKnownQueuePhase === 'absent'
      && now - leftQueueWithoutHistoryAt > historyGraceMs
    ) {
      throw new Error(`COMFYUI_HISTORY_TIMEOUT: no ${params.expect} output found`)
    }

    if (now - executionStartedAt > executionTimeoutMs) {
      throw new Error(`COMFYUI_HISTORY_TIMEOUT: no ${params.expect} output found`)
    }
  }

  if (!mediaRef) {
    throw new Error(`COMFYUI_HISTORY_TIMEOUT: no ${params.expect} output found`)
  }

  const search = new URLSearchParams({
    filename: mediaRef.filename,
    subfolder: mediaRef.subfolder,
    type: mediaRef.type,
  })
  const viewResponse = await fetch(`${base}/view?${search.toString()}`, {
    signal: AbortSignal.timeout(120_000),
  })
  if (!viewResponse.ok) {
    const detail = await viewResponse.text().catch(() => '')
    throw new Error(`COMFYUI_VIEW_FAILED: ${viewResponse.status} ${detail.slice(0, 200)}`)
  }

  const buffer = Buffer.from(await viewResponse.arrayBuffer())
  const headerMime = viewResponse.headers.get('content-type')?.split(';')[0].trim()
  const mimeType = headerMime && headerMime !== 'application/octet-stream'
    ? headerMime
    : guessMimeFromFilename(mediaRef.filename)

  return {
    dataBase64: buffer.toString('base64'),
    mimeType,
  }
}

export async function runComfyUiImageWorkflow(params: {
  baseUrl: string
  workflowKey?: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  referenceImages?: string[]
}): Promise<{ imageBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const workflowKey = params.workflowKey?.trim() || COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID
  const referenceImages = params.referenceImages || []
  const imageInputCount = getComfyUiWorkflowImageInputCount(workflowKey)
  const imageSources = referenceImages.length === 0 && imageInputCount > 0
    ? [COMFYUI_NEUTRAL_REFERENCE_IMAGE]
    : referenceImages
  const imageFilenames = await uploadComfyUiImages(base, imageSources)
  const workflow = resolveComfyUiWorkflow(
    workflowKey,
    {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      width: params.width,
      height: params.height,
      imageFilenames,
    },
  )

  const { dataBase64, mimeType } = await runComfyUiWorkflow({
    baseUrl: base,
    workflow,
    expect: 'image',
  })
  return { imageBase64: dataBase64, mimeType }
}

export async function runComfyUiVideoWorkflow(params: {
  baseUrl: string
  workflowKey?: string
  prompt?: string
  firstFrameImageUrl: string
  lastFrameImageUrl?: string
  width?: number
  height?: number
  durationSeconds?: number
  fps?: number
}): Promise<{ videoBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const imageFilenames = await uploadComfyUiImages(
    base,
    [params.firstFrameImageUrl, params.lastFrameImageUrl].filter((value): value is string => !!value),
  )
  const fps = typeof params.fps === 'number' && Number.isFinite(params.fps) && params.fps > 0
    ? params.fps
    : undefined
  const durationSeconds = typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
    ? params.durationSeconds
    : undefined
  const targetFrameCount = fps && durationSeconds
    ? Math.max(1, Math.round(fps * durationSeconds))
    : undefined
  const workflow = resolveComfyUiWorkflow(
    params.workflowKey?.trim() || COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID,
    {
      prompt: params.prompt,
      imageFilenames,
      width: params.width,
      height: params.height,
      fps,
      durationSeconds,
      targetFrameCount,
    },
  )

  const { dataBase64, mimeType } = await runComfyUiWorkflow({
    baseUrl: base,
    workflow,
    expect: 'video',
  })
  return { videoBase64: dataBase64, mimeType }
}

export async function runComfyUiAudioWorkflow(params: {
  baseUrl: string
  workflowKey: string
  prompt: string
  referenceAudioUrls?: string[]
}): Promise<{ audioBase64: string; mimeType: string }> {
  const runWorkflow = async () => {
    const base = normalizeComfyBaseUrl(params.baseUrl)
    const audioFilenames = await uploadComfyUiAudios(base, params.referenceAudioUrls || [])
    const workflow = resolveComfyUiWorkflow(params.workflowKey.trim(), {
      prompt: params.prompt,
      audioFilenames,
    })

    const { dataBase64, mimeType } = await runComfyUiWorkflow({
      baseUrl: base,
      workflow,
      expect: 'audio',
    })

    return {
      audioBase64: dataBase64,
      mimeType,
    }
  }

  if (shouldSerializeComfyUiAudioWorkflow()) {
    return await runSerializedComfyUiAudioWorkflow(runWorkflow)
  }

  return await runWorkflow()
}

export async function probeComfyUiServer(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const base = normalizeComfyBaseUrl(baseUrl)
  try {
    const response = await fetch(`${base}/queue`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` }
    }
    return { ok: true, message: 'ComfyUI server reachable' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}
