import { ApiError } from '@/lib/api-errors'
export * from './body-size-constants'

function payloadTooLarge(label: string, maxBytes: number): ApiError {
  return new ApiError('INVALID_PARAMS', {
    code: 'PAYLOAD_TOO_LARGE',
    field: 'body',
    message: `${label} exceeds the ${maxBytes} byte limit`,
  })
}

function assertDeclaredLengthWithinLimit(
  headers: Headers,
  maxBytes: number,
  label: string,
): void {
  const value = headers.get('content-length')
  if (!value) return
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CONTENT_LENGTH_INVALID',
      field: 'content-length',
      message: 'content-length must be a non-negative integer',
    })
  }
  if (length > maxBytes) throw payloadTooLarge(label, maxBytes)
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0)
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel('payload limit exceeded')
        throw payloadTooLarge(label, maxBytes)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes)
}

export async function readRequestBufferWithLimit(
  request: Request,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  assertDeclaredLengthWithinLimit(request.headers, maxBytes, label)
  return await readStreamWithLimit(request.body, maxBytes, label)
}

export async function readFormDataWithLimit(
  request: Request,
  maxBytes: number,
  label: string,
): Promise<FormData> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FORMDATA_CONTENT_TYPE_INVALID',
      field: 'content-type',
      message: 'request must use multipart/form-data with a boundary',
    })
  }

  const body = await readRequestBufferWithLimit(request, maxBytes, label)
  try {
    return await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(body).buffer,
    }).formData()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('INVALID_PARAMS', {
      code: 'FORMDATA_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid multipart/form-data',
    }, { cause: error })
  }
}

export async function readJsonWithLimit(
  request: Request,
  maxBytes: number,
  label: string,
): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() || ''
  if (!contentType.startsWith('application/json')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'JSON_CONTENT_TYPE_INVALID',
      field: 'content-type',
      message: 'request must use application/json',
    })
  }
  const body = await readRequestBufferWithLimit(request, maxBytes, label)
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'JSON_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }
}

export function assertFileSizeWithinLimit(
  file: { readonly size: number },
  maxBytes: number,
  label: string,
): void {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'UPLOAD_FILE_EMPTY',
      field: 'file',
      message: `${label} must not be empty`,
    })
  }
  if (file.size > maxBytes) throw payloadTooLarge(label, maxBytes)
}

export function decodeBase64WithLimit(
  value: string,
  maxBytes: number,
  label: string,
): Buffer {
  const normalized = value.trim().replace(/\s+/g, '')
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BASE64_INVALID',
      field: 'body',
      message: `${label} is not valid base64`,
    })
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor(normalized.length * 3 / 4) - padding
  if (decodedBytes > maxBytes) throw payloadTooLarge(label, maxBytes)
  const buffer = Buffer.from(normalized, 'base64')
  if (buffer.byteLength !== decodedBytes) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BASE64_INVALID',
      field: 'body',
      message: `${label} is not valid base64`,
    })
  }
  return buffer
}

export async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  assertDeclaredLengthWithinLimit(response.headers, maxBytes, label)
  return await readStreamWithLimit(response.body, maxBytes, label)
}
