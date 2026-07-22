import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VideoSeamDiagnostics as VideoSeamDiagnosticsData } from '@/app/[locale]/workspace/video-tools/video-tools-state'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import VideoSeamDiagnostics from '@/app/[locale]/workspace/video-tools/VideoSeamDiagnostics'

vi.stubGlobal('React', React)

const diagnostics: VideoSeamDiagnosticsData = {
  probes: {
    input1: {
      width: 1920,
      height: 1080,
      fps: 24,
      frameCount: 240,
      durationSeconds: 10,
      hasAudio: true,
    },
    input2: {
      width: 1920,
      height: 1080,
      fps: 24,
      frameCount: 288,
      durationSeconds: 12,
      hasAudio: true,
    },
  },
  output: {
    width: 1920,
    height: 1080,
    fps: 24,
    frameCount: 610,
    durationSeconds: 610 / 24,
    hasAudio: true,
  },
  bridge: {
    requestedDurationSeconds: 4,
    handleFrames: 6,
    generatedFrameCount: 97,
    centralFrameCount: 83,
    centralSilenceSeconds: 83 / 24,
    sourceAnchors: {
      input1Pre: 233,
      input1Endpoint: 239,
      input2Endpoint: 1,
      input2Post: 7,
    },
    generatedAnchors: [0, 6, 90, 96],
    generationCanvas: {
      contentWidth: 1280,
      contentHeight: 720,
      width: 1280,
      height: 736,
      padLeft: 0,
      padTop: 8,
      padRight: 0,
      padBottom: 8,
    },
    video2AudioTempoFactor: 1,
    audioPolicy: 'both',
    targetBitrateMbps: 10,
  },
}

describe('VideoSeamDiagnostics', () => {
  it('renders validated output and bridge values in a compact diagnostic summary', () => {
    const html = renderToStaticMarkup(createElement(VideoSeamDiagnostics, { diagnostics }))

    expect(html).toContain('diagnostics.title')
    expect(html).toContain('diagnostics.output')
    expect(html).toContain('1920x1080')
    expect(html).toContain('24 fps')
    expect(html).toContain('diagnostics.motionAnchors')
    expect(html).toContain('diagnostics.audioBoth')
    expect(html).toContain('3.458 s')
  })
})
