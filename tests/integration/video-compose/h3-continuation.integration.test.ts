import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { extractH3ContinuationGuide } from '@/lib/video-compose/h3-continuation'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => (
    await rm(directory, { recursive: true, force: true })
  )))
})

describe('H3 continuation guide extraction', () => {
  it('returns the final 22 ordered 24fps frames on the exact target canvas', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.mp4')
    const guideDirectory = path.join(directory, 'guide')
    await runFfmpegCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x96:r=30:d=0.5',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x96:r=30:d=0.7',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'h3_continuation_test_source', expectedDurationSeconds: 1.2 })

    const frames = await extractH3ContinuationGuide({
      inputPath: sourcePath,
      workspaceDir: guideDirectory,
      width: 320,
      height: 192,
    })

    expect(frames).toHaveLength(22)
    expect(frames.map((frame) => path.basename(frame))).toEqual(
      Array.from({ length: 22 }, (_, index) => `continuation-${String(index).padStart(2, '0')}.png`),
    )
    const first = await sharp(frames[0]).raw().toBuffer({ resolveWithObject: true })
    const last = await sharp(frames.at(-1)).raw().toBuffer({ resolveWithObject: true })
    expect(first.info).toMatchObject({ width: 320, height: 192 })
    expect(last.info).toMatchObject({ width: 320, height: 192 })
    expect(first.data[0]).toBeGreaterThan(first.data[2] ?? 0)
    expect(last.data[2]).toBeGreaterThan(last.data[0] ?? 0)
  })

  it('rejects a source whose aspect ratio differs from the continuation canvas', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-ratio-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=24:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'h3_continuation_ratio_test_source', expectedDurationSeconds: 1 })

    await expect(extractH3ContinuationGuide({
      inputPath: sourcePath,
      workspaceDir: path.join(directory, 'guide'),
      width: 320,
      height: 192,
    })).rejects.toThrow('H3_CONTINUATION_SOURCE_DIMENSIONS_MISMATCH')
  })

  it('rejects a source shorter than 22 frames at 24fps', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-short-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x96:r=24:d=0.5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'h3_continuation_short_test_source', expectedDurationSeconds: 0.5 })

    await expect(extractH3ContinuationGuide({
      inputPath: sourcePath,
      workspaceDir: path.join(directory, 'guide'),
      width: 320,
      height: 192,
    })).rejects.toThrow('H3_CONTINUATION_SOURCE_TOO_SHORT')
  })

  it('rejects a source longer than one legal H3 segment before expanding frames', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-long-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.mp4')
    const guideDirectory = path.join(directory, 'guide')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x96:r=24:d=14',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'h3_continuation_long_test_source', expectedDurationSeconds: 14 })

    await expect(extractH3ContinuationGuide({
      inputPath: sourcePath,
      workspaceDir: guideDirectory,
      width: 320,
      height: 192,
    })).rejects.toThrow('H3_CONTINUATION_SOURCE_TOO_LONG')
    expect(await readdir(guideDirectory)).toEqual([])
  })

  it('decodes a constant-size tail window for a legal H3 segment', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-bounded-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.mp4')
    const guideDirectory = path.join(directory, 'guide')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=24:d=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'h3_continuation_bounded_test_source', expectedDurationSeconds: 4 })

    const frames = await extractH3ContinuationGuide({
      inputPath: sourcePath,
      workspaceDir: guideDirectory,
      width: 320,
      height: 192,
    })
    const decodedFrames = (await readdir(guideDirectory)).filter((filename) => (
      /^decoded-\d{6}\.png$/u.test(filename)
    ))

    expect(frames).toHaveLength(22)
    expect(decodedFrames.length).toBeLessThanOrEqual(46)
  })

  it.each([
    { name: 'landscape', sourceWidth: 480, sourceHeight: 288, width: 320, height: 192 },
    { name: 'portrait', sourceWidth: 288, sourceHeight: 480, width: 192, height: 320 },
  ])('preserves all four corners during an exact-ratio $name normalization', async ({
    sourceWidth,
    sourceHeight,
    width,
    height,
  }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-continuation-corners-'))
    temporaryDirectories.push(directory)
    const chartPath = path.join(directory, 'chart.png')
    const sourcePath = path.join(directory, 'source.mp4')
    const cornerSize = 48
    const chart = `<svg width="${String(sourceWidth)}" height="${String(sourceHeight)}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="black"/>
      <rect x="0" y="0" width="${String(cornerSize)}" height="${String(cornerSize)}" fill="red"/>
      <rect x="${String(sourceWidth - cornerSize)}" y="0" width="${String(cornerSize)}" height="${String(cornerSize)}" fill="lime"/>
      <rect x="0" y="${String(sourceHeight - cornerSize)}" width="${String(cornerSize)}" height="${String(cornerSize)}" fill="blue"/>
      <rect x="${String(sourceWidth - cornerSize)}" y="${String(sourceHeight - cornerSize)}" width="${String(cornerSize)}" height="${String(cornerSize)}" fill="yellow"/>
    </svg>`
    await sharp(Buffer.from(chart)).png().toFile(chartPath)
    await runFfmpegCommand('ffmpeg', [
      '-y', '-loop', '1', '-i', chartPath, '-t', '1', '-r', '24',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'h3_continuation_corner_test_source', expectedDurationSeconds: 1 })

    const frames = await extractH3ContinuationGuide({
      inputPath: sourcePath,
      workspaceDir: path.join(directory, 'guide'),
      width,
      height,
    })
    const decoded = await sharp(frames.at(-1)).raw().toBuffer({ resolveWithObject: true })
    const readRgb = (x: number, y: number): readonly [number, number, number] => {
      const offset = (y * decoded.info.width + x) * decoded.info.channels
      return [decoded.data[offset]!, decoded.data[offset + 1]!, decoded.data[offset + 2]!]
    }
    const topLeft = readRgb(5, 5)
    const topRight = readRgb(width - 6, 5)
    const bottomLeft = readRgb(5, height - 6)
    const bottomRight = readRgb(width - 6, height - 6)

    expect(topLeft[0]).toBeGreaterThan(topLeft[1] + 80)
    expect(topLeft[0]).toBeGreaterThan(topLeft[2] + 80)
    expect(topRight[1]).toBeGreaterThan(topRight[0] + 80)
    expect(topRight[1]).toBeGreaterThan(topRight[2] + 80)
    expect(bottomLeft[2]).toBeGreaterThan(bottomLeft[0] + 80)
    expect(bottomLeft[2]).toBeGreaterThan(bottomLeft[1] + 80)
    expect(bottomRight[0]).toBeGreaterThan(bottomRight[2] + 80)
    expect(bottomRight[1]).toBeGreaterThan(bottomRight[2] + 80)
  })
})
