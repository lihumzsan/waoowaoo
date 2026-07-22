import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { executeAiVisionStep } from '@/lib/ai-runtime/client'
import { CODEX_DEFAULT_MODEL_KEY } from '@/lib/providers/codex/constants'

const MAX_EPISODE_COVER_IMAGE_BYTES = 10 * 1024 * 1024
const ASPECT_RATIO_TOLERANCE = 0.02

const MIME_BY_SHARP_FORMAT: Readonly<Record<string, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const VISION_RESULT_FIELDS = [
  'hasReadableText',
  'hasEpisodeNumber',
  'hasLogo',
  'hasWatermark',
  'isCollage',
  'isSingleContinuousScene',
  'issues',
].sort()

type EpisodeCoverVisionResult = {
  hasReadableText: boolean
  hasEpisodeNumber: boolean
  hasLogo: boolean
  hasWatermark: boolean
  isCollage: boolean
  isSingleContinuousScene: boolean
  issues: string[]
}

export type AuditedEpisodeCoverImage = {
  buffer: Buffer
  metadata: {
    mimeType: string
    sizeBytes: number
    width: number
    height: number
  }
}

function auditError(code: string, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code)
}

function decodeDataUrl(source: string): Buffer {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(source)
  if (!match || !match[2]) {
    throw auditError('EPISODE_COVER_IMAGE_UNREADABLE', 'invalid image data URL')
  }

  const payload = match[2]
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) {
    throw auditError('EPISODE_COVER_IMAGE_UNREADABLE', 'invalid base64 payload')
  }
  return buffer
}

async function decodeImageSource(source: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source
  if (/^https?:\/\//i.test(source)) {
    throw auditError('EPISODE_COVER_IMAGE_REMOTE_SOURCE')
  }
  if (source.startsWith('data:')) return decodeDataUrl(source)

  let filePath = source
  if (source.startsWith('file:')) {
    try {
      filePath = fileURLToPath(source)
    } catch {
      throw auditError('EPISODE_COVER_IMAGE_UNREADABLE', 'invalid file URL')
    }
  }

  try {
    return await readFile(filePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw auditError('EPISODE_COVER_IMAGE_UNREADABLE', message)
  }
}

function parseAspectRatio(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) throw auditError('EPISODE_COVER_IMAGE_ASPECT_RATIO_INVALID')

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw auditError('EPISODE_COVER_IMAGE_ASPECT_RATIO_INVALID')
  }
  return width / height
}

function parseVisionResult(text: string): EpisodeCoverVisionResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw auditError('EPISODE_COVER_IMAGE_VISION_RESPONSE_INVALID', 'response is not JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw auditError('EPISODE_COVER_IMAGE_VISION_RESPONSE_INVALID', 'response is not an object')
  }

  const result = parsed as Record<string, unknown>
  const fields = Object.keys(result).sort()
  if (fields.length !== VISION_RESULT_FIELDS.length
    || fields.some((field, index) => field !== VISION_RESULT_FIELDS[index])) {
    throw auditError('EPISODE_COVER_IMAGE_VISION_RESPONSE_INVALID', 'response fields do not match the contract')
  }

  const booleanFields = VISION_RESULT_FIELDS.filter((field) => field !== 'issues')
  if (booleanFields.some((field) => typeof result[field] !== 'boolean')
    || !Array.isArray(result.issues)
    || result.issues.some((issue) => typeof issue !== 'string')) {
    throw auditError('EPISODE_COVER_IMAGE_VISION_RESPONSE_INVALID', 'response field types do not match the contract')
  }

  return result as EpisodeCoverVisionResult
}

function buildAuditPrompt(): string {
  return [
    'Inspect this Episode cover as a strict publication gate.',
    'Return only JSON with exactly these fields:',
    '{"hasReadableText":false,"hasEpisodeNumber":false,"hasLogo":false,"hasWatermark":false,"isCollage":false,"isSingleContinuousScene":true,"issues":[]}',
    'Mark readable words, titles, captions, Episode numbering, logos, watermarks, borders, collages, split layouts, or discontinuous scenes as issues.',
    'Do not omit fields or add fields.',
  ].join('\n')
}

export async function auditEpisodeCoverImage(params: {
  userId: string
  projectId: string
  imageSource: string | Buffer
  expectedAspectRatio: string
}): Promise<AuditedEpisodeCoverImage> {
  const buffer = await decodeImageSource(params.imageSource)
  if (buffer.byteLength > MAX_EPISODE_COVER_IMAGE_BYTES) {
    throw auditError('EPISODE_COVER_IMAGE_TOO_LARGE')
  }

  let imageMetadata: sharp.Metadata
  try {
    imageMetadata = await sharp(buffer).metadata()
  } catch {
    throw auditError('EPISODE_COVER_IMAGE_DIMENSIONS_MISSING')
  }

  const mimeType = imageMetadata.format ? MIME_BY_SHARP_FORMAT[imageMetadata.format] : undefined
  if (!mimeType) throw auditError('EPISODE_COVER_IMAGE_UNSUPPORTED_FORMAT')

  const width = imageMetadata.width
  const height = imageMetadata.height
  if (!width || !height || width <= 0 || height <= 0) {
    throw auditError('EPISODE_COVER_IMAGE_DIMENSIONS_MISSING')
  }

  const expectedRatio = parseAspectRatio(params.expectedAspectRatio)
  const actualRatio = width / height
  const relativeError = Math.abs(actualRatio - expectedRatio) / expectedRatio
  if (relativeError > ASPECT_RATIO_TOLERANCE) {
    throw auditError('EPISODE_COVER_IMAGE_ASPECT_RATIO_MISMATCH')
  }

  let response: Awaited<ReturnType<typeof executeAiVisionStep>>
  try {
    response = await executeAiVisionStep({
      userId: params.userId,
      projectId: params.projectId,
      model: CODEX_DEFAULT_MODEL_KEY,
      action: 'episode_cover_image_audit',
      prompt: buildAuditPrompt(),
      imageUrls: [`data:${mimeType};base64,${buffer.toString('base64')}`],
      temperature: 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw auditError('EPISODE_COVER_IMAGE_VISION_RUNTIME_FAILED', message)
  }

  const visionResult = parseVisionResult(response.text)
  if (visionResult.hasReadableText
    || visionResult.hasEpisodeNumber
    || visionResult.hasLogo
    || visionResult.hasWatermark
    || visionResult.isCollage
    || !visionResult.isSingleContinuousScene
    || visionResult.issues.length > 0) {
    throw auditError('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED')
  }

  return {
    buffer,
    metadata: {
      mimeType,
      sizeBytes: buffer.byteLength,
      width,
      height,
    },
  }
}
