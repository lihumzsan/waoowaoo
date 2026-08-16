import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { readProviderJsonResponse } from '@/lib/ai-providers/failure'
import type { AsyncTemporaryMediaFile } from '@/lib/ai-providers/async-task-types'
import { ApiError } from '@/lib/api-errors'

export const COMFYUI_ACCEPTED_JOB_STATUSES = new Set([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
])

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
  const payload = await readProviderJsonResponse({
    response,
    provider: 'comfyui',
    phase: init?.method === 'POST' ? 'submit' : 'poll',
  })
  if (!response.ok) throw new ComfyUiHttpError(response.status, payload)
  return payload
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

export function readComfyUiDeclaredNodeVideoOutput(
  value: unknown,
  expectedNodeId: string,
): ComfyUiOutput | null {
  const record = asComfyUiRecord(value)
  if (!record) return null
  const candidate = asComfyUiRecord(record[expectedNodeId])
    ?? (readComfyUiString(record.nodeId) === expectedNodeId ? record : null)
  if (!candidate) return null
  for (const field of ['gifs', 'videos', 'files']) {
    const list = candidate[field]
    if (!Array.isArray(list) || list.length !== 1) continue
    const file = asComfyUiRecord(list[0])
    const filename = readComfyUiString(file?.filename)
    if (!filename || !/\.mp4$/iu.test(filename)) return null
    return {
      filename,
      subfolder: readComfyUiString(file?.subfolder),
      type: readComfyUiString(file?.type) || 'output',
    }
  }
  return null
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

export async function downloadComfyUiOutputToTemporaryFile(input: {
  readonly baseUrl: string
  readonly output: ComfyUiOutput
  readonly contentType: string
  readonly maxBytes: number
  readonly label: string
}): Promise<AsyncTemporaryMediaFile> {
  const outputTooLarge = () => new ApiError('INVALID_PARAMS', {
    code: 'PAYLOAD_TOO_LARGE',
    field: 'body',
    message: `${input.label} exceeds the ${input.maxBytes} byte limit`,
  })
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
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > input.maxBytes) {
    throw outputTooLarge()
  }
  if (!response.body) throw new Error('COMFYUI_OUTPUT_BODY_MISSING')

  const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-comfyui-output-'))
  const filePath = path.join(directory, 'output.mp4')
  let byteLength = 0
  const writer = createWriteStream(filePath, { flags: 'wx' })
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > input.maxBytes) throw outputTooLarge()
      if (!writer.write(Buffer.from(value))) await once(writer, 'drain')
    }
    writer.end()
    await once(writer, 'finish')
    if (byteLength === 0) throw new Error('COMFYUI_OUTPUT_EMPTY')
    return { kind: 'temporary_file', path: filePath, directory, contentType: actualContentType, byteLength }
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      // The primary read/write error remains the authoritative failure.
    } finally {
      writer.destroy()
      await rm(directory, { recursive: true, force: true })
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}
