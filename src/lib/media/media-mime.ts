import path from 'node:path'

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

function pathnameFromMediaInput(input: string): string {
  try {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return new URL(input).pathname
    }
    if (input.startsWith('/')) {
      return new URL(input, 'http://localhost').pathname
    }
  } catch {
    return input
  }
  return input
}

export function detectMimeFromBuffer(buffer: Uint8Array): string | null {
  if (buffer.length >= 8) {
    const isPng =
      buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4e
      && buffer[3] === 0x47
      && buffer[4] === 0x0d
      && buffer[5] === 0x0a
      && buffer[6] === 0x1a
      && buffer[7] === 0x0a
    if (isPng) return 'image/png'
  }

  if (buffer.length >= 3) {
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (isJpeg) return 'image/jpeg'
  }

  if (buffer.length >= 6) {
    const isGif87a =
      buffer[0] === 0x47
      && buffer[1] === 0x49
      && buffer[2] === 0x46
      && buffer[3] === 0x38
      && buffer[4] === 0x37
      && buffer[5] === 0x61
    const isGif89a =
      buffer[0] === 0x47
      && buffer[1] === 0x49
      && buffer[2] === 0x46
      && buffer[3] === 0x38
      && buffer[4] === 0x39
      && buffer[5] === 0x61
    if (isGif87a || isGif89a) return 'image/gif'
  }

  if (buffer.length >= 12) {
    const isWebp =
      buffer[0] === 0x52
      && buffer[1] === 0x49
      && buffer[2] === 0x46
      && buffer[3] === 0x46
      && buffer[8] === 0x57
      && buffer[9] === 0x45
      && buffer[10] === 0x42
      && buffer[11] === 0x50
    if (isWebp) return 'image/webp'
  }

  if (buffer.length >= 12) {
    const isWav =
      buffer[0] === 0x52
      && buffer[1] === 0x49
      && buffer[2] === 0x46
      && buffer[3] === 0x46
      && buffer[8] === 0x57
      && buffer[9] === 0x41
      && buffer[10] === 0x56
      && buffer[11] === 0x45
    if (isWav) return 'audio/wav'
  }

  if (buffer.length >= 4) {
    const isOgg =
      buffer[0] === 0x4f
      && buffer[1] === 0x67
      && buffer[2] === 0x67
      && buffer[3] === 0x53
    if (isOgg) return 'audio/ogg'
  }

  if (buffer.length >= 3) {
    const isMp3WithId3 =
      buffer[0] === 0x49
      && buffer[1] === 0x44
      && buffer[2] === 0x33
    const isMp3FrameSync =
      buffer[0] === 0xff
      && (buffer[1] & 0xe0) === 0xe0
    if (isMp3WithId3 || isMp3FrameSync) return 'audio/mpeg'
  }

  if (buffer.length >= 12) {
    const isWebm =
      buffer[0] === 0x1a
      && buffer[1] === 0x45
      && buffer[2] === 0xdf
      && buffer[3] === 0xa3
    if (isWebm) return 'video/webm'
  }

  if (buffer.length >= 8) {
    const isMp4 =
      buffer[4] === 0x66
      && buffer[5] === 0x74
      && buffer[6] === 0x79
      && buffer[7] === 0x70
    if (isMp4) return 'video/mp4'
  }

  return null
}

export function resolveMediaMimeType(
  input: string,
  declaredContentType: string | null,
  buffer: Uint8Array,
): string {
  const headerType = declaredContentType?.split(';')[0]?.trim().toLowerCase()
  if (headerType && headerType !== DEFAULT_CONTENT_TYPE) return headerType
  const sniffedType = detectMimeFromBuffer(buffer)
  if (sniffedType) return sniffedType
  const ext = path.extname(pathnameFromMediaInput(input)).toLowerCase()
  return MIME_BY_EXT[ext] || DEFAULT_CONTENT_TYPE
}
