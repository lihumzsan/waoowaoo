import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { CODEX_DEFAULT_MODEL_KEY } from '@/lib/providers/codex/constants'

const executeAiVisionStepMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())
const statMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  readFileMock.mockImplementation(actual.readFile)
  statMock.mockImplementation(actual.stat)
  return {
    ...actual,
    readFile: readFileMock,
    stat: statMock,
  }
})

vi.mock('@/lib/ai-runtime/client', () => ({
  executeAiVisionStep: executeAiVisionStepMock,
}))

import { auditEpisodeCoverImage } from '@/lib/novel-promotion/episode-cover/audit'

const CLEAN_AUDIT = {
  hasReadableText: false,
  hasEpisodeNumber: false,
  hasLogo: false,
  hasWatermark: false,
  isCollage: false,
  isSingleContinuousScene: true,
  issues: [],
}

function visionResponse(result: Record<string, unknown> = CLEAN_AUDIT) {
  return {
    text: JSON.stringify(result),
    reasoning: '',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    completion: {},
  }
}

async function imageBuffer(width = 1600, height = 900) {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 24, g: 48, b: 72 },
    },
  }).png().toBuffer()
}

async function truncatedImageBuffer(format: 'png' | 'jpeg') {
  const image = sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: { r: 24, g: 48, b: 72 },
    },
  })
  const source = format === 'png'
    ? await image.png().toBuffer()
    : await image.jpeg().toBuffer()
  return source.subarray(0, Math.floor(source.byteLength / 2))
}

async function corruptSecondFrameWebp() {
  const frame = async (background: { r: number; g: number; b: number }) => (
    await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background,
      },
    }).png().toBuffer()
  )
  const source = await sharp(
    [
      await frame({ r: 24, g: 48, b: 72 }),
      await frame({ r: 200, g: 100, b: 50 }),
    ],
    { join: { animated: true } },
  ).webp({ loop: 0, delay: [100, 100] }).toBuffer()
  const corrupt = Buffer.from(source)

  let offset = 12
  let frameCount = 0
  while (offset + 8 <= corrupt.byteLength) {
    const chunkType = corrupt.toString('ascii', offset, offset + 4)
    const chunkSize = corrupt.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize
    if (chunkEnd > corrupt.byteLength) break

    if (chunkType === 'ANMF' && ++frameCount === 2) {
      corrupt.fill(0, Math.min(chunkStart + 64, chunkEnd), chunkEnd)
      return corrupt
    }
    offset = chunkEnd + (chunkSize % 2)
  }

  throw new Error('Expected a second animated WebP frame')
}

async function audit(imageSource: string | Buffer, expectedAspectRatio = '16:9') {
  return await auditEpisodeCoverImage({
    userId: 'user-1',
    projectId: 'project-1',
    imageSource,
    expectedAspectRatio,
  })
}

describe('episode cover image audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeAiVisionStepMock.mockResolvedValue(visionResponse())
  })

  it('decodes a local Codex image once and returns the exact audited bytes and metadata', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'episode-cover-audit-'))
    const filePath = path.join(directory, 'cover.png')
    const source = await imageBuffer()
    await writeFile(filePath, source)

    try {
      const result = await audit(filePath)

      expect(result.buffer.equals(source)).toBe(true)
      expect(result.metadata).toEqual({
        mimeType: 'image/png',
        sizeBytes: source.byteLength,
        width: 1600,
        height: 900,
      })
      expect(executeAiVisionStepMock).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        model: CODEX_DEFAULT_MODEL_KEY,
        action: 'episode_cover_image_audit',
        imageUrls: [`data:image/png;base64,${source.toString('base64')}`],
        temperature: 0,
      }))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['png', 'jpeg'] as const)(
    'rejects a truncated %s whose header metadata remains readable before vision inspection',
    async (format) => {
      const truncated = await truncatedImageBuffer(format)

      await expect(sharp(truncated).metadata()).resolves.toMatchObject({
        format,
        width: 1600,
        height: 900,
      })
      await expect(audit(truncated)).rejects.toMatchObject({
        code: 'GENERATION_FAILED',
        details: { auditCode: 'EPISODE_COVER_IMAGE_DECODE_FAILED' },
      })
      expect(executeAiVisionStepMock).not.toHaveBeenCalled()
    },
  )

  it('rejects a WebP with a corrupt later frame before vision inspection', async () => {
    const corrupt = await corruptSecondFrameWebp()

    await expect(sharp(corrupt).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 1600,
      height: 900,
      pages: 2,
    })
    await expect(sharp(corrupt, { failOn: 'warning' }).stats()).resolves.toBeDefined()
    await expect(
      sharp(corrupt, { failOn: 'warning', animated: true }).stats(),
    ).rejects.toThrow()
    await expect(audit(corrupt)).rejects.toMatchObject({
      code: 'GENERATION_FAILED',
      details: { auditCode: 'EPISODE_COVER_IMAGE_MULTIPAGE_UNSUPPORTED' },
    })
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('accepts a valid image data URL', async () => {
    const source = await imageBuffer(900, 1600)

    const result = await audit(`data:image/png;base64,${source.toString('base64')}`, '9:16')

    expect(result.buffer.equals(source)).toBe(true)
    expect(result.metadata).toMatchObject({
      mimeType: 'image/png',
      width: 900,
      height: 1600,
    })
  })

  it('rejects an unreadable local path before vision inspection', async () => {
    await expect(audit('/definitely/missing/episode-cover.png')).rejects.toThrow('EPISODE_COVER_IMAGE_UNREADABLE')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('classifies an empty Buffer as a retryable unreadable image before vision inspection', async () => {
    const error = await audit(Buffer.alloc(0)).catch((caught) => caught)
    const normalized = normalizeAnyError(error, { context: 'worker' })

    expect(error).toMatchObject({
      code: 'GENERATION_FAILED',
      details: { auditCode: 'EPISODE_COVER_IMAGE_UNREADABLE' },
    })
    expect(normalized).toMatchObject({
      code: 'GENERATION_FAILED',
      retryable: true,
    })
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('rejects an empty local file from stat before reading its bytes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'episode-cover-audit-'))
    const filePath = path.join(directory, 'empty.png')
    await writeFile(filePath, Buffer.alloc(0))
    readFileMock.mockClear()
    statMock.mockClear()

    try {
      await expect(audit(filePath)).rejects.toMatchObject({
        code: 'GENERATION_FAILED',
        details: { auditCode: 'EPISODE_COVER_IMAGE_UNREADABLE' },
      })
      expect(statMock).toHaveBeenCalledWith(filePath)
      expect(readFileMock).not.toHaveBeenCalled()
      expect(executeAiVisionStepMock).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects remote HTTP sources instead of downloading them', async () => {
    await expect(audit('https://example.test/cover.png')).rejects.toThrow('EPISODE_COVER_IMAGE_REMOTE_SOURCE')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported raster formats', async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: { r: 24, g: 48, b: 72 },
      },
    }).gif().toBuffer()

    await expect(audit(source)).rejects.toThrow('EPISODE_COVER_IMAGE_UNSUPPORTED_FORMAT')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('rejects payloads larger than the existing 10 MiB image publication limit', async () => {
    const oversized = Buffer.alloc((10 * 1024 * 1024) + 1)

    await expect(audit(oversized)).rejects.toThrow('EPISODE_COVER_IMAGE_TOO_LARGE')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized local file from stat before reading its bytes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'episode-cover-audit-'))
    const filePath = path.join(directory, 'oversized.png')
    await writeFile(filePath, Buffer.alloc((10 * 1024 * 1024) + 1))
    readFileMock.mockClear()
    statMock.mockClear()

    try {
      await expect(audit(filePath)).rejects.toThrow('EPISODE_COVER_IMAGE_TOO_LARGE')
      expect(statMock).toHaveBeenCalledWith(filePath)
      expect(readFileMock).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a clearly oversized data URL before base64 decoding', async () => {
    const payload = 'A'.repeat(Math.ceil(((10 * 1024 * 1024) + 1) / 3) * 4)
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    try {
      await expect(audit(`data:image/png;base64,${payload}`)).rejects.toThrow('EPISODE_COVER_IMAGE_TOO_LARGE')
      expect(bufferFromSpy).not.toHaveBeenCalledWith(payload, 'base64')
    } finally {
      bufferFromSpy.mockRestore()
    }
  })

  it('rechecks decoded size when redundant padding hides a 10 MiB plus one PNG payload', async () => {
    const png = await imageBuffer()
    const oversized = Buffer.concat([
      png,
      Buffer.alloc(((10 * 1024 * 1024) + 1) - png.byteLength),
    ])
    expect(oversized.byteLength).toBe((10 * 1024 * 1024) + 1)
    const canonicalPayload = oversized.toString('base64')
    expect(canonicalPayload.endsWith('=')).toBe(true)
    const redundantlyPaddedPayload = `${canonicalPayload}=`

    await expect(
      audit(`data:image/png;base64,${redundantlyPaddedPayload}`),
    ).rejects.toThrow('EPISODE_COVER_IMAGE_TOO_LARGE')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('rejects images without readable dimensions', async () => {
    await expect(audit(Buffer.from('not an image'))).rejects.toThrow('EPISODE_COVER_IMAGE_DIMENSIONS_MISSING')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('rejects aspect-ratio deviation greater than two percent', async () => {
    const source = await imageBuffer(1000, 500)

    await expect(audit(source)).rejects.toThrow('EPISODE_COVER_IMAGE_ASPECT_RATIO_MISMATCH')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('uses display dimensions for a JPEG rotated by EXIF orientation 6', async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: { r: 24, g: 48, b: 72 },
      },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer()

    const result = await audit(source, '9:16')

    expect(result.buffer).toBe(source)
    expect(result.metadata).toMatchObject({
      mimeType: 'image/jpeg',
      sizeBytes: source.byteLength,
      width: 900,
      height: 1600,
    })
  })

  it('rejects the encoded dimensions when EXIF orientation 8 rotates the displayed JPEG', async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: { r: 24, g: 48, b: 72 },
      },
    }).withMetadata({ orientation: 8 }).jpeg().toBuffer()

    await expect(audit(source, '16:9')).rejects.toThrow('EPISODE_COVER_IMAGE_ASPECT_RATIO_MISMATCH')
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it.each([
    ['readable text', { hasReadableText: true }],
    ['an Episode number', { hasEpisodeNumber: true }],
    ['a logo', { hasLogo: true }],
    ['a watermark', { hasWatermark: true }],
    ['a collage', { isCollage: true }],
    ['multiple discontinuous scenes', { isSingleContinuousScene: false }],
  ])('rejects a cover containing %s', async (_label, override) => {
    executeAiVisionStepMock.mockResolvedValue(visionResponse({ ...CLEAN_AUDIT, ...override }))

    await expect(audit(await imageBuffer())).rejects.toThrow('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED')
  })

  it('rejects a clean-looking response with reported issues', async () => {
    executeAiVisionStepMock.mockResolvedValue(visionResponse({
      ...CLEAN_AUDIT,
      issues: ['border detected'],
    }))

    await expect(audit(await imageBuffer())).rejects.toThrow('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED')
  })

  it.each([
    ['invalid JSON', 'not-json'],
    ['missing fields', JSON.stringify({ hasReadableText: false })],
    ['unknown fields', JSON.stringify({ ...CLEAN_AUDIT, confidence: 1 })],
  ])('fails closed on %s from vision', async (_label, text) => {
    executeAiVisionStepMock.mockResolvedValue({ ...visionResponse(), text })

    await expect(audit(await imageBuffer())).rejects.toThrow('EPISODE_COVER_IMAGE_VISION_RESPONSE_INVALID')
  })

  it('fails closed when the vision runtime throws', async () => {
    executeAiVisionStepMock.mockRejectedValue(new Error('vision unavailable'))

    await expect(audit(await imageBuffer())).rejects.toThrow('EPISODE_COVER_IMAGE_VISION_RUNTIME_FAILED')
  })

  it('uses the existing retryable generation error contract for an audit rejection', async () => {
    executeAiVisionStepMock.mockResolvedValue(visionResponse({
      ...CLEAN_AUDIT,
      hasWatermark: true,
    }))

    const error = await audit(await imageBuffer()).catch((caught) => caught)
    const normalized = normalizeAnyError(error, { context: 'worker' })

    expect(error).toMatchObject({
      code: 'GENERATION_FAILED',
      details: { auditCode: 'EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED' },
    })
    expect(normalized).toMatchObject({
      code: 'GENERATION_FAILED',
      retryable: true,
    })
  })
})
