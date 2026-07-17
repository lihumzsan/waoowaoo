import type { CompiledScore, InstrumentId, NoteEvent } from './types'

const SAMPLE_RATE = 48_000

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function adsr(t: number, duration: number, attack: number, decay: number, sustain: number, release: number): number {
  if (t < 0 || t >= duration) return 0
  if (t < attack) return t / Math.max(attack, 0.000_1)
  if (t < attack + decay) {
    const progress = (t - attack) / Math.max(decay, 0.000_1)
    return 1 - (1 - sustain) * progress
  }
  if (t > duration - release) return sustain * (duration - t) / Math.max(release, 0.000_1)
  return sustain
}

function deterministicNoise(index: number, seed: number): number {
  const raw = Math.sin(index * 12.9898 + seed * 78.233) * 43_758.5453
  return (raw - Math.floor(raw)) * 2 - 1
}

function oscillator(instrument: InstrumentId, frequency: number, t: number, duration: number, sampleIndex: number, seed: number): number {
  const phase = Math.PI * 2 * frequency * t
  if (instrument === 'felt_piano') {
    const envelope = Math.exp(-1.45 * t) * adsr(t, duration, 0.004, 0.08, 0.72, Math.min(0.35, duration * 0.3))
    const hammer = deterministicNoise(sampleIndex, seed) * Math.exp(-42 * t) * 0.12
    return envelope * (Math.sin(phase) * 0.78 + Math.sin(phase * 2.003) * 0.17 + Math.sin(phase * 3.997) * 0.05 + hammer)
  }
  if (instrument === 'warm_pad') {
    const vibrato = 1 + Math.sin(Math.PI * 2 * 0.18 * t + seed) * 0.0018
    const padPhase = phase * vibrato
    const envelope = adsr(t, duration, 0.55, 0.65, 0.72, Math.min(1.1, duration * 0.38))
    return envelope * (
      Math.sin(padPhase) * 0.62
      + Math.sin(padPhase * 0.501) * 0.18
      + Math.sin(padPhase * 1.997) * 0.12
      + Math.sin(padPhase * 3.01) * 0.05
    )
  }
  if (instrument === 'cello') {
    const vibrato = 1 + Math.sin(Math.PI * 2 * 5.1 * t + seed * 0.1) * 0.004
    const bowedPhase = phase * vibrato
    const envelope = adsr(t, duration, 0.11, 0.3, 0.74, Math.min(0.65, duration * 0.3))
    return envelope * (
      Math.sin(bowedPhase) * 0.64
      + Math.sin(bowedPhase * 2) * 0.21
      + Math.sin(bowedPhase * 3) * 0.1
      + Math.sin(bowedPhase * 4) * 0.05
    )
  }
  if (instrument === 'soft_bass') {
    const envelope = adsr(t, duration, 0.025, 0.18, 0.68, Math.min(0.35, duration * 0.3))
    return envelope * (Math.sin(phase) * 0.82 + Math.sin(phase * 2) * 0.12 + Math.sin(phase * 3) * 0.04)
  }
  if (instrument === 'glass_mallet') {
    const envelope = Math.exp(-2.25 * t) * adsr(t, duration, 0.002, 0.035, 0.82, Math.min(0.22, duration * 0.35))
    return envelope * (Math.sin(phase) * 0.68 + Math.sin(phase * 2.72) * 0.2 + Math.sin(phase * 5.18) * 0.12)
  }
  const envelope = Math.exp(-10 * t) * adsr(t, duration, 0.001, 0.015, 0.5, Math.min(0.08, duration * 0.5))
  const tone = Math.sin(phase) * 0.5 + Math.sin(phase * 1.5) * 0.18
  return envelope * (tone + deterministicNoise(sampleIndex, seed) * 0.26)
}

function renderNote(left: Float64Array, right: Float64Array, score: CompiledScore, event: NoteEvent, eventIndex: number): void {
  const secondsPerBeat = 60 / score.bpm
  const startSecond = event.startBeat * secondsPerBeat
  const duration = event.durationBeats * secondsPerBeat
  const startSample = Math.round(startSecond * SAMPLE_RATE)
  const endSample = Math.min(left.length, Math.ceil((startSecond + duration) * SAMPLE_RATE))
  const frequency = midiToHz(event.midi)
  const amplitude = (event.velocity / 127) * event.gain * 0.19
  const pan = clamp(event.pan, -1, 1)
  const leftGain = Math.cos((pan + 1) * Math.PI / 4)
  const rightGain = Math.sin((pan + 1) * Math.PI / 4)

  for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
    const t = (sampleIndex - startSample) / SAMPLE_RATE
    const value = oscillator(event.instrument, frequency, t, duration, sampleIndex, eventIndex + event.midi)
    left[sampleIndex] += value * amplitude * leftGain
    right[sampleIndex] += value * amplitude * rightGain
  }
}

function addSpace(left: Float64Array, right: Float64Array): void {
  const dryLeft = left.slice()
  const dryRight = right.slice()
  const taps = [
    { seconds: 0.071, gain: 0.11, cross: false },
    { seconds: 0.113, gain: 0.09, cross: true },
    { seconds: 0.173, gain: 0.07, cross: false },
    { seconds: 0.239, gain: 0.055, cross: true },
    { seconds: 0.337, gain: 0.04, cross: false },
  ]
  for (const tap of taps) {
    const delay = Math.round(tap.seconds * SAMPLE_RATE)
    for (let index = delay; index < left.length; index += 1) {
      left[index] += (tap.cross ? dryRight[index - delay] : dryLeft[index - delay]) * tap.gain
      right[index] += (tap.cross ? dryLeft[index - delay] : dryRight[index - delay]) * tap.gain
    }
  }
}

function master(left: Float64Array, right: Float64Array): void {
  const fadeSamples = Math.round(SAMPLE_RATE * 0.18)
  let peak = 0
  for (let index = 0; index < left.length; index += 1) {
    const fadeIn = Math.min(1, index / fadeSamples)
    const fadeOut = Math.min(1, (left.length - 1 - index) / fadeSamples)
    const fade = Math.max(0, Math.min(fadeIn, fadeOut))
    left[index] = Math.tanh(left[index] * 1.12) * fade
    right[index] = Math.tanh(right[index] * 1.12) * fade
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]))
  }
  const normalization = peak > 0 ? 0.91 / peak : 1
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= normalization
    right[index] *= normalization
  }
}

function wavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)
  return header
}

export function renderScoreToWav(score: CompiledScore): Buffer {
  const sampleCount = Math.round(score.durationSeconds * SAMPLE_RATE)
  const left = new Float64Array(sampleCount)
  const right = new Float64Array(sampleCount)
  score.events.forEach((event, index) => renderNote(left, right, score, event, index))
  addSpace(left, right)
  master(left, right)
  const pcm = Buffer.alloc(sampleCount * 4)
  for (let index = 0; index < sampleCount; index += 1) {
    pcm.writeInt16LE(Math.round(clamp(left[index] ?? 0, -1, 1) * 32_767), index * 4)
    pcm.writeInt16LE(Math.round(clamp(right[index] ?? 0, -1, 1) * 32_767), index * 4 + 2)
  }
  return Buffer.concat([wavHeader(pcm.length), pcm])
}
