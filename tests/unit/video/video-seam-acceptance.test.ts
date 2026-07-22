import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertVideoSeamSsimThresholds,
  parseFfmpegSsimStats,
  verifyVideoSeamAcceptance,
} from '@/lib/video/video-seam-acceptance'

describe('video seam real-media acceptance', () => {
  it('parses FFmpeg per-frame All SSIM values', () => {
    const raw = [
      'n:1 Y:0.999 U:0.999 V:0.999 All:0.999100 (40.45)',
      'n:2 Y:0.995 U:0.996 V:0.997 All:0.995500 (23.47)',
    ].join('\n')
    expect(parseFfmpegSsimStats(raw)).toEqual([0.9991, 0.9955])
  })

  it('rejects missing and non-finite FFmpeg SSIM values', () => {
    expect(() => parseFfmpegSsimStats('no frame stats'))
      .toThrow('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
    expect(() => parseFfmpegSsimStats('n:1 All:nan'))
      .toThrow('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
  })

  it('accepts anchors at 0.99 and fewer than six static pairs', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [0.99, 0.995, 0.999, 1],
      adjacentBridgeScores: [0.999, 0.999, 0.999, 0.999, 0.999, 0.997],
    })).not.toThrow()
  })

  it('rejects a weak anchor and six nearly identical consecutive pairs', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [0.9899, 1, 1, 1], adjacentBridgeScores: [],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1, 1],
      adjacentBridgeScores: [0.999, 0.999, 0.999, 0.999, 0.999, 0.999],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_STATIC_HOLD')
  })

  it('requires exactly four finite anchor scores', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1], adjacentBridgeScores: [],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1, Number.NaN], adjacentBridgeScores: [],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
  })

  it('does not count adjacent scores at exactly 0.998 as static', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1, 1],
      adjacentBridgeScores: [0.999, 0.999, 0.999, 0.998, 0.999, 0.999, 0.999],
    })).not.toThrow()
  })

  it('rejects a task response whose result is not a validated AI bridge', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-seam-acceptance-test-'))
    const resultPath = path.join(directory, 'task-result.json')
    try {
      await fs.writeFile(resultPath, JSON.stringify({
        id: 'task-1', status: 'completed', result: { mode: 'direct' },
      }))
      await expect(verifyVideoSeamAcceptance({
        input1Path: path.join(directory, 'input-1.mp4'),
        input2Path: path.join(directory, 'input-2.mp4'),
        outputPath: path.join(directory, 'output.mp4'),
        resultPath,
      })).rejects.toThrow('VIDEO_SEAM_ACCEPTANCE_RESULT_INVALID')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
