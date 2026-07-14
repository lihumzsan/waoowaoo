export interface AmbienceLoopBoundaryMeasurement {
  readonly edgeJump: number
  readonly rmsDifference: number
  readonly dcOffsetDifference: number
  readonly boundaryScore: number
}

export interface AmbienceCandidateQualityMeasurement {
  readonly rmsAmplitude: number
  readonly peakAmplitude: number
  readonly transientRate: number
  readonly salienceScore: number
  readonly qualityScore: number
  readonly passed: boolean
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let index = start; index < end; index += 1) {
    const value = samples[index] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum / Math.max(1, end - start))
}

function mean(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let index = start; index < end; index += 1) sum += samples[index] ?? 0
  return sum / Math.max(1, end - start)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function amplitudeToDbfs(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -120
}

export function measureAmbienceCandidateQuality(input: {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly targetSalience: number
  readonly maximumTransientRate: number
  readonly boundaryScore: number
}): AmbienceCandidateQualityMeasurement {
  if (input.samples.length < input.sampleRate || input.sampleRate <= 0) throw new Error('AUDIO_AMBIENCE_CANDIDATE_TOO_SHORT')
  if (input.targetSalience < 0 || input.targetSalience > 1 || input.maximumTransientRate <= 0) {
    throw new Error('AUDIO_AMBIENCE_QUALITY_TARGET_INVALID')
  }
  let squareSum = 0
  let peakAmplitude = 0
  let transientCount = 0
  let previous = input.samples[0] ?? 0
  for (const sample of input.samples) {
    squareSum += sample * sample
    peakAmplitude = Math.max(peakAmplitude, Math.abs(sample))
    if (Math.abs(sample - previous) >= 0.18) transientCount += 1
    previous = sample
  }
  const rmsAmplitude = Math.sqrt(squareSum / input.samples.length)
  const durationSeconds = input.samples.length / input.sampleRate
  const transientRate = transientCount / durationSeconds
  const rmsSalience = clamp((amplitudeToDbfs(rmsAmplitude) + 60) / 50, 0, 1)
  const peakSalience = clamp((amplitudeToDbfs(peakAmplitude) + 40) / 38, 0, 1)
  const transientSalience = clamp(transientRate / 12, 0, 1)
  const salienceScore = clamp(rmsSalience * 0.5 + peakSalience * 0.2 + transientSalience * 0.3, 0, 1)
  const salienceError = Math.abs(salienceScore - input.targetSalience)
  const boundaryPenalty = clamp(input.boundaryScore * 4, 0, 1)
  const transientPenalty = clamp(transientRate / input.maximumTransientRate - 1, 0, 1)
  const qualityScore = clamp(100 * (1 - salienceError * 0.55 - boundaryPenalty * 0.3 - transientPenalty * 0.15), 0, 100)
  return {
    rmsAmplitude,
    peakAmplitude,
    transientRate,
    salienceScore,
    qualityScore,
    passed: peakAmplitude <= 1.01
      && rmsAmplitude >= 0.00001
      && transientRate <= input.maximumTransientRate
      && salienceError <= 0.45
      && qualityScore >= 55,
  }
}

export function selectBestAmbienceCandidate<T extends {
  readonly boundaryScore: number
  readonly quality: AmbienceCandidateQualityMeasurement
}>(candidates: readonly T[]): number {
  if (candidates.length !== 2) throw new Error('AUDIO_AMBIENCE_TWO_CANDIDATES_REQUIRED')
  const selected = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.quality.passed)
    .sort((left, right) => right.candidate.quality.qualityScore - left.candidate.quality.qualityScore
      || left.candidate.boundaryScore - right.candidate.boundaryScore)[0]
  if (!selected) throw new Error('AUDIO_AMBIENCE_CANDIDATE_QUALITY_FAILED')
  return selected.index
}

export function measureAmbienceLoopBoundary(input: {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly analysisWindowSeconds?: number
}): AmbienceLoopBoundaryMeasurement {
  if (!Number.isInteger(input.sampleRate) || input.sampleRate <= 0) throw new Error('AUDIO_AMBIENCE_LOOP_SAMPLE_RATE_INVALID')
  if (input.samples.length < input.sampleRate) throw new Error('AUDIO_AMBIENCE_LOOP_CANDIDATE_TOO_SHORT')
  const requestedWindow = input.analysisWindowSeconds ?? 0.25
  if (!Number.isFinite(requestedWindow) || requestedWindow <= 0 || requestedWindow > 1) {
    throw new Error('AUDIO_AMBIENCE_LOOP_ANALYSIS_WINDOW_INVALID')
  }
  const windowSamples = Math.min(Math.floor(input.samples.length / 4), Math.max(1, Math.round(input.sampleRate * requestedWindow)))
  const tailStart = input.samples.length - windowSamples
  const headRms = rms(input.samples, 0, windowSamples)
  const tailRms = rms(input.samples, tailStart, input.samples.length)
  const headMean = mean(input.samples, 0, windowSamples)
  const tailMean = mean(input.samples, tailStart, input.samples.length)
  const edgeJump = Math.abs((input.samples[0] ?? 0) - (input.samples[input.samples.length - 1] ?? 0))
  const rmsDifference = Math.abs(headRms - tailRms)
  const dcOffsetDifference = Math.abs(headMean - tailMean)
  return { edgeJump, rmsDifference, dcOffsetDifference, boundaryScore: edgeJump + rmsDifference + dcOffsetDifference }
}

export function assertAmbienceLoopBoundaryQuality(measurement: AmbienceLoopBoundaryMeasurement): void {
  if (measurement.edgeJump > 0.2 || measurement.rmsDifference > 0.12 || measurement.dcOffsetDifference > 0.05) {
    throw new Error('AUDIO_AMBIENCE_LOOP_BOUNDARY_QUALITY_FAILED')
  }
}
