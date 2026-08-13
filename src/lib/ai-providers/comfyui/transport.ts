import { readResponseBufferWithLimit } from '@/lib/http/body-limits'

export class ComfyUiHttpError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, payload: unknown) {
    super(`COMFYUI_HTTP_${status}:${readComfyUiHttpError(payload)}`)
    this.name = 'ComfyUiHttpError'
    this.status = status
    this.payload = payload
  }
}

export type ComfyUiOutput = {
  readonly filename: string
  readonly subfolder: string
  readonly type: string
}

export function asComfyUiRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readComfyUiString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readComfyUiHttpError(value: unknown): string {
  const record = asComfyUiRecord(value)
  return (
    readComfyUiString(record?.error)
    || readComfyUiString(record?.message)
    || readComfyUiString(record?.exception_message)
    || 'ComfyUI request failed'
  ).slice(0, 512)
}

export function readComfyUiRequiredOptions(info: unknown, className: string, field: string): string[] {
  const definition = asComfyUiRecord(asComfyUiRecord(info)?.[className])
  const input = asComfyUiRecord(definition?.input)
  const required = asComfyUiRecord(input?.required)
  const fieldValue = required?.[field]
  if (!Array.isArray(fieldValue)) return []
  const directOptions = fieldValue[0]
  if (Array.isArray(directOptions)) {
    return directOptions.filter((value): value is string => typeof value === 'string')
  }
  const metadata = asComfyUiRecord(fieldValue[1])
  const options = metadata?.options
  return Array.isArray(options)
    ? options.filter((value): value is string => typeof value === 'string')
    : []
}

export function buildComfyUiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}${path}`
}

export async function requestComfyUiJson(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(buildComfyUiUrl(baseUrl, path), {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(60_000),
    cache: 'no-store',
  })
  const text = await response.text()
  let payload: unknown = null
  try { payload = text ? JSON.parse(text) as unknown : null } catch { payload = text }
  if (!response.ok) throw new ComfyUiHttpError(response.status, payload)
  return payload
}

export type ComfyUiPromptInspection =
  | { readonly status: 'missing' }
  | { readonly status: 'pending'; readonly pendingPhase: 'queued' | 'running' }
  | { readonly status: 'completed'; readonly outputs: unknown }
  | { readonly status: 'failed'; readonly details: unknown }

/**
 * Standard ComfyUI only exposes a prompt-specific deletion operation for
 * queue-pending prompts. `/interrupt` is global, so a running prompt is left
 * alone rather than accidentally interrupting another local generation.
 */
export type ComfyUiPromptCancellationOutcome =
  | 'removed_from_queue'
  | 'running_not_cancelled'
  | 'already_terminal_or_missing'

function queueContainsPrompt(value: unknown, promptId: string): boolean {
  if (!Array.isArray(value)) return false
  return value.some((entry) => Array.isArray(entry) && readComfyUiString(entry[1]) === promptId)
}

export async function inspectComfyUiPrompt(
  baseUrl: string,
  promptId: string,
): Promise<ComfyUiPromptInspection> {
  const history = asComfyUiRecord(
    await requestComfyUiJson(baseUrl, `/history/${encodeURIComponent(promptId)}`),
  )
  const historyItem = asComfyUiRecord(history?.[promptId])
  if (historyItem) {
    const status = asComfyUiRecord(historyItem.status)
    const statusText = readComfyUiString(status?.status_str).toLowerCase()
    if (statusText === 'success') {
      return { status: 'completed', outputs: historyItem.outputs }
    }
    if (statusText === 'error' || statusText === 'failed' || statusText === 'cancelled') {
      return { status: 'failed', details: historyItem }
    }
  }

  const queue = asComfyUiRecord(await requestComfyUiJson(baseUrl, '/queue'))
  if (queueContainsPrompt(queue?.queue_running, promptId)) {
    return { status: 'pending', pendingPhase: 'running' }
  }
  if (queueContainsPrompt(queue?.queue_pending, promptId)) {
    return { status: 'pending', pendingPhase: 'queued' }
  }
  return { status: 'missing' }
}

export async function cancelComfyUiQueuedPrompt(
  baseUrl: string,
  promptId: string,
): Promise<ComfyUiPromptCancellationOutcome> {
  const inspection = await inspectComfyUiPrompt(baseUrl, promptId)
  if (inspection.status === 'pending' && inspection.pendingPhase === 'running') {
    return 'running_not_cancelled'
  }
  if (inspection.status !== 'pending') {
    return 'already_terminal_or_missing'
  }
  await requestComfyUiJson(baseUrl, '/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
  })
  return 'removed_from_queue'
}

export function readComfyUiOutput(value: unknown): ComfyUiOutput | null {
  const record = asComfyUiRecord(value)
  if (!record) return null
  const candidate = asComfyUiRecord(
    record['15']
    ?? record['16']
    ?? record['28']
    ?? record['30']
    ?? record['141']
    ?? record.preview_output
    ?? record.output
    ?? record,
  )
  if (!candidate) return null
  const nodeId = readComfyUiString(candidate.nodeId)
  if (nodeId && !['15', '16', '28', '30', '141'].includes(nodeId)) return null
  for (const field of ['gifs', 'videos', 'files', 'audio']) {
    const list = candidate[field]
    if (!Array.isArray(list)) continue
    const first = asComfyUiRecord(list[0])
    const filename = readComfyUiString(first?.filename)
    if (filename) {
      return {
        filename,
        subfolder: readComfyUiString(first?.subfolder),
        type: readComfyUiString(first?.type) || 'output',
      }
    }
  }
  const filename = readComfyUiString(candidate.filename)
  return filename
    ? {
        filename,
        subfolder: readComfyUiString(candidate.subfolder),
        type: readComfyUiString(candidate.type) || 'output',
      }
    : null
}

export function readComfyUiDeclaredNodeAudioOutput(
  value: unknown,
  expectedNodeId: string,
): ComfyUiOutput | null {
  const record = asComfyUiRecord(value)
  if (!record) return null
  const candidate = asComfyUiRecord(record[expectedNodeId])
    ?? (readComfyUiString(record.nodeId) === expectedNodeId ? record : null)
  if (!candidate) return null
  const audio = candidate.audio
  if (!Array.isArray(audio) || audio.length !== 1) return null
  const file = asComfyUiRecord(audio[0])
  const filename = readComfyUiString(file?.filename)
  if (!filename || !/\.mp3$/iu.test(filename)) return null
  return {
    filename,
    subfolder: readComfyUiString(file?.subfolder),
    type: readComfyUiString(file?.type) || 'output',
  }
}

export async function readComfyUiOutputData(input: {
  readonly baseUrl: string
  readonly output: ComfyUiOutput
  readonly contentType: string
  readonly maxBytes: number
  readonly label: string
}): Promise<string> {
  const query = new URLSearchParams({
    filename: input.output.filename,
    subfolder: input.output.subfolder,
    type: input.output.type,
  })
  const response = await fetch(buildComfyUiUrl(input.baseUrl, `/view?${query.toString()}`), {
    signal: AbortSignal.timeout(120_000),
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`COMFYUI_OUTPUT_HTTP_${response.status}`)
  const actualContentType = (response.headers.get('content-type') || '').split(';', 1)[0]!.trim().toLowerCase()
  if (actualContentType !== input.contentType) {
    throw new Error(`COMFYUI_OUTPUT_CONTENT_TYPE_INVALID:${actualContentType || '<missing>'}`)
  }
  const buffer = await readResponseBufferWithLimit(response, input.maxBytes, input.label)
  return `data:${actualContentType};base64,${buffer.toString('base64')}`
}
