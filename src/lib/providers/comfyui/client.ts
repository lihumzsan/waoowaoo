import { basename, extname } from 'path'
import {
  COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID,
  COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID,
  resolveComfyUiWorkflow,
  type ComfyUiWorkflowGraph,
} from './workflow-registry'

function normalizeComfyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

type ComfyHistoryEntry = {
  status?: { completed?: boolean; status_str?: string }
  outputs?: Record<string, Record<string, unknown>>
}

type MediaRef = {
  filename: string
  subfolder: string
  type: string
}

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

function collectMediaRefsFromOutputs(outputs: Record<string, Record<string, unknown>> | undefined): MediaRef[] {
  const refs: MediaRef[] = []
  if (!outputs) return refs

  for (const block of Object.values(outputs)) {
    if (!block || typeof block !== 'object') continue
    for (const value of Object.values(block)) {
      if (!Array.isArray(value)) continue
      for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const filename = typeof record.filename === 'string' ? record.filename.trim() : ''
        if (!filename) continue
        refs.push({
          filename,
          subfolder: typeof record.subfolder === 'string' ? record.subfolder : '',
          type: typeof record.type === 'string' ? record.type : 'output',
        })
      }
    }
  }

  return refs
}

function pickMediaRef(refs: MediaRef[], expect: 'image' | 'video' | 'audio'): MediaRef | null {
  if (refs.length === 0) return null
  if (expect === 'image') {
    return refs.find((ref) => IMAGE_EXTENSIONS.test(ref.filename)) ?? refs[0] ?? null
  }
  if (expect === 'video') {
    return refs.find((ref) => VIDEO_EXTENSIONS.test(ref.filename)) ?? refs[0] ?? null
  }
  return refs.find((ref) => AUDIO_EXTENSIONS.test(ref.filename)) ?? refs[0] ?? null
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

  const deadline = Date.now() + (params.expect === 'video' ? 600_000 : 300_000)
  let mediaRef: MediaRef | null = null

  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
    const historyResponse = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!historyResponse.ok) continue

    const history = await historyResponse.json() as Record<string, ComfyHistoryEntry>
    const entry = history[promptId]
    if (!entry) continue

    const refs = collectMediaRefsFromOutputs(entry.outputs)
    mediaRef = pickMediaRef(refs, params.expect)
    if (mediaRef) break
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
  const imageFilenames = await uploadComfyUiImages(base, params.referenceImages || [])
  const workflow = resolveComfyUiWorkflow(
    params.workflowKey?.trim() || COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID,
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
}): Promise<{ videoBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const imageFilenames = await uploadComfyUiImages(
    base,
    [params.firstFrameImageUrl, params.lastFrameImageUrl].filter((value): value is string => !!value),
  )
  const workflow = resolveComfyUiWorkflow(
    params.workflowKey?.trim() || COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID,
    {
      prompt: params.prompt,
      imageFilenames,
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
}): Promise<{ audioBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const workflow = resolveComfyUiWorkflow(params.workflowKey.trim(), {
    prompt: params.prompt,
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
