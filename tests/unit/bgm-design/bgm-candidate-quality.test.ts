import { describe, expect, it } from 'vitest'
import { selectScoreCandidate, type ScoreCandidateQuality } from '@/lib/bgm-design/score-quality'

function scoreQuality(qualityScore: number, passed = true): ScoreCandidateQuality {
  return {
    actualDurationSeconds: 120,
    sourceDurationSeconds: 120,
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
 * Authority: BGM candidate QC evaluates only newly generated candidate PCM.
 * Rejects: accepting one candidate or selecting a failed candidate.
 * Production entry: selectScoreCandidate.
 * Final oracle: exactly two BGM candidates are required and only technical waveform measurements decide acceptance.
 * Command: npx vitest run tests/unit/bgm-design/bgm-candidate-quality.test.ts
 */
describe('generated BGM candidate technical quality', () => {
  it('selects the best passing candidate and fails closed without two candidates', () => {
    expect(selectScoreCandidate([scoreQuality(88), scoreQuality(72)])).toBe(0)
    expect(() => selectScoreCandidate([scoreQuality(90)]))
      .toThrow('AUDIO_SCORE_TWO_CANDIDATES_REQUIRED')
    expect(() => selectScoreCandidate([scoreQuality(90, false), scoreQuality(80, false)]))
      .toThrow('AUDIO_SCORE_CANDIDATE_QUALITY_FAILED')
  })
})
