import { describe, expect, it } from 'vitest'
import { buildVideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'

const video1 = { width: 1920, height: 1080, fps: 24, frameCount: 240, durationSeconds: 10, hasAudio: true }
const video2 = { width: 1280, height: 720, fps: 24, frameCount: 300, durationSeconds: 12.5, hasAudio: true }

describe('motion-aware video seam bridge plan', () => {
  it('calculates exact source anchors, generated anchors, and output duration', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: video1, input2: video2, trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    expect(plan.handleFrames).toBe(6)
    expect(plan.generatedFrameCount).toBe(97)
    expect(plan.sourceAnchors).toEqual({
      input1Pre: 233, input1Endpoint: 239, input2Endpoint: 1, input2Post: 7,
    })
    expect(plan.generatedAnchors).toEqual([0, 6, 90, 96])
    expect(plan.centralFrameCount).toBe(83)
    expect(plan.outputFrameCount).toBe(622)
    expect(plan.centralSilenceSeconds).toBeCloseTo(83 / 24, 8)
    expect(plan.generationCanvas).toEqual({
      contentWidth: 1280, contentHeight: 720, width: 1280, height: 736,
      padLeft: 0, padTop: 8, padRight: 0, padBottom: 8,
    })
    expect(plan.audioPolicy).toBe('both')
    expect(plan.targetBitrateMbps).toBe(10)
  })

  it('accepts nominal 23.976/24 FPS and records audio tempo', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { ...video1, fps: 23.976 }, input2: video2,
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    expect(plan.video2AudioTempoFactor).toBeCloseTo(23.976 / 24, 8)
  })

  it('derives a portrait canvas without stretching', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { ...video1, width: 1080, height: 1920 },
      input2: { ...video2, width: 720, height: 1280 },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    expect(plan.generationCanvas).toMatchObject({
      contentWidth: 720, contentHeight: 1280, width: 736, height: 1280,
    })
  })

  it('keeps both tiny canvas axes at least 64 pixels with centered padding', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { ...video1, width: 32, height: 16 },
      input2: { ...video2, width: 32, height: 16 },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    expect(plan.generationCanvas).toEqual({
      contentWidth: 32, contentHeight: 16, width: 64, height: 64,
      padLeft: 16, padTop: 24, padRight: 16, padBottom: 24,
    })
  })

  it.each([
    ['VIDEO_SEAM_ASPECT_RATIO_MISMATCH', { input2: { ...video2, width: 1024, height: 768 } }],
    ['VIDEO_SEAM_FPS_MISMATCH', { input2: { ...video2, fps: 25 } }],
    ['VIDEO_SEAM_DIMENSIONS_UNSUPPORTED', { input1: { ...video1, width: 1919 } }],
    ['VIDEO_SEAM_CONTEXT_TOO_SHORT', { input1: { ...video1, frameCount: 6, durationSeconds: 0.25 } }],
  ])('fails closed with %s', (code, overrides) => {
    expect(() => buildVideoSeamBridgePlan({
      input1: 'input1' in overrides ? overrides.input1 : video1,
      input2: 'input2' in overrides ? overrides.input2 : video2,
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })).toThrow(code)
  })
})
