import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFfmpegCommandRunner, runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { muxVideoMergeFinalAudio } from '@/lib/video-compose/video-merge-audio'

const DURATION_SECONDS = 1.5
const SAMPLE_RATE = 48_000

function pcmSamples(wav: Buffer): Int16Array {
  const dataMarker = wav.indexOf(Buffer.from('data'))
  if (dataMarker < 0) throw new Error('WAV_DATA_CHUNK_MISSING')
  const dataLength = wav.readUInt32LE(dataMarker + 4)
  const dataStart = dataMarker + 8
  return new Int16Array(
    wav.buffer,
    wav.byteOffset + dataStart,
    Math.floor(dataLength / Int16Array.BYTES_PER_ELEMENT),
  )
}

function toneMagnitude(samples: Int16Array, frequency: number): number {
  const start = Math.min(samples.length, Math.floor(SAMPLE_RATE * 0.2))
  const count = Math.min(samples.length - start, SAMPLE_RATE)
  let real = 0
  let imaginary = 0
  for (let index = 0; index < count; index += 1) {
    const sample = samples[start + index] ?? 0
    const angle = (2 * Math.PI * frequency * index) / SAMPLE_RATE
    real += sample * Math.cos(angle)
    imaginary -= sample * Math.sin(angle)
  }
  return Math.hypot(real, imaginary) / Math.max(1, count)
}

async function audioStreamCount(filePath: string): Promise<number> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath,
  ], { stage: 'video_merge_mode_test_probe_audio' })
  return result.stdout.trim() ? result.stdout.trim().split(/\r?\n/u).length : 0
}

async function decodedSamples(workspaceDir: string, inputPath: string, name: string): Promise<Int16Array> {
  const outputPath = path.join(workspaceDir, `${name}.wav`)
  await runFfmpegCommand('ffmpeg', [
    '-y', '-i', inputPath, '-map', '0:a:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', outputPath,
  ], { stage: 'video_merge_mode_test_decode', expectedDurationSeconds: DURATION_SECONDS })
  return pcmSamples(await readFile(outputPath))
}

describe('video merge final audio modes with real FFmpeg media', () => {
  let workspaceDir = ''
  let stitchedPath = ''
  let mainAudioPath = ''
  let assemblyAudioPath = ''

  beforeAll(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-video-merge-mode-'))
    stitchedPath = path.join(workspaceDir, 'stitched.mp4')
    mainAudioPath = path.join(workspaceDir, 'main.wav')
    assemblyAudioPath = path.join(workspaceDir, 'assembly.wav')

    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=30:d=${String(DURATION_SECONDS)}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${String(SAMPLE_RATE)}:duration=${String(DURATION_SECONDS)}`,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', stitchedPath,
    ], { stage: 'video_merge_mode_test_source', expectedDurationSeconds: DURATION_SECONDS })
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${String(SAMPLE_RATE)}:duration=${String(DURATION_SECONDS)}`,
      '-ac', '2', '-c:a', 'pcm_s16le', mainAudioPath,
    ], { stage: 'video_merge_mode_test_main_audio', expectedDurationSeconds: DURATION_SECONDS })
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=${String(SAMPLE_RATE)}:duration=${String(DURATION_SECONDS)}`,
      '-ac', '2', '-c:a', 'pcm_s16le', assemblyAudioPath,
    ], { stage: 'video_merge_mode_test_assembly_audio', expectedDurationSeconds: DURATION_SECONDS })
  })

  afterAll(async () => {
    if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true })
  })

  it.each([
    ['preserve', true, false],
    ['mix', true, true],
    ['replace', false, true],
    ['mute', false, false],
  ] as const)('renders %s with the declared source and assembly audio', async (audioMode, expectSource, expectAssembly) => {
    const outputPath = path.join(workspaceDir, `${audioMode}.mp4`)
    await muxVideoMergeFinalAudio({
      runCommand: createFfmpegCommandRunner({
        stage: `video_merge_mode_test_${audioMode}`,
        expectedDurationSeconds: DURATION_SECONDS,
      }),
      audioMode,
      stitchedPath,
      mainAudioPath,
      hasSourceAudio: true,
      assemblyAudioPath,
      outputPath,
      durationSeconds: DURATION_SECONDS,
    })

    if (audioMode === 'mute') {
      expect(await audioStreamCount(outputPath)).toBe(0)
      return
    }

    expect(await audioStreamCount(outputPath)).toBe(1)
    const samples = await decodedSamples(workspaceDir, outputPath, `${audioMode}-decoded`)
    const sourceMagnitude = toneMagnitude(samples, 440)
    const assemblyMagnitude = toneMagnitude(samples, 880)
    const noiseFloor = Math.max(1, toneMagnitude(samples, 1_700))

    expect(sourceMagnitude > noiseFloor * 8).toBe(expectSource)
    expect(assemblyMagnitude > noiseFloor * 8).toBe(expectAssembly)
  })
})
