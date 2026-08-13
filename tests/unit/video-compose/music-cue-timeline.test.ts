import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFfmpegCommandRunner,
  probeMediaDurationSeconds,
  runFfmpegCommand,
} from '@/lib/video-compose/ffmpeg-command'
import { muxVideoMergeMusicCues } from '@/lib/video-compose/video-merge-audio'

const SAMPLE_RATE = 48_000
const temporaryDirectories: string[] = []

function windowRms(pcm: Buffer, startSeconds: number, endSeconds: number): number {
  const startSample = Math.floor(startSeconds * SAMPLE_RATE)
  const endSample = Math.floor(endSeconds * SAMPLE_RATE)
  let squareSum = 0
  for (let sample = startSample; sample < endSample; sample += 1) {
    const value = pcm.readInt16LE(sample * 2)
    squareSum += value * value
  }
  return Math.sqrt(squareSum / (endSample - startSample))
}

describe('video score cue timeline', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }))
  })

  it('places independent cues at their exact windows and leaves gaps silent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-score-cues-'))
    temporaryDirectories.push(directory)
    const stitchedPath = path.join(directory, 'video.mp4')
    const mainAudioPath = path.join(directory, 'main.wav')
    const firstCuePath = path.join(directory, 'first.wav')
    const secondCuePath = path.join(directory, 'second.wav')
    const outputPath = path.join(directory, 'output.mp4')
    const pcmPath = path.join(directory, 'output.pcm')
    const runCommand = createFfmpegCommandRunner({
      stage: 'score_cue_timeline_test',
      expectedDurationSeconds: 6,
    })

    await runCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=6',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', stitchedPath,
    ])
    await runCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', '6', '-c:a', 'pcm_s16le', mainAudioPath,
    ])
    await Promise.all([
      runCommand('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
        '-ac', '2', '-c:a', 'pcm_s16le', firstCuePath,
      ]),
      runCommand('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1',
        '-ac', '2', '-c:a', 'pcm_s16le', secondCuePath,
      ]),
    ])

    await muxVideoMergeMusicCues({
      runCommand,
      stitchedPath,
      mainAudioPath,
      hasSourceAudio: false,
      musicCues: [
        {
          musicPath: firstCuePath,
          startMs: 1_000,
          durationMs: 1_000,
          fadeInMs: 0,
          fadeOutMs: 0,
          gainDb: 0,
        },
        {
          musicPath: secondCuePath,
          startMs: 4_000,
          durationMs: 1_000,
          fadeInMs: 0,
          fadeOutMs: 0,
          gainDb: 0,
        },
      ],
      outputPath,
      durationSeconds: 6,
    })

    await runFfmpegCommand('ffmpeg', [
      '-y', '-i', outputPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 's16le', pcmPath,
    ], {
      stage: 'score_cue_timeline_pcm',
      expectedDurationSeconds: 6,
    })
    const pcm = await readFile(pcmPath)

    expect(await probeMediaDurationSeconds(outputPath, 'score_cue_timeline_duration'))
      .toBeCloseTo(6, 1)
    const windowEnergy = [
      windowRms(pcm, 0.2, 0.8),
      windowRms(pcm, 1.2, 1.8),
      windowRms(pcm, 2.2, 3.8),
      windowRms(pcm, 4.2, 4.8),
      windowRms(pcm, 5.2, 5.8),
    ]
    expect(windowEnergy[0]).toBeLessThan(100)
    expect(windowEnergy[1]).toBeGreaterThan(1_000)
    expect(windowEnergy[2]).toBeLessThan(100)
    expect(windowEnergy[3]).toBeGreaterThan(1_000)
    expect(windowEnergy[4]).toBeLessThan(100)
  })
})
