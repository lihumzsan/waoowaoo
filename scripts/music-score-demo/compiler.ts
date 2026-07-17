import {
  scoreSourceSchema,
  type CompiledScore,
  type NoteEvent,
  type ScoreSource,
} from './types'

function clampMidi(value: number): number {
  return Math.max(24, Math.min(108, Math.round(value)))
}

function clampVelocity(value: number): number {
  return Math.max(1, Math.min(127, Math.round(value)))
}

function validateCommon(source: ScoreSource): void {
  const beatDuration = 60 / source.bpm
  const totalBeats = source.durationSeconds / beatDuration
  let previousEnd = 0
  for (const [index, cue] of source.emotionCurve.entries()) {
    if (Math.abs(cue.startSecond - previousEnd) > 0.000_001) {
      throw new Error(`EMOTION_CURVE_GAP_OR_OVERLAP:${index}`)
    }
    if (cue.endSecond <= cue.startSecond) throw new Error(`EMOTION_CUE_RANGE_INVALID:${index}`)
    previousEnd = cue.endSecond
  }
  if (Math.abs(previousEnd - source.durationSeconds) > 0.000_001) {
    throw new Error('EMOTION_CURVE_DURATION_MISMATCH')
  }
  if (Math.abs(totalBeats / source.beatsPerBar - Math.round(totalBeats / source.beatsPerBar)) > 0.000_001) {
    throw new Error('SCORE_DURATION_MUST_END_ON_BAR')
  }
}

function compileDirect(source: Extract<ScoreSource, { kind: 'note-events/v1' }>): NoteEvent[] {
  return source.tracks.flatMap((track) => track.notes.map((note) => ({
    trackId: track.trackId,
    instrument: track.instrument,
    startBeat: note.startBeat,
    durationBeats: note.durationBeats,
    midi: note.midi,
    velocity: note.velocity,
    gain: track.gain,
    pan: track.pan,
  })))
}

function compileMotif(source: Extract<ScoreSource, { kind: 'motif-arrangement/v1' }>): NoteEvent[] {
  const harmonyByBar = new Map(source.harmony.map((bar) => [bar.barIndex, bar] as const))
  const motifById = new Map(source.motifs.map((motif) => [motif.motifId, motif] as const))
  const events: NoteEvent[] = []

  for (const track of source.tracks) {
    for (const barIndex of track.barIndexes) {
      const harmony = harmonyByBar.get(barIndex)
      if (!harmony) throw new Error(`MOTIF_HARMONY_BAR_MISSING:${barIndex}`)
      const baseBeat = barIndex * source.beatsPerBar
      const baseMidi = harmony.rootMidi + track.octaveShift * 12

      if (track.part === 'motif') {
        if (!track.motifId) throw new Error(`MOTIF_TRACK_SOURCE_REQUIRED:${track.trackId}`)
        const motif = motifById.get(track.motifId)
        if (!motif) throw new Error(`MOTIF_SOURCE_MISSING:${track.motifId}`)
        for (const step of motif.steps) {
          events.push({
            trackId: track.trackId,
            instrument: track.instrument,
            startBeat: baseBeat + step.beatOffset,
            durationBeats: step.durationBeats,
            midi: clampMidi(baseMidi + step.semitones),
            velocity: clampVelocity(step.velocity * track.velocityScale),
            gain: track.gain,
            pan: track.pan,
          })
        }
        continue
      }

      if (track.part === 'chords') {
        for (const interval of harmony.chordIntervals) {
          events.push({
            trackId: track.trackId,
            instrument: track.instrument,
            startBeat: baseBeat,
            durationBeats: track.noteDurationBeats ?? 3.9,
            midi: clampMidi(baseMidi + interval),
            velocity: clampVelocity(58 * track.velocityScale),
            gain: track.gain,
            pan: track.pan,
          })
        }
        continue
      }

      const pattern = track.patternBeats ?? (track.part === 'bass' ? [0] : [0, 2])
      for (const beatOffset of pattern) {
        events.push({
          trackId: track.trackId,
          instrument: track.instrument,
          startBeat: baseBeat + beatOffset,
          durationBeats: track.noteDurationBeats ?? (track.part === 'bass' ? 1.8 : 0.25),
          midi: clampMidi(track.part === 'bass' ? baseMidi : 48 + (barIndex % 2) * 2),
          velocity: clampVelocity((track.part === 'bass' ? 62 : 48) * track.velocityScale),
          gain: track.gain,
          pan: track.pan,
        })
      }
    }
  }
  return events
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function emotionAt(source: Extract<ScoreSource, { kind: 'emotion-procedural/v1' }>, second: number) {
  const cue = source.emotionCurve.find((candidate) => second >= candidate.startSecond && second < candidate.endSecond)
  return cue ?? source.emotionCurve[source.emotionCurve.length - 1]
}

function compileProcedural(source: Extract<ScoreSource, { kind: 'emotion-procedural/v1' }>): NoteEvent[] {
  const random = mulberry32(source.seed)
  const scale = source.mode === 'major'
    ? [0, 2, 4, 5, 7, 9, 11]
    : source.mode === 'dorian'
      ? [0, 2, 3, 5, 7, 9, 10]
      : [0, 2, 3, 5, 7, 8, 10]
  const progression = [0, -3, 5, -2, 0, -3, 3, 5, 0]
  const beatSeconds = 60 / source.bpm
  const totalBars = Math.round(source.durationSeconds / beatSeconds / source.beatsPerBar)
  const events: NoteEvent[] = []

  for (let barIndex = 0; barIndex < totalBars; barIndex += 1) {
    const startBeat = barIndex * source.beatsPerBar
    const startSecond = startBeat * beatSeconds
    const cue = emotionAt(source, startSecond)
    if (!cue) throw new Error(`PROCEDURAL_EMOTION_MISSING:${barIndex}`)
    const root = source.rootMidi + (progression[barIndex % progression.length] ?? 0)
    const chordDegrees = cue.intensity < 0.45 ? [0, 2, 4] : [0, 2, 4, 6]

    for (const degree of chordDegrees) {
      events.push({
        trackId: 'generated-pad',
        instrument: source.palette.pad,
        startBeat,
        durationBeats: 3.9,
        midi: clampMidi(root + (scale[degree % scale.length] ?? 0) + (degree >= scale.length ? 12 : 0)),
        velocity: clampVelocity(38 + cue.intensity * 22),
        gain: 0.45,
        pan: 0.12,
      })
    }

    events.push({
      trackId: 'generated-bass',
      instrument: source.palette.bass,
      startBeat,
      durationBeats: cue.intensity > 0.6 ? 1.8 : 3.7,
      midi: clampMidi(root - 12),
      velocity: clampVelocity(48 + cue.intensity * 26),
      gain: 0.6,
      pan: 0,
    })

    const leadCount = cue.intensity < 0.4 ? 2 : cue.intensity < 0.7 ? 4 : 6
    for (let noteIndex = 0; noteIndex < leadCount; noteIndex += 1) {
      const beatOffset = noteIndex * (4 / leadCount)
      const degree = Math.floor(random() * scale.length)
      const direction = cue.emotion === 'released' ? noteIndex : 0
      events.push({
        trackId: 'generated-lead',
        instrument: source.palette.lead,
        startBeat: startBeat + beatOffset,
        durationBeats: Math.max(0.3, 2.8 / leadCount),
        midi: clampMidi(root + 12 + (scale[(degree + direction) % scale.length] ?? 0)),
        velocity: clampVelocity(42 + cue.intensity * 38 + random() * 8),
        gain: 0.58,
        pan: -0.18 + random() * 0.16,
      })
    }

    if (cue.intensity >= 0.45) {
      const pulseStep = cue.intensity >= 0.75 ? 0.5 : 1
      for (let beatOffset = 0; beatOffset < 4; beatOffset += pulseStep) {
        events.push({
          trackId: 'generated-pulse',
          instrument: source.palette.pulse,
          startBeat: startBeat + beatOffset,
          durationBeats: 0.18,
          midi: 48 + (Math.round(beatOffset * 2) % 2) * 3,
          velocity: clampVelocity(38 + cue.intensity * 28),
          gain: 0.42,
          pan: beatOffset % 1 === 0 ? -0.28 : 0.28,
        })
      }
    }
  }
  return events
}

function compileCinematic(source: Extract<ScoreSource, { kind: 'cinematic-continuous/v1' }>): NoteEvent[] {
  const harmonyByBar = new Map(source.harmony.map((bar) => [bar.barIndex, bar] as const))
  const totalBeats = source.durationSeconds / (60 / source.bpm)
  const events: NoteEvent[] = source.phrases.flatMap((track) => track.notes.map((note) => ({
    trackId: track.trackId,
    instrument: track.instrument,
    startBeat: note.startBeat,
    durationBeats: note.durationBeats,
    midi: note.midi,
    velocity: note.velocity,
    gain: track.gain,
    pan: track.pan,
  })))

  for (const layer of source.layers) {
    layer.barIndexes.forEach((barIndex, layerBarIndex) => {
      const harmony = harmonyByBar.get(barIndex)
      if (!harmony) throw new Error(`CINEMATIC_HARMONY_BAR_MISSING:${barIndex}`)
      const progress = layer.barIndexes.length <= 1 ? 1 : layerBarIndex / (layer.barIndexes.length - 1)
      const velocity = clampVelocity(layer.velocityStart + (layer.velocityEnd - layer.velocityStart) * progress)
      const startBeat = barIndex * source.beatsPerBar

      if (layer.part === 'sustain') {
        for (const voice of harmony.voices) {
          events.push({
            trackId: layer.trackId,
            instrument: layer.instrument,
            startBeat,
            durationBeats: layer.durationBeats,
            midi: clampMidi(voice + layer.octaveShift * 12),
            velocity,
            gain: layer.gain,
            pan: layer.pan,
          })
        }
        return
      }

      if (layer.part === 'arpeggio') {
        const stepCount = Math.round(source.beatsPerBar / layer.subdivisionBeats)
        for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
          const voiceIndex = layer.order[stepIndex % layer.order.length]
          if (voiceIndex === undefined || voiceIndex >= harmony.voices.length) {
            throw new Error(`CINEMATIC_ARPEGGIO_VOICE_INVALID:${layer.trackId}:${barIndex}:${String(voiceIndex)}`)
          }
          const voice = harmony.voices[voiceIndex]
          if (voice === undefined) throw new Error(`CINEMATIC_ARPEGGIO_VOICE_MISSING:${layer.trackId}:${barIndex}`)
          const contour = Math.sin(stepIndex / Math.max(1, stepCount - 1) * Math.PI)
          const noteStartBeat = startBeat + stepIndex * layer.subdivisionBeats
          events.push({
            trackId: layer.trackId,
            instrument: layer.instrument,
            startBeat: noteStartBeat,
            durationBeats: Math.min(layer.noteDurationBeats, totalBeats - noteStartBeat),
            midi: clampMidi(voice + layer.octaveShift * 12),
            velocity: clampVelocity(velocity + contour * 8),
            gain: layer.gain,
            pan: layer.pan + (stepIndex % 2 === 0 ? -0.035 : 0.035),
          })
        }
        return
      }

      for (const beatOffset of layer.patternBeats) {
        events.push({
          trackId: layer.trackId,
          instrument: layer.instrument,
          startBeat: startBeat + beatOffset,
          durationBeats: layer.noteDurationBeats,
          midi: clampMidi(harmony.bassMidi + layer.octaveShift * 12),
          velocity,
          gain: layer.gain,
          pan: layer.pan,
        })
      }
    })
  }
  return events
}

function validateCompiled(source: ScoreSource, events: readonly NoteEvent[]): void {
  const totalBeats = source.durationSeconds / (60 / source.bpm)
  if (events.length === 0) throw new Error('COMPILED_SCORE_EMPTY')
  for (const [index, event] of events.entries()) {
    if (event.startBeat < 0 || event.startBeat + event.durationBeats > totalBeats + 0.000_001) {
      throw new Error(`COMPILED_NOTE_OUTSIDE_SCORE:${index}`)
    }
  }
}

export function parseAndCompileScore(value: unknown): CompiledScore {
  const source = scoreSourceSchema.parse(value)
  validateCommon(source)
  const events = source.kind === 'note-events/v1'
    ? compileDirect(source)
    : source.kind === 'motif-arrangement/v1'
      ? compileMotif(source)
      : source.kind === 'emotion-procedural/v1'
        ? compileProcedural(source)
        : compileCinematic(source)
  validateCompiled(source, events)
  return {
    title: source.title,
    sourceKind: source.kind,
    bpm: source.bpm,
    beatsPerBar: source.beatsPerBar,
    durationSeconds: source.durationSeconds,
    events: [...events].sort((left, right) => left.startBeat - right.startBeat || left.midi - right.midi),
  }
}
