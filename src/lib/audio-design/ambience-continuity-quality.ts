import { frameToSample, type AudioDesignClock } from './types'

export type AmbienceContinuityMeasurement = {
  readonly frame: number
  readonly beforeDb: number
  readonly afterDb: number
  readonly deltaDb: number
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let index = start; index < end; index += 1) sum += (samples[index] ?? 0) ** 2
  return Math.sqrt(sum / Math.max(1, end - start))
}

function toDb(value: number): number {
  return 20 * Math.log10(Math.max(1e-9, value))
}

export function measureAmbienceContinuity(input: {
  readonly samples: Float32Array
  readonly clock: AudioDesignClock
  readonly boundaryFrames: readonly number[]
  readonly windowFrames?: number
}): readonly AmbienceContinuityMeasurement[] {
  const windowFrames = input.windowFrames ?? 24
  if (!Number.isInteger(windowFrames) || windowFrames <= 0) throw new Error('AUDIO_AMBIENCE_CONTINUITY_WINDOW_INVALID')
  return [...new Set(input.boundaryFrames)].sort((left, right) => left - right).map((frame) => {
    if (!Number.isInteger(frame) || frame <= 0 || frame >= input.clock.totalFrames) {
      throw new Error(`AUDIO_AMBIENCE_CONTINUITY_BOUNDARY_INVALID:${frame}`)
    }
    const start = frameToSample(Math.max(0, frame - windowFrames), input.clock)
    const boundary = frameToSample(frame, input.clock)
    const end = frameToSample(Math.min(input.clock.totalFrames, frame + windowFrames), input.clock)
    if (end > input.samples.length) throw new Error(`AUDIO_AMBIENCE_CONTINUITY_PCM_TOO_SHORT:${input.samples.length}:${end}`)
    const beforeDb = toDb(rms(input.samples, start, boundary))
    const afterDb = toDb(rms(input.samples, boundary, end))
    return { frame, beforeDb, afterDb, deltaDb: afterDb - beforeDb }
  })
}

export function assertAmbienceContinuity(input: {
  readonly measurements: readonly AmbienceContinuityMeasurement[]
  readonly maximumDeltaDb?: number
}): void {
  const threshold = input.maximumDeltaDb ?? 6
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('AUDIO_AMBIENCE_CONTINUITY_THRESHOLD_INVALID')
  const failure = input.measurements.find((measurement) => Math.abs(measurement.deltaDb) > threshold)
  if (failure) throw new Error(`FINAL_VIDEO_RENDER_AMBIENCE_CONTINUITY_FAILED:${failure.frame}:${failure.deltaDb.toFixed(3)}`)
}
