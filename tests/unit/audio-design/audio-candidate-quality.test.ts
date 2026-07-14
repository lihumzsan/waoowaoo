import { describe, expect, it } from 'vitest'
import {
  assertAmbienceContinuity,
  measureAmbienceContinuity,
} from '@/lib/audio-design/ambience-continuity-quality'
import {
  assertAmbienceLoopBoundaryQuality,
  measureAmbienceLoopBoundary,
  selectBestAmbienceCandidate,
  type AmbienceCandidateQualityMeasurement,
} from '@/lib/audio-design/ambience-loop'
import { selectScoreCandidate, type ScoreCandidateQuality } from '@/lib/audio-design/score-quality'

function ambienceQuality(qualityScore: number, passed = true): AmbienceCandidateQualityMeasurement {
  return {
    rmsAmplitude: 0.08,
    peakAmplitude: 0.2,
    transientRate: 0.5,
    salienceScore: 0.2,
    qualityScore,
    passed,
  }
}

function scoreQuality(qualityScore: number, passed = true): ScoreCandidateQuality {
  return {
    actualDurationSeconds: 10,
    sourceDurationSeconds: 10,
    durationConformanceRatio: 1,
    peakAmplitude: 0.2,
    rmsAmplitude: 0.08,
    clippingRatio: 0,
    silenceRatio: 0,
    transientRate: 0.5,
    repetitionScore: 0.1,
    structureError: 0.1,
    qualityScore,
    passed,
  }
}

/**
 * Logic Specification
 * Authority: candidate QC evaluates only newly generated candidate PCM and the generated ambience mix.
 * Rejects: one-candidate acceptance, selecting a failed candidate, audible loop discontinuity, and >6 dB SoundWorld boundary jumps.
 * Production entries: selectBestAmbienceCandidate, selectScoreCandidate, measureAmbienceLoopBoundary, measureAmbienceContinuity.
 * Oracle: exactly two candidates are required and only technical waveform measurements decide acceptance; no video/native/final-media semantics enter these functions.
 * Command: npx vitest run tests/unit/audio-design/audio-candidate-quality.test.ts
 */
describe('generated audio candidate technical quality', () => {
  it('selects the best passing candidate and fails when the two-candidate contract is absent', () => {
    expect(selectBestAmbienceCandidate([
      { boundaryScore: 0.01, quality: ambienceQuality(70) },
      { boundaryScore: 0.02, quality: ambienceQuality(90) },
    ])).toBe(1)
    expect(selectScoreCandidate([scoreQuality(88), scoreQuality(72)])).toBe(0)

    expect(() => selectBestAmbienceCandidate([
      { boundaryScore: 0.01, quality: ambienceQuality(90) },
    ])).toThrow('AUDIO_AMBIENCE_TWO_CANDIDATES_REQUIRED')
    expect(() => selectScoreCandidate([scoreQuality(90, false), scoreQuality(80, false)]))
      .toThrow('AUDIO_SCORE_CANDIDATE_QUALITY_FAILED')
  })

  it('accepts a technically seamless generated loop and rejects a discontinuous one', () => {
    const sampleRate = 100
    const seamless = new Float32Array(sampleRate * 2)
    for (let index = 0; index < seamless.length; index += 1) {
      seamless[index] = Math.cos(index / (seamless.length - 1) * Math.PI * 4) * 0.1
    }
    expect(() => assertAmbienceLoopBoundaryQuality(measureAmbienceLoopBoundary({
      samples: seamless,
      sampleRate,
      analysisWindowSeconds: 0.1,
    }))).not.toThrow()

    const discontinuous = new Float32Array(sampleRate * 2).fill(0.1)
    discontinuous[discontinuous.length - 1] = -0.9
    expect(() => assertAmbienceLoopBoundaryQuality(measureAmbienceLoopBoundary({
      samples: discontinuous,
      sampleRate,
      analysisWindowSeconds: 0.1,
    }))).toThrow('AUDIO_AMBIENCE_LOOP_BOUNDARY_QUALITY_FAILED')
  })

  it('accepts continuous generated ambience and rejects a large SoundWorld boundary gain jump', () => {
    const clock = { fps: 24 as const, sampleRate: 48_000 as const, totalFrames: 48 }
    const samples = new Float32Array(96_000).fill(0.1)
    const continuous = measureAmbienceContinuity({ samples, clock, boundaryFrames: [24], windowFrames: 12 })
    expect(() => assertAmbienceContinuity({ measurements: continuous })).not.toThrow()

    samples.fill(0.01, 48_000)
    const jumped = measureAmbienceContinuity({ samples, clock, boundaryFrames: [24], windowFrames: 12 })
    expect(() => assertAmbienceContinuity({ measurements: jumped }))
      .toThrow('FINAL_VIDEO_RENDER_AMBIENCE_CONTINUITY_FAILED')
  })
})
