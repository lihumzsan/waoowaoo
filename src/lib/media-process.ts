import { downloadAndUploadImage, downloadAndUploadVideo, generateUniqueKey, toFetchableUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { decodeBase64WithLimit, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'

export interface ProcessMediaOptions {
  source: string | Buffer
  type: 'image' | 'video' | 'audio'
  keyPrefix: string
  targetId: string
  downloadHeaders?: Record<string, string>
  taskArtifact?: { taskId: string; artifact: string }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}

function resolveContentType(ext: string): string {
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

/**
 * 处理媒体结果：下载并写入统一对象存储，返回 canonical storage key。
 */
export async function processMediaResult(options: ProcessMediaOptions): Promise<string> {
  const { source, type, keyPrefix, targetId, downloadHeaders } = options
  const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'
  const key = options.taskArtifact
    ? buildTaskArtifactStorageKey({ ...options.taskArtifact, extension: ext })
    : generateUniqueKey(`${keyPrefix}-${targetId}`, ext)
  const contentType = resolveContentType(ext)

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const base64Start = source.indexOf(';base64,')
      if (base64Start === -1) throw new Error('无法解析 data: URL')
      const base64Data = source.substring(base64Start + 8)
      const maxBytes = type === 'image' ? MAX_IMAGE_BYTES : type === 'audio' ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES
      const buffer = decodeBase64WithLimit(base64Data, maxBytes, `${type} result`)
      return await uploadObject(buffer, key, undefined, contentType)
    }

    if (type === 'image') {
      // Normalize to JPEG and fail fast on non-2xx downloads to avoid storing broken images.
      return await downloadAndUploadImage(source, key, 3)
    }

    if (type === 'video') {
      return await downloadAndUploadVideo(source, key, 3, downloadHeaders)
    }

    const response = await fetch(toFetchableUrl(source), {
      headers: downloadHeaders,
    })
    if (!response.ok) {
      throw new Error(`Failed to download ${type}: ${response.status} ${response.statusText}`)
    }
    const buffer = await readResponseBufferWithLimit(response, MAX_AUDIO_BYTES, 'audio result')
    return await uploadObject(buffer, key, undefined, contentType)
  }

  return await uploadObject(source, key, undefined, contentType)
}
