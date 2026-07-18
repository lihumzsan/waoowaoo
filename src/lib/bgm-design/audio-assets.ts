import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { toFetchableUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { buildFfmpegExecFileOptions, resolveFfmpegBinary } from '@/lib/video-compose/ffmpeg-binaries'
import { decodeBase64WithLimit, MAX_AUDIO_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'

export type GeneratedAudioBuffer = { readonly buffer: Buffer; readonly mimeType: string }
const execFileAsync = promisify(execFile)

export function extensionFromAudioMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}

function decodeAudioDataUrl(dataUrl: string): GeneratedAudioBuffer | null {
  const match = /^data:(audio\/[^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match?.[1] || !match[2]) return null
  return { mimeType: match[1], buffer: decodeBase64WithLimit(match[2], MAX_AUDIO_BYTES, 'generated audio') }
}

export async function loadGeneratedAudioBuffer(input: {
  readonly audioBase64?: string
  readonly audioUrl?: string
  readonly mimeType?: string
}): Promise<GeneratedAudioBuffer> {
  const mimeType = input.mimeType?.trim() || 'audio/mpeg'
  if (input.audioBase64) return { buffer: decodeBase64WithLimit(input.audioBase64, MAX_AUDIO_BYTES, 'generated audio'), mimeType }
  const audioUrl = input.audioUrl?.trim() || ''
  if (!audioUrl) throw new Error('AUDIO_GENERATION_EMPTY_RESULT')
  const decoded = decodeAudioDataUrl(audioUrl)
  if (decoded) return decoded
  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) throw new Error(`AUDIO_GENERATION_DOWNLOAD_FAILED:${response.status}`)
  return { buffer: await readResponseBufferWithLimit(response, MAX_AUDIO_BYTES, 'generated audio'), mimeType: response.headers.get('content-type') || mimeType }
}

export async function uploadTaskAudioArtifact(input: {
  readonly audio: GeneratedAudioBuffer
  readonly durationSeconds: number
  readonly taskId: string
  readonly artifact: string
}): Promise<{ readonly mediaId: string; readonly url: string; readonly storageKey: string; readonly mimeType: string; readonly durationMs: number }> {
  const storageKey = await uploadObject(
    input.audio.buffer,
    buildTaskArtifactStorageKey({ taskId: input.taskId, artifact: input.artifact, extension: extensionFromAudioMimeType(input.audio.mimeType) }),
    1,
    input.audio.mimeType,
  )
  const durationMs = Math.round(input.durationSeconds * 1000)
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: input.audio.mimeType,
    sizeBytes: input.audio.buffer.byteLength,
    durationMs,
  })
  return { mediaId: media.id, url: media.url, storageKey, mimeType: input.audio.mimeType, durationMs }
}

export async function decodeMonoFloat32(input: {
  readonly workspaceDir: string
  readonly fileName: string
  readonly audio: GeneratedAudioBuffer
}): Promise<Float32Array> {
  const sourcePath = path.join(input.workspaceDir, `${input.fileName}.${extensionFromAudioMimeType(input.audio.mimeType)}`)
  const pcmPath = path.join(input.workspaceDir, `${input.fileName}.f32le`)
  await writeFile(sourcePath, input.audio.buffer)
  const execution = resolveFfmpegBinary('ffmpeg')
  await execFileAsync(
    execution.command,
    ['-y', '-v', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcmPath],
    buildFfmpegExecFileOptions(execution),
  )
  const pcm = await readFile(pcmPath)
  if (pcm.byteLength % 4 !== 0) throw new Error('AUDIO_PCM_ALIGNMENT_INVALID')
  const samples = new Float32Array(pcm.byteLength / 4)
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readFloatLE(index * 4)
  return samples
}
