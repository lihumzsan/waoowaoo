import { z } from 'zod'

export const instrumentIds = [
  'felt_piano',
  'warm_pad',
  'soft_bass',
  'cello',
  'glass_mallet',
  'soft_pulse',
] as const

export const instrumentIdSchema = z.enum(instrumentIds)
export type InstrumentId = z.infer<typeof instrumentIdSchema>

const emotionCueSchema = z.object({
  startSecond: z.number().min(0),
  endSecond: z.number().positive(),
  emotion: z.enum(['restrained_tender', 'hopeful', 'released']),
  intensity: z.number().min(0).max(1),
}).strict()

const sourceBaseShape = {
  title: z.string().trim().min(1),
  bpm: z.number().int().min(40).max(180),
  beatsPerBar: z.literal(4),
  durationSeconds: z.number().positive().max(60),
  emotionCurve: z.array(emotionCueSchema).min(1),
}

const sourceNoteSchema = z.object({
  startBeat: z.number().min(0),
  durationBeats: z.number().positive(),
  midi: z.number().int().min(24).max(108),
  velocity: z.number().int().min(1).max(127),
}).strict()

const directTrackSchema = z.object({
  trackId: z.string().trim().min(1),
  instrument: instrumentIdSchema,
  gain: z.number().positive().max(2),
  pan: z.number().min(-1).max(1),
  notes: z.array(sourceNoteSchema).min(1),
}).strict()

export const directScoreSchema = z.object({
  kind: z.literal('note-events/v1'),
  ...sourceBaseShape,
  tracks: z.array(directTrackSchema).min(1),
}).strict()

const harmonyBarSchema = z.object({
  barIndex: z.number().int().min(0),
  rootMidi: z.number().int().min(36).max(72),
  chordIntervals: z.array(z.number().int().min(-12).max(24)).min(2).max(6),
}).strict()

const motifStepSchema = z.object({
  beatOffset: z.number().min(0).lt(4),
  durationBeats: z.number().positive().max(4),
  semitones: z.number().int().min(-24).max(24),
  velocity: z.number().int().min(1).max(127),
}).strict()

const motifSchema = z.object({
  motifId: z.string().trim().min(1),
  steps: z.array(motifStepSchema).min(1).max(16),
}).strict()

const arrangementTrackSchema = z.object({
  trackId: z.string().trim().min(1),
  instrument: instrumentIdSchema,
  part: z.enum(['motif', 'chords', 'bass', 'pulse']),
  motifId: z.string().trim().min(1).optional(),
  barIndexes: z.array(z.number().int().min(0)).min(1),
  octaveShift: z.number().int().min(-3).max(3),
  velocityScale: z.number().positive().max(2),
  patternBeats: z.array(z.number().min(0).lt(4)).max(8).optional(),
  noteDurationBeats: z.number().positive().max(4).optional(),
  gain: z.number().positive().max(2),
  pan: z.number().min(-1).max(1),
}).strict()

export const motifScoreSchema = z.object({
  kind: z.literal('motif-arrangement/v1'),
  ...sourceBaseShape,
  harmony: z.array(harmonyBarSchema).min(1),
  motifs: z.array(motifSchema).min(1),
  tracks: z.array(arrangementTrackSchema).min(1),
}).strict()

export const proceduralScoreSchema = z.object({
  kind: z.literal('emotion-procedural/v1'),
  ...sourceBaseShape,
  seed: z.number().int().min(0),
  rootMidi: z.number().int().min(36).max(72),
  mode: z.enum(['minor', 'dorian', 'major']),
  palette: z.object({
    lead: instrumentIdSchema,
    pad: instrumentIdSchema,
    bass: instrumentIdSchema,
    pulse: instrumentIdSchema,
  }).strict(),
}).strict()

export const scoreSourceSchema = z.discriminatedUnion('kind', [
  directScoreSchema,
  motifScoreSchema,
  proceduralScoreSchema,
])

export type ScoreSource = z.infer<typeof scoreSourceSchema>

export type NoteEvent = {
  readonly trackId: string
  readonly instrument: InstrumentId
  readonly startBeat: number
  readonly durationBeats: number
  readonly midi: number
  readonly velocity: number
  readonly gain: number
  readonly pan: number
}

export type CompiledScore = {
  readonly title: string
  readonly sourceKind: ScoreSource['kind']
  readonly bpm: number
  readonly beatsPerBar: 4
  readonly durationSeconds: number
  readonly events: readonly NoteEvent[]
}
