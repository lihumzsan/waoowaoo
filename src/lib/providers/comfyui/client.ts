import { basename, extname } from 'path'
import { toFetchableUrl } from '@/lib/storage/utils'
import {
  VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES,
  isValidVideoTrimFrames,
} from '@/lib/video-tools/trim-frames'
import {
  COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID,
  COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID,
  comfyUiWorkflowRequiresLlmApi,
  getComfyUiWorkflowAudioInputCount,
  getComfyUiWorkflowImageInputCount,
  resolveComfyUiWorkflow,
  validateResolvedWorkflowPreflight,
  type ComfyUiWorkflowGraph,
  type ComfyUiWorkflowLlmApiInject,
} from './workflow-registry'
import { COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID } from './ltx23-workflow-profiles'
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
const MODEL_FILE_EXTENSIONS = /\.(safetensors|ckpt|pt|pth|bin)$/i
const NEUTRAL_AUDIO_SAMPLE_RATE = 16_000
const MAX_NEUTRAL_AUDIO_SECONDS = 60

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

function normalizeModelPath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase()
}

function modelBasename(value: string): string {
  const normalized = normalizeModelPath(value)
  return normalized.split('/').filter(Boolean).pop() || normalized
}

function buildSilentWavDataUrl(durationSeconds: number | undefined): string {
  const safeDuration = Math.max(
    0.1,
    Math.min(
      MAX_NEUTRAL_AUDIO_SECONDS,
      typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : 1,
    ),
  )
  const sampleCount = Math.max(1, Math.ceil(NEUTRAL_AUDIO_SAMPLE_RATE * safeDuration))
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(NEUTRAL_AUDIO_SAMPLE_RATE, 24)
  buffer.writeUInt32LE(NEUTRAL_AUDIO_SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return `data:audio/wav;base64,${buffer.toString('base64')}`
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

function readEnabledEnvFlag(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function shouldDumpComfyUiVideoPrompt(): boolean {
  return readEnabledEnvFlag(process.env.COMFYUI_VIDEO_PROMPT_DUMP)
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

function getComfyUiPendingTimeoutMs(expect: 'image' | 'video' | 'audio'): number {
  if (expect === 'video') {
    return readTimeoutOverride(process.env.COMFYUI_VIDEO_PENDING_TIMEOUT_MS, 43_200_000)
  }
  if (expect === 'audio') {
    return readTimeoutOverride(process.env.COMFYUI_AUDIO_PENDING_TIMEOUT_MS, 7_200_000)
  }
  return readTimeoutOverride(process.env.COMFYUI_IMAGE_PENDING_TIMEOUT_MS, 3_600_000)
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

type LoadedBufferedSource = {
  buffer: Buffer
  mimeType: string
  filename: string
}

type LoadedStreamingSource = {
  body: ReadableStream<Uint8Array>
  contentLength?: number
  mimeType: string
  filename: string
}

type LoadedBinarySource = LoadedBufferedSource | LoadedStreamingSource

function readOptionalContentLength(headers: Headers): number | undefined {
  const rawLength = headers.get('content-length')?.trim()
  if (!rawLength || !/^\d+$/.test(rawLength)) return undefined
  const contentLength = Number(rawLength)
  return Number.isSafeInteger(contentLength) ? contentLength : undefined
}

function loadBinarySource(source: string): Promise<LoadedBufferedSource>
function loadBinarySource(source: string, streamRemote: true): Promise<LoadedBinarySource>
function loadBinarySource(source: string, streamRemote: boolean): Promise<LoadedBinarySource>
async function loadBinarySource(source: string, streamRemote = false): Promise<LoadedBinarySource> {
  const dataUrl = parseDataUrl(source)
  if (dataUrl) return dataUrl

  const fetchUrl = toFetchableUrl(source)
  const response = await fetch(fetchUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`COMFYUI_SOURCE_FETCH_FAILED: ${response.status} ${detail.slice(0, 200)}`)
  }

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

  if (streamRemote) {
    if (!response.body) {
      throw new Error('COMFYUI_SOURCE_FETCH_FAILED: missing response body')
    }
    return {
      body: response.body,
      contentLength: readOptionalContentLength(response.headers),
      mimeType,
      filename,
    }
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType,
    filename,
  }
}

function toBlobPart(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return arrayBuffer
}

function buildUploadFilename(originalFilename: string, mimeType: string, index: number): string {
  const originalExtension = extname(originalFilename)
  const sanitizedBase = basename(originalFilename, originalExtension)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  const extension = /^\.[a-z0-9]{1,10}$/i.test(originalExtension)
    ? originalExtension
    : (() => {
      const guessed = mimeType.split('/')[1] || 'bin'
      return `.${guessed.replace(/[^a-z0-9]+/gi, '') || 'bin'}`
    })()
  return `waoowaoo-${Date.now()}-${index}-${sanitizedBase || 'upload'}${extension}`
}

function buildStreamingMultipartBody(source: {
  body: ReadableStream<Uint8Array>
  contentLength?: number
  mimeType: string
}, filename: string): {
  body: ReadableStream<Uint8Array>
  headers: Headers
} {
  const boundary = `----waoowaoo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const encoder = new TextEncoder()
  const prefix = encoder.encode([
    `--${boundary}`,
    `Content-Disposition: form-data; name="image"; filename="${filename}"`,
    `Content-Type: ${source.mimeType}`,
    '',
    '',
  ].join('\r\n'))
  const suffix = encoder.encode([
    '',
    `--${boundary}`,
    'Content-Disposition: form-data; name="type"',
    '',
    'input',
    `--${boundary}--`,
    '',
  ].join('\r\n'))
  const reader = source.body.getReader()
  let stage: 'prefix' | 'content' | 'suffix' | 'done' = 'prefix'
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 'prefix') {
        controller.enqueue(prefix)
        stage = 'content'
        return
      }
      if (stage === 'content') {
        try {
          const chunk = await reader.read()
          if (!chunk.done) {
            controller.enqueue(chunk.value)
            return
          }
          stage = 'suffix'
        } catch (error) {
          controller.error(error)
          return
        }
      }
      if (stage === 'suffix') {
        controller.enqueue(suffix)
        stage = 'done'
        return
      }
      controller.close()
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  const headers = new Headers({
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  })
  if (source.contentLength !== undefined) {
    headers.set('Content-Length', String(prefix.byteLength + source.contentLength + suffix.byteLength))
  }
  return { body, headers }
}

async function uploadComfyUiImage(
  baseUrl: string,
  imageUrl: string,
  index: number,
  streamRemote = false,
): Promise<string> {
  const source = await loadBinarySource(imageUrl, streamRemote)
  const uploadFilename = buildUploadFilename(source.filename, source.mimeType, index)
  let requestInit: RequestInit
  if ('buffer' in source) {
    const formData = new FormData()
    formData.set(
      'image',
      new Blob([toBlobPart(source.buffer)], { type: source.mimeType }),
      uploadFilename,
    )
    formData.set('type', 'input')
    requestInit = {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(120_000),
    }
  } else {
    const multipart = buildStreamingMultipartBody(source, uploadFilename)
    requestInit = {
      method: 'POST',
      headers: multipart.headers,
      body: multipart.body,
      duplex: 'half',
      signal: AbortSignal.timeout(120_000),
    } as RequestInit & { duplex: 'half' }
  }

  const response = await fetch(`${baseUrl}/upload/image`, requestInit)
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

async function uploadComfyUiImages(
  baseUrl: string,
  imageUrls: string[],
  streamRemote = false,
): Promise<string[]> {
  const filenames: string[] = []
  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = imageUrls[index]
    if (!imageUrl) continue
    filenames.push(await uploadComfyUiImage(baseUrl, imageUrl, index, streamRemote))
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

function readObjectInfoOptionList(payload: unknown, classType: string, field: string): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const root = payload as Record<string, unknown>
  const rawClassInfo = root[classType]
  if (!rawClassInfo || typeof rawClassInfo !== 'object' || Array.isArray(rawClassInfo)) return []
  const classInfo = rawClassInfo as Record<string, unknown>
  const input = classInfo.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []

  for (const sectionName of ['required', 'optional']) {
    const section = (input as Record<string, unknown>)[sectionName]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    const rawField = (section as Record<string, unknown>)[field]
    if (!Array.isArray(rawField)) continue
    const first = rawField[0]
    if (!Array.isArray(first)) continue
    return first.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }

  return []
}

function resolveServerModelOption(currentValue: string, allowedValues: string[]): string | null {
  if (allowedValues.includes(currentValue)) return null

  const currentBasename = modelBasename(currentValue)
  const basenameMatch = allowedValues.find((candidate) => modelBasename(candidate) === currentBasename)
  return basenameMatch || null
}

function normalizeComfyNodeClass(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function readWorkflowConnectionNodeId(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 1) return null
  const nodeId = value[0]
  if (typeof nodeId === 'string') return nodeId.trim() || null
  if (typeof nodeId === 'number' && Number.isFinite(nodeId)) return String(Math.trunc(nodeId))
  return null
}

function readWorkflowInputString(
  workflow: ComfyUiWorkflowGraph,
  value: unknown,
  visited = new Set<string>(),
): string | null {
  if (typeof value === 'string') return value
  const nodeId = readWorkflowConnectionNodeId(value)
  if (!nodeId || visited.has(nodeId)) return null
  visited.add(nodeId)

  const node = workflow[nodeId]
  if (!node || !node.inputs || typeof node.inputs !== 'object') return null
  for (const field of ['prompt', 'text', 'value', 'string', 'input_string']) {
    if (!Object.prototype.hasOwnProperty.call(node.inputs, field)) continue
    const text = readWorkflowInputString(workflow, node.inputs[field], visited)
    if (text !== null) return text
  }

  return null
}

function appendPromptDumpField(
  lines: string[],
  label: string,
  value: string | null,
): void {
  if (value === null) return
  lines.push(`${label}:`)
  lines.push(value)
}

function dumpComfyUiVideoPrompt(params: {
  workflowKey: string
  prompt?: string
  workflow: ComfyUiWorkflowGraph
  fps?: number
  durationSeconds?: number
  targetFrameCount?: number
}): void {
  if (!shouldDumpComfyUiVideoPrompt()) return

  const lines = [
    '[COMFYUI_VIDEO_PROMPT_DUMP]',
    `workflowKey: ${params.workflowKey}`,
  ]
  if (params.durationSeconds !== undefined) lines.push(`durationSeconds: ${params.durationSeconds}`)
  if (params.fps !== undefined) lines.push(`fps: ${params.fps}`)
  if (params.targetFrameCount !== undefined) lines.push(`targetFrameCount: ${params.targetFrameCount}`)
  appendPromptDumpField(lines, 'input_prompt', params.prompt || '')

  for (const [nodeId, node] of Object.entries(params.workflow).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))) {
    const classType = normalizeComfyNodeClass(node.class_type)
    if (!classType.includes('promptrelay')) continue

    const prefix = classType.includes('promptrelaysmart')
      ? `promptrelay_smart: ${nodeId}`
      : `promptrelay: ${nodeId}`
    lines.push(prefix)
    appendPromptDumpField(lines, 'global_prompt', readWorkflowInputString(params.workflow, node.inputs.global_prompt))
    appendPromptDumpField(lines, 'smart_prompt', readWorkflowInputString(params.workflow, node.inputs.smart_prompt))
    appendPromptDumpField(lines, 'local_prompts', readWorkflowInputString(params.workflow, node.inputs.local_prompts))
    appendPromptDumpField(lines, 'timeline_data', readWorkflowInputString(params.workflow, node.inputs.timeline_data))
  }

  lines.push('[/COMFYUI_VIDEO_PROMPT_DUMP]')
  try {
    process.stdout.write(`${lines.join('\n')}\n`)
  } catch {
    // Debug-only output must never break generation.
  }
}

async function fetchComfyUiObjectInfo(base: string, classType: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${base}/object_info/${encodeURIComponent(classType)}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function supportsComfyUiNumericInputValue(
  payload: unknown,
  classType: string,
  field: string,
  value: number,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const classInfo = (payload as Record<string, unknown>)[classType]
  if (!classInfo || typeof classInfo !== 'object' || Array.isArray(classInfo)) return false
  const input = (classInfo as Record<string, unknown>).input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const required = (input as Record<string, unknown>).required
  if (!required || typeof required !== 'object' || Array.isArray(required)) return false
  const inputDefinition = (required as Record<string, unknown>)[field]
  if (!Array.isArray(inputDefinition)) return false
  const options = inputDefinition[1]
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false
  const metadata = options as Record<string, unknown>
  const max = metadata.max
  if (typeof max === 'number' && Number.isFinite(max)) return max >= value
  const dynamicOptions = metadata.options
  if (!Array.isArray(dynamicOptions)) return false
  return dynamicOptions.some((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return false
    return (option as Record<string, unknown>).key === String(value)
  })
}

async function normalizeWorkflowModelInputsForServer(
  base: string,
  workflow: ComfyUiWorkflowGraph,
): Promise<ComfyUiWorkflowGraph> {
  const objectInfoByClass = new Map<string, unknown | null>()

  for (const node of Object.values(workflow)) {
    if (!node.inputs || typeof node.inputs !== 'object') continue
    for (const [field, rawValue] of Object.entries(node.inputs)) {
      if (typeof rawValue !== 'string' || !MODEL_FILE_EXTENSIONS.test(rawValue)) continue
      if (!objectInfoByClass.has(node.class_type)) {
        objectInfoByClass.set(node.class_type, await fetchComfyUiObjectInfo(base, node.class_type))
      }
      const objectInfo = objectInfoByClass.get(node.class_type)
      const allowedValues = readObjectInfoOptionList(objectInfo, node.class_type, field)
      const replacement = resolveServerModelOption(rawValue, allowedValues)
      if (replacement) {
        node.inputs[field] = replacement
      }
    }
  }

  return workflow
}

type ComfyUiWorkflowParams = {
  baseUrl: string
  workflow: ComfyUiWorkflowGraph
  expect: 'image' | 'video' | 'audio'
}

type ComfyUiWorkflowBase64Result = { dataBase64: string; mimeType: string }
type ComfyUiWorkflowViewResult = { viewUrl: string; mimeType: string; contentLength?: number }

export function runComfyUiWorkflow(
  params: ComfyUiWorkflowParams & { returnViewUrl: true },
): Promise<ComfyUiWorkflowViewResult>
export function runComfyUiWorkflow(
  params: ComfyUiWorkflowParams & { returnViewUrl?: false },
): Promise<ComfyUiWorkflowBase64Result>
export async function runComfyUiWorkflow(
  params: ComfyUiWorkflowParams & { returnViewUrl?: boolean },
): Promise<ComfyUiWorkflowBase64Result | ComfyUiWorkflowViewResult> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const workflow = await normalizeWorkflowModelInputsForServer(base, params.workflow)
  const promptResponse = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'waoowaoo' }),
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
  const pendingTimeoutMs = getComfyUiPendingTimeoutMs(params.expect)
  const executionTimeoutMs = getComfyUiExecutionTimeoutMs(params.expect)
  const historyGraceMs = getComfyUiHistoryGraceMs(params.expect)
  const queuePollIntervalMs = getComfyUiQueuePollIntervalMs(params.expect)
  let mediaRef: MediaRef | null = null
  let executionStartedAt: number | null = null
  let leftQueueWithoutHistoryAt: number | null = null
  let hasEverAppearedInQueue = false
  let firstSeenInQueueAt: number | null = null
  let lastQueuePollAt = 0
  let lastKnownQueuePhase: ComfyPromptQueuePhase = 'unknown'

  while (true) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))

    const now = Date.now()
    let history: Record<string, ComfyHistoryEntry> | null = null
    try {
      const historyResponse = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
        signal: AbortSignal.timeout(30_000),
      })
      if (historyResponse.ok) {
        history = await historyResponse.json() as Record<string, ComfyHistoryEntry>
      }
    } catch {
      history = null
    }

    if (history) {
      const entry = history[promptId]
      if (entry) {
        mediaRef = pickPreferredMediaRefFromOutputs(entry.outputs, params.expect, workflow)
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
          firstSeenInQueueAt ??= now
          leftQueueWithoutHistoryAt = null
        } else if (queuePhase === 'running') {
          hasEverAppearedInQueue = true
          firstSeenInQueueAt ??= now
          executionStartedAt ??= now
          leftQueueWithoutHistoryAt = null
        } else if (queuePhase === 'absent' && hasEverAppearedInQueue) {
          executionStartedAt ??= now
          leftQueueWithoutHistoryAt ??= now
        }
      }
    }

    if (executionStartedAt === null) {
      const queueWaitStartedAt = firstSeenInQueueAt ?? submittedAt
      const queueWaitTimeoutMs = firstSeenInQueueAt === null ? queueTimeoutMs : pendingTimeoutMs
      if (now - queueWaitStartedAt > queueWaitTimeoutMs) {
        const timeoutReason = firstSeenInQueueAt === null
          ? 'prompt stayed queued too long without starting'
          : 'prompt stayed pending in ComfyUI queue too long without starting'
        throw new Error(`COMFYUI_QUEUE_TIMEOUT: ${timeoutReason} ${params.expect} generation`)
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
  const viewUrl = `${base}/view?${search.toString()}`
  const viewResponse = await fetch(viewUrl, {
    signal: AbortSignal.timeout(120_000),
  })
  if (!viewResponse.ok) {
    const detail = await viewResponse.text().catch(() => '')
    throw new Error(`COMFYUI_VIEW_FAILED: ${viewResponse.status} ${detail.slice(0, 200)}`)
  }

  const headerMime = viewResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const headerMimeMatchesExpectedMedia = headerMime?.startsWith(`${params.expect}/`)
    || (params.expect === 'audio' && headerMime === 'application/ogg')
  if (
    headerMime
    && headerMime !== 'application/octet-stream'
    && !headerMimeMatchesExpectedMedia
  ) {
    await viewResponse.body?.cancel().catch(() => undefined)
    throw new Error(`COMFYUI_VIEW_MIME_INVALID: expected ${params.expect}, received ${headerMime}`)
  }
  const mimeType = headerMime && headerMime !== 'application/octet-stream'
    ? headerMime
    : guessMimeFromFilename(mediaRef.filename)

  if (params.returnViewUrl) {
    const contentLength = readOptionalContentLength(viewResponse.headers)
    await viewResponse.body?.cancel()
    return {
      viewUrl,
      mimeType,
      ...(contentLength === undefined ? {} : { contentLength }),
    }
  }

  const buffer = Buffer.from(await viewResponse.arrayBuffer())

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
  llmApi?: ComfyUiWorkflowLlmApiInject
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
      llmApi: params.llmApi,
    },
  )
  validateResolvedWorkflowPreflight(workflowKey, workflow, {
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    width: params.width,
    height: params.height,
    imageFilenames,
    llmApi: params.llmApi,
  }, { expect: 'image' })

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
  referenceImageUrls?: string[]
  referenceAudioUrls?: string[]
  lastFrameImageUrl?: string
  width?: number
  height?: number
  durationSeconds?: number
  fps?: number
  motionStrength?: number
  llmApi?: ComfyUiWorkflowLlmApiInject
}): Promise<{ videoUrl: string; mimeType: string; contentLength?: number }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const workflowKey = params.workflowKey?.trim() || COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID
  const imageFilenames = await uploadComfyUiImages(
    base,
    [
      params.firstFrameImageUrl,
      ...(params.referenceImageUrls || []),
      params.lastFrameImageUrl,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
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
  const audioInputCount = getComfyUiWorkflowAudioInputCount(workflowKey)
  const referenceAudioUrls = (params.referenceAudioUrls || [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const audioFilenames = audioInputCount > 0
    ? await uploadComfyUiAudios(
        base,
        referenceAudioUrls.length > 0
          ? referenceAudioUrls
          : [buildSilentWavDataUrl(durationSeconds)],
      )
    : []
  const workflow = resolveComfyUiWorkflow(
    workflowKey,
    {
      prompt: params.prompt,
      imageFilenames,
      audioFilenames,
      width: params.width,
      height: params.height,
      fps,
      durationSeconds,
      targetFrameCount,
      motionStrength: params.motionStrength,
      llmApi: params.llmApi,
    },
  )
  dumpComfyUiVideoPrompt({
    workflowKey,
    prompt: params.prompt,
    workflow,
    fps,
    durationSeconds,
    targetFrameCount,
  })

  const output = await runComfyUiWorkflow({
    baseUrl: base,
    workflow,
    expect: 'video',
    returnViewUrl: true,
  })
  return {
    videoUrl: output.viewUrl,
    mimeType: output.mimeType,
    ...(output.contentLength === undefined ? {} : { contentLength: output.contentLength }),
  }
}

export const COMFYUI_VIDEO_SEAM_CONCAT_WORKFLOW_ID = 'basevideo/tools/video-seam-concat-nvenc'

export async function runComfyUiVideoSeamMotionBridgeWorkflow(params: {
  baseUrl: string
  prompt: string
  anchorImageUrls: [string, string, string, string]
  generatedAnchorIndices: [number, number, number, number]
  width: number
  height: number
  fps: number
  durationSeconds: number
}): Promise<{ videoUrl: string; mimeType: string; contentLength?: number }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const conditioningClassType = 'LTXVImgToVideoInplaceKJ'
  const objectInfo = await fetchComfyUiObjectInfo(base, conditioningClassType)
  if (!supportsComfyUiNumericInputValue(objectInfo, conditioningClassType, 'num_images', 4)) {
    throw new Error('VIDEO_SEAM_FOUR_ANCHOR_UNSUPPORTED')
  }

  const imageFilenames = await uploadComfyUiImages(base, params.anchorImageUrls)
  const workflow = resolveComfyUiWorkflow(
    COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID,
    {
      prompt: params.prompt,
      imageFilenames,
      width: params.width,
      height: params.height,
      fps: params.fps,
      durationSeconds: params.durationSeconds,
      videoSeamMotionAnchors: { frameIndices: params.generatedAnchorIndices },
    },
  )

  for (const nodeId of ['265', '275']) {
    const inputs = workflow[nodeId]?.inputs
    const hasExpectedAnchors = inputs?.num_images === '4'
      && params.generatedAnchorIndices.every(
        (frameIndex, index) => inputs[`num_images.index_${index + 1}`] === frameIndex,
      )
    if (!hasExpectedAnchors) {
      throw new Error('COMFYUI_VIDEO_SEAM_FOUR_ANCHOR_CONTRACT_INVALID')
    }
  }

  const output = await runComfyUiWorkflow({
    baseUrl: base,
    workflow,
    expect: 'video',
    returnViewUrl: true,
  })
  return {
    videoUrl: output.viewUrl,
    mimeType: output.mimeType,
    ...(output.contentLength === undefined ? {} : { contentLength: output.contentLength }),
  }
}

export async function runComfyUiVideoSeamConcatWorkflow(params: {
  baseUrl: string
  workflowKey?: string
  videoUrls: [string, string]
  trimEndFrames?: number
  trimStartFrames?: number
}): Promise<{ videoUrl: string; mimeType: string; contentLength?: number }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const workflowKey = params.workflowKey?.trim() || COMFYUI_VIDEO_SEAM_CONCAT_WORKFLOW_ID
  const videoUrls = params.videoUrls
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (videoUrls.length !== 2) {
    throw new Error('COMFYUI_VIDEO_SEAM_CONCAT_REQUIRES_TWO_INPUTS')
  }

  const trimEndFrames = params.trimEndFrames ?? 0
  const trimStartFrames = params.trimStartFrames ?? 1
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

  const videoFilenames = await uploadComfyUiImages(base, videoUrls, true)
  const workflow = resolveComfyUiWorkflow(workflowKey, {
    videoFilenames,
    videoTrimFrames: [trimEndFrames, trimStartFrames],
  })
  const output = await runComfyUiWorkflow({
    baseUrl: base,
    workflow,
    expect: 'video',
    returnViewUrl: true,
  })

  return {
    videoUrl: output.viewUrl,
    mimeType: output.mimeType,
    ...(output.contentLength === undefined ? {} : { contentLength: output.contentLength }),
  }
}

export async function runComfyUiAudioWorkflow(params: {
  baseUrl: string
  workflowKey: string
  prompt: string
  negativePrompt?: string
  durationSeconds?: number
  seed?: number
  referenceAudioUrls?: string[]
  llmApi?: ComfyUiWorkflowLlmApiInject
}): Promise<{ audioBase64: string; mimeType: string }> {
  const runWorkflow = async () => {
    const base = normalizeComfyBaseUrl(params.baseUrl)
    const audioFilenames = await uploadComfyUiAudios(base, params.referenceAudioUrls || [])
    const workflow = resolveComfyUiWorkflow(params.workflowKey.trim(), {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      durationSeconds: params.durationSeconds,
      seed: params.seed,
      audioFilenames,
      llmApi: params.llmApi,
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

export function isComfyUiWorkflowLlmApiRequired(workflowKey: string): boolean {
  return comfyUiWorkflowRequiresLlmApi(workflowKey)
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
