import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createFfmpegCommandRunner, probeMediaDurationSeconds, runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { processH3VideoTimeline } from '@/lib/video-compose/h3-duration-trim'
import { extractDecodableVideoFrame } from '@/lib/video-compose/video-frame-extraction'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })))
})

describe('H3 final-duration trim', () => {
  it('re-encodes the H3-grid output to the requested whole-second video and audio duration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-duration-trim-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'grid-duration.mp4')
    const outputPath = path.join(directory, 'requested-duration.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=4.458333',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=4.448',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
    ], { stage: 'h3_duration_trim_test_source', expectedDurationSeconds: 5 })

    await processH3VideoTimeline({
      inputPath: sourcePath,
      outputPath,
      durationSeconds: 4,
      policy: 'trim',
    })

    expect(await probeMediaDurationSeconds(outputPath, 'h3_duration_trim_test_probe')).toBeCloseTo(4, 1)
  })

  it('retimes the full first-last output and preserves both endpoint colors', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-duration-retime-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'anchored.mp4')
    const outputPath = path.join(directory, 'retimed.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x192:r=24:d=0.041667',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x192:r=24:d=4.375',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x192:r=24:d=0.041667',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=5',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
      '-map', '[v]', '-map', '3:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
    ], { stage: 'h3_duration_retime_test_source', expectedDurationSeconds: 4.5 })

    await processH3VideoTimeline({
      inputPath: sourcePath,
      outputPath,
      durationSeconds: 4,
      policy: 'retime',
    })

    const firstPath = path.join(directory, 'first.png')
    const lastPath = path.join(directory, 'last.png')
    const runner = createFfmpegCommandRunner({
      stage: 'h3_duration_retime_test_extract',
      expectedDurationSeconds: 4,
    })
    await extractDecodableVideoFrame({ runCommand: runner, selector: 'first_decodable', sourcePath: outputPath, outputPath: firstPath })
    await extractDecodableVideoFrame({ runCommand: runner, selector: 'last_decodable', sourcePath: outputPath, outputPath: lastPath })
    const first = await sharp(firstPath).raw().toBuffer()
    const last = await sharp(lastPath).raw().toBuffer()
    const videoDuration = await runFfmpegCommand('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', outputPath,
    ], { stage: 'h3_duration_retime_video_stream_probe' })
    expect(await probeMediaDurationSeconds(outputPath, 'h3_duration_retime_test_probe')).toBeCloseTo(4, 1)
    expect(Number.parseFloat(videoDuration.stdout.trim())).toBeCloseTo(4, 1)
    expect(first[0]).toBeGreaterThan(first[2] ?? 0)
    expect(last[2]).toBeGreaterThan(last[0] ?? 0)
  })

  it('drops the 22-frame guide before keeping the requested novel duration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-duration-continuation-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'guided.mp4')
    const outputPath = path.join(directory, 'novel.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x192:r=24:d=0.916667',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x192:r=24:d=4.25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=5.166667',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
    ], { stage: 'h3_duration_continuation_test_source', expectedDurationSeconds: 5.2 })

    await processH3VideoTimeline({
      inputPath: sourcePath,
      outputPath,
      durationSeconds: 4,
      policy: 'drop_guide_then_trim',
    })

    const firstPath = path.join(directory, 'novel-first.png')
    await extractDecodableVideoFrame({
      runCommand: createFfmpegCommandRunner({ stage: 'h3_duration_continuation_test_extract', expectedDurationSeconds: 4 }),
      selector: 'first_decodable',
      sourcePath: outputPath,
      outputPath: firstPath,
    })
    const first = await sharp(firstPath).raw().toBuffer()
    expect(await probeMediaDurationSeconds(outputPath, 'h3_duration_continuation_test_probe')).toBeCloseTo(4, 1)
    expect(first[0]).toBeGreaterThan(first[1] ?? 0)
  })
})
