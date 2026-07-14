import type { MusicTheorySpec } from './types'

export type ScoreCandidateQuality = {
  readonly actualDurationSeconds: number
  readonly sourceDurationSeconds: number
  readonly durationConformanceRatio: number
  readonly peakAmplitude: number
  readonly rmsAmplitude: number
  readonly clippingRatio: number
  readonly silenceRatio: number
  readonly transientRate: number
  readonly repetitionScore: number
  readonly structureError: number
  readonly qualityScore: number
  readonly passed: boolean
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let index = start; index < end; index += 1) sum += (samples[index] ?? 0) ** 2
  return Math.sqrt(sum / Math.max(1, end - start))
}

function envelope(samples: Float32Array, sampleRate: number): readonly number[] {
  const window = Math.max(1, Math.round(sampleRate * 0.1))
  const result: number[] = []
  for (let start = 0; start < samples.length; start += window) result.push(rms(samples, start, Math.min(samples.length, start + window)))
  return result
}

function correlation(values: readonly number[], lag: number): number {
  if (lag <= 0 || lag >= values.length) return 0
  const count = values.length - lag
  const meanA = values.slice(0, count).reduce((sum, value) => sum + value, 0) / count
  const meanB = values.slice(lag).reduce((sum, value) => sum + value, 0) / count
  let numerator = 0
  let denominatorA = 0
  let denominatorB = 0
  for (let index = 0; index < count; index += 1) {
    const a = (values[index] ?? 0) - meanA
    const b = (values[index + lag] ?? 0) - meanB
    numerator += a * b
    denominatorA += a * a
    denominatorB += b * b
  }
  const denominator = Math.sqrt(denominatorA * denominatorB)
  return denominator > 0 ? Math.max(-1, Math.min(1, numerator / denominator)) : 0
}

function repetitionScore(values: readonly number[]): number {
  let maximum = 0
  for (let lag = 15; lag <= Math.min(values.length - 2, 80); lag += 1) maximum = Math.max(maximum, correlation(values, lag))
  return Math.max(0, maximum)
}

function structureError(values: readonly number[], spec: MusicTheorySpec): number {
  const maximum = Math.max(...values, 0)
  if (maximum <= 0 || values.length === 0) return 1
  const startFrame = spec.phases[0]?.range.startFrame ?? 0
  const endFrame = spec.phases[spec.phases.length - 1]?.range.endFrameExclusive ?? 1
  let error = 0
  values.forEach((value, index) => {
    const frame = startFrame + index / Math.max(1, values.length - 1) * Math.max(1, endFrame - startFrame)
    const phase = spec.phases.find((candidate, phaseIndex) => frame >= candidate.range.startFrame
      && (frame < candidate.range.endFrameExclusive || phaseIndex === spec.phases.length - 1))
    error += Math.abs(value / maximum - (phase?.energy ?? spec.dynamics.minimumEnergy))
  })
  return Math.min(1, error / values.length)
}

export function analyzeScoreCandidate(input: {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly expectedDurationSeconds: number
  readonly sourceDurationSeconds: number
  readonly durationConformanceRatio: number
  readonly spec: MusicTheorySpec
}): ScoreCandidateQuality {
  if (!Number.isInteger(input.sampleRate) || input.sampleRate <= 0 || input.samples.length < input.sampleRate) {
    throw new Error('AUDIO_SCORE_CANDIDATE_TOO_SHORT')
  }
  const values = envelope(input.samples, input.sampleRate)
  let peakAmplitude = 0
  let sumSquares = 0
  let clipped = 0
  for (const sample of input.samples) {
    peakAmplitude = Math.max(peakAmplitude, Math.abs(sample))
    sumSquares += sample * sample
    if (Math.abs(sample) >= 0.999) clipped += 1
  }
  const rmsAmplitude = Math.sqrt(sumSquares / input.samples.length)
  const clippingRatio = clipped / input.samples.length
  const silenceRatio = values.filter((value) => value < 0.002).length / Math.max(1, values.length)
  let transients = 0
  for (let index = 1; index < values.length; index += 1) if (Math.abs((values[index] ?? 0) - (values[index - 1] ?? 0)) > 0.035) transients += 1
  const actualDurationSeconds = input.samples.length / input.sampleRate
  const transientRate = transients / Math.max(1, actualDurationSeconds)
  const repetition = repetitionScore(values)
  const structure = structureError(values, input.spec)
  const durationErrorSeconds = Math.abs(actualDurationSeconds - input.expectedDurationSeconds)
  const qualityScore = Math.max(0, Math.min(100, 100 - clippingRatio * 2_000 - Math.max(0, silenceRatio - 0.25) * 80 - structure * 35 - Math.max(0, repetition - 0.8) * 40 - durationErrorSeconds * 100))
  return {
    actualDurationSeconds,
    sourceDurationSeconds: input.sourceDurationSeconds,
    durationConformanceRatio: input.durationConformanceRatio,
    peakAmplitude,
    rmsAmplitude,
    clippingRatio,
    silenceRatio,
    transientRate,
    repetitionScore: repetition,
    structureError: structure,
    qualityScore,
    passed: peakAmplitude >= 0.01 && clippingRatio <= 0.01 && silenceRatio <= 0.5 && durationErrorSeconds <= 0.001,
  }
}

export function selectScoreCandidate(candidates: readonly ScoreCandidateQuality[]): number {
  if (candidates.length !== 2) throw new Error('AUDIO_SCORE_TWO_CANDIDATES_REQUIRED')
  const selected = candidates.map((quality, index) => ({ quality, index }))
    .filter(({ quality }) => quality.passed)
    .sort((left, right) => right.quality.qualityScore - left.quality.qualityScore)[0]
  if (!selected) throw new Error('AUDIO_SCORE_CANDIDATE_QUALITY_FAILED')
  return selected.index
}
