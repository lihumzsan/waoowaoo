import {
  resolveComfyUiImageWorkflow,
  resolveComfyUiVideoWorkflow,
  type ComfyUiWorkflowGraph,
  type ComfyUiWorkflowInject,
} from './workflow-registry'

function normalizeComfyBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return trimmed
}

export interface ComfyUiTxt2ImgParams {
  baseUrl: string
  /** 工作流标识：默认 qwen-image-txt2img，或 workflows/<id>.json 的文件名（不含扩展名） */
  workflowKey: string
  prompt: string
  width: number
  height: number
  negativePrompt?: string
}

type ComfyHistoryEntry = {
  status?: { completed?: boolean; status_str?: string }
  outputs?: Record<string, Record<string, unknown>>
}

type MediaRef = { filename: string; subfolder: string; type: string }

function collectMediaRefsFromOutputs(outputs: Record<string, Record<string, unknown>> | undefined): MediaRef[] {
  const out: MediaRef[] = []
  if (!outputs) return out
  for (const block of Object.values(outputs)) {
    if (!block || typeof block !== 'object') continue
    for (const val of Object.values(block)) {
      if (!Array.isArray(val)) continue
      for (const item of val) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        if (typeof o.filename !== 'string' || !o.filename) continue
        out.push({
          filename: o.filename,
          subfolder: typeof o.subfolder === 'string' ? o.subfolder : '',
          type: typeof o.type === 'string' ? o.type : 'output',
        })
      }
    }
  }
  return out
}

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i
const VIDEO_EXT = /\.(mp4|webm|gif|mov|mkv|avi)$/i

function pickMediaRef(refs: MediaRef[], mode: 'image' | 'video'): MediaRef | null {
  if (refs.length === 0) return null
  if (mode === 'image') {
    const img = refs.find((r) => IMAGE_EXT.test(r.filename))
    return img ?? refs[0] ?? null
  }
  const vid = refs.find((r) => VIDEO_EXT.test(r.filename))
  return vid ?? refs[0] ?? null
}

function guessMimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  return 'application/octet-stream'
}

export async function runComfyUiWorkflow(params: {
  baseUrl: string
  workflow: ComfyUiWorkflowGraph
  expect: 'image' | 'video'
}): Promise<{ dataBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const body = { prompt: params.workflow, client_id: 'waoowaoo' }

  const promptRes = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.expect === 'video' ? 600_000 : 120_000),
  })

  if (!promptRes.ok) {
    const text = await promptRes.text().catch(() => '')
    throw new Error(`ComfyUI /prompt failed: ${promptRes.status} ${text.slice(0, 400)}`)
  }

  const promptJson = (await promptRes.json()) as { prompt_id?: string; error?: unknown }
  if (promptJson.error) {
    throw new Error(`ComfyUI prompt error: ${JSON.stringify(promptJson.error).slice(0, 500)}`)
  }
  const promptId = promptJson.prompt_id
  if (!promptId) {
    throw new Error('ComfyUI did not return prompt_id')
  }

  const deadline = Date.now() + (params.expect === 'video' ? 600_000 : 300_000)
  let mediaRef: MediaRef | null = null

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    const histRes = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!histRes.ok) continue
    const hist = (await histRes.json()) as Record<string, ComfyHistoryEntry>
    const entry = hist[promptId]
    if (!entry) continue
    const refs = collectMediaRefsFromOutputs(entry.outputs)
    mediaRef = pickMediaRef(refs, params.expect)
    if (mediaRef) break
  }

  if (!mediaRef) {
    throw new Error(
      params.expect === 'video'
        ? 'ComfyUI generation timed out (no video/image output in history)'
        : 'ComfyUI generation timed out (no image in history)',
    )
  }

  const viewParams = new URLSearchParams({
    filename: mediaRef.filename,
    subfolder: mediaRef.subfolder,
    type: mediaRef.type,
  })
  const viewRes = await fetch(`${base}/view?${viewParams.toString()}`, {
    signal: AbortSignal.timeout(120_000),
  })
  if (!viewRes.ok) {
    const t = await viewRes.text().catch(() => '')
    throw new Error(`ComfyUI /view failed: ${viewRes.status} ${t.slice(0, 200)}`)
  }

  const buf = Buffer.from(await viewRes.arrayBuffer())
  const headerMime = viewRes.headers.get('content-type')?.split(';')[0].trim()
  const mimeType = headerMime && headerMime !== 'application/octet-stream'
    ? headerMime
    : guessMimeFromFilename(mediaRef.filename)

  return {
    dataBase64: buf.toString('base64'),
    mimeType,
  }
}

export async function runComfyUiTxt2Img(params: ComfyUiTxt2ImgParams): Promise<{
  imageBase64: string
  mimeType: string
}> {
  const inject: ComfyUiWorkflowInject = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
  }
  if (params.negativePrompt) inject.negativePrompt = params.negativePrompt

  const workflow = resolveComfyUiImageWorkflow(params.workflowKey, inject)
  const { dataBase64, mimeType } = await runComfyUiWorkflow({
    baseUrl: params.baseUrl,
    workflow,
    expect: 'image',
  })
  return { imageBase64: dataBase64, mimeType }
}

export async function runComfyUiVideoWorkflow(params: {
  baseUrl: string
  workflowKey: string
  prompt?: string
}): Promise<{ videoBase64: string; mimeType: string }> {
  const workflow = resolveComfyUiVideoWorkflow(params.workflowKey, { prompt: params.prompt })
  const { dataBase64, mimeType } = await runComfyUiWorkflow({
    baseUrl: params.baseUrl,
    workflow,
    expect: 'video',
  })
  return { videoBase64: dataBase64, mimeType }
}

export async function probeComfyUiServer(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const base = normalizeComfyBaseUrl(baseUrl)
  try {
    const res = await fetch(`${base}/queue`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` }
    }
    return { ok: true, message: 'ComfyUI server reachable' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}
