import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertFileSizeWithinLimit, decodeBase64WithLimit, MAX_AUDIO_BYTES } from '@/lib/http/body-limits'
import { probeMediaDurationSeconds, runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'

const FLAC_DATA_URL_PREFIX = 'data:audio/flac;base64,'
const WORKSPACE_DIRECTORY_PREFIX = 'waoowaoo-comfyui-voice-audio-'

export async function normalizeComfyUiVoiceAudioResult(source: string): Promise<string> {
  if (typeof source !== 'string' || !source.startsWith(FLAC_DATA_URL_PREFIX)) {
    throw new Error('COMFYUI_VOICE_FLAC_DATA_URL_REQUIRED')
  }
  const encoded = source.slice(FLAC_DATA_URL_PREFIX.length)
  if (!encoded || /\s/u.test(encoded)) throw new Error('COMFYUI_VOICE_FLAC_DATA_URL_INVALID')
  const sourceBuffer = decodeBase64WithLimit(encoded, MAX_AUDIO_BYTES, 'ComfyUI voice FLAC result')
  if (sourceBuffer.byteLength < 4 || sourceBuffer.toString('ascii', 0, 4) !== 'fLaC') {
    throw new Error('COMFYUI_VOICE_FLAC_HEADER_INVALID')
  }

  const temporaryRoot = path.resolve(tmpdir())
  const workspaceDirectory = await mkdtemp(path.join(temporaryRoot, WORKSPACE_DIRECTORY_PREFIX))
  try {
    const sourcePath = path.join(workspaceDirectory, 'source.flac')
    const outputPath = path.join(workspaceDirectory, 'voice.wav')
    await writeFile(sourcePath, sourceBuffer, { flag: 'wx' })
    const durationSeconds = await probeMediaDurationSeconds(sourcePath, 'comfyui_voice_flac_probe_duration')
    await runFfmpegCommand('ffmpeg', [
      '-n',
      '-i', sourcePath,
      '-map', '0:a:0',
      '-c:a', 'pcm_s16le',
      outputPath,
    ], {
      stage: 'comfyui_voice_flac_to_wav',
      expectedDurationSeconds: durationSeconds,
    })
    assertFileSizeWithinLimit(await stat(outputPath), MAX_AUDIO_BYTES, 'ComfyUI voice WAV result')
    const outputBuffer = await readFile(outputPath)
    return `data:audio/wav;base64,${outputBuffer.toString('base64')}`
  } finally {
    const resolvedDirectory = path.resolve(workspaceDirectory)
    const directoryName = path.basename(resolvedDirectory)
    if (path.dirname(resolvedDirectory) !== temporaryRoot
      || !directoryName.startsWith(WORKSPACE_DIRECTORY_PREFIX)
      || directoryName.length === WORKSPACE_DIRECTORY_PREFIX.length) {
      throw new Error('COMFYUI_VOICE_AUDIO_WORKSPACE_INVALID')
    }
    await rm(resolvedDirectory, { recursive: true, force: true })
  }
}
