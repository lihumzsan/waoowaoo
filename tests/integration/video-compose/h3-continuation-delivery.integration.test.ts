import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFfmpegCommandRunner,
  probeMediaDurationSeconds,
  runFfmpegCommand,
} from '@/lib/video-compose/ffmpeg-command'
import { removeH3ContinuationGuide } from '@/lib/video-compose/h3-continuation-delivery'
import { extractDecodableVideoFrame } from '@/lib/video-compose/video-frame-extraction'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => (
    await rm(directory, { recursive: true, force: true })
  )))
})

describe('H3 continuation delivery', () => {
  it('removes only the 22-frame guide while preserving the complete novel video and audio tail', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-delivery-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'guided.mp4')
    const outputPath = path.join(directory, 'novel.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x192:r=24:d=0.916667',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x192:r=24:d=4.25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=5.166667',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a:0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
    ], { stage: 'h3_continuation_delivery_test_source', expectedDurationSeconds: 5.2 })

    await removeH3ContinuationGuide({ inputPath: sourcePath, outputPath })

    const firstPath = path.join(directory, 'novel-first.png')
    await extractDecodableVideoFrame({
      runCommand: createFfmpegCommandRunner({
        stage: 'h3_continuation_delivery_test_extract',
        expectedDurationSeconds: 4.3,
      }),
      selector: 'first_decodable',
      sourcePath: outputPath,
      outputPath: firstPath,
    })
    const first = await sharp(firstPath).raw().toBuffer()
    const audioPackets = await runFfmpegCommand('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'packet=pts_time',
      '-of', 'csv=p=0',
      outputPath,
    ], { stage: 'h3_continuation_delivery_audio_packets' })
    const lastAudioPacketSeconds = Math.max(...audioPackets.stdout
      .trim()
      .split('\n')
      .map((value) => Number.parseFloat(value)))

    expect(await probeMediaDurationSeconds(
      outputPath,
      'h3_continuation_delivery_test_probe',
    )).toBeCloseTo(4.25, 1)
    expect(first[0]).toBeGreaterThan(first[1] ?? 0)
    expect(lastAudioPacketSeconds).toBeGreaterThan(4)
  })
})
