import { z } from 'zod'

export const BGM_DESIGN_FPS = 24 as const
export const BGM_DESIGN_SAMPLE_RATE = 48_000 as const

export const BGM_DESIGN_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  FAILED: 'failed',
} as const

export type BgmDesignStatus = (typeof BGM_DESIGN_STATUS)[keyof typeof BGM_DESIGN_STATUS]

export const frameRangeSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrameExclusive: z.number().int().positive(),
}).strict().superRefine((range, ctx) => {
  if (range.endFrameExclusive <= range.startFrame) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endFrameExclusive'],
      message: 'BGM_FRAME_RANGE_INVALID',
    })
  }
})

export const bgmDesignClockSchema = z.object({
  fps: z.literal(BGM_DESIGN_FPS),
  sampleRate: z.literal(BGM_DESIGN_SAMPLE_RATE),
  totalFrames: z.number().int().positive(),
}).strict()

export const BGM_PRESENCE_MODES = ['score_on', 'score_off'] as const

export const bgmPresenceSegmentSchema = z.object({
  segmentId: z.string().trim().min(1),
  range: frameRangeSchema,
  mode: z.enum(BGM_PRESENCE_MODES),
  fadeInFrames: z.number().int().min(0).max(120),
  fadeOutFrames: z.number().int().min(0).max(120),
  reason: z.string().trim().min(1),
}).strict().superRefine((segment, ctx) => {
  const durationFrames = segment.range.endFrameExclusive - segment.range.startFrame
  if (segment.fadeInFrames + segment.fadeOutFrames >= durationFrames) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fadeOutFrames'], message: 'BGM_PRESENCE_FADES_TOO_LONG' })
  }
})

export const scoreNarrativeDiagnosisSchema = z.object({
  surfaceEmotion: z.string().trim().min(1),
  trueScoringEmotion: z.string().trim().min(1),
  scoringStance: z.enum([
    'detached_observer',
    'subjective_pressure',
    'empathetic_support',
    'procedural_control',
    'minimal_presence',
  ]),
  avoidEmotions: z.array(z.string().trim().min(1)).min(1),
  musicShouldDo: z.string().trim().min(1),
  musicShouldNotDo: z.string().trim().min(1),
}).strict()

const scoreRegisterSchema = z.enum(['sub', 'low', 'low_mid', 'mid', 'high_mid', 'high'])
const scoreDensitySchema = z.enum(['minimal', 'sparse', 'moderate', 'dense'])
const scoreTechniqueSchema = z.enum([
  'sustained_tone',
  'sul_ponticello',
  'sul_tasto',
  'flautando',
  'harmonic_fingering',
  'bow_pressure_modulation',
  'col_legno_tratto',
  'air_noise',
  'multiphonics',
  'key_click_resonance',
  'sympathetic_resonance',
  'slow_glissando',
  'microtonal_deviation',
])

export const scoreTheoryPhaseSchema = z.object({
  phaseId: z.string().trim().min(1),
  range: frameRangeSchema,
  function: z.enum(['establish', 'transform', 'intensify', 'deplete', 'suspend']),
  energy: z.number().min(0).max(1),
  density: scoreDensitySchema,
  spectralBand: scoreRegisterSchema,
  transientDensity: z.number().min(0).max(1),
}).strict()

export const SCORE_PROHIBITIONS = [
  'vocals',
  'lyrics',
  'spoken_word',
  'literal_sound_effects',
  'environmental_recordings',
  'functional_dominant_tonic',
  'authentic_cadence',
  'heroic_brass',
  'triumphant_rhythm',
  'romantic_swell',
  'cathartic_climax',
  'trailer_impacts',
  'stable_groove',
  'periodic_phrase_cycle',
] as const

export const musicTheorySpecSchema = z.object({
  bpm: z.number().int().min(20).max(260),
  meter: z.enum(['2/4', '3/4', '4/4', '5/4', '6/8', '7/8']),
  form: z.enum(['through_composed', 'continuous_variation']),
  metricSalience: z.enum(['suppressed', 'low', 'moderate', 'explicit']),
  eventSpacing: z.enum(['regular', 'irregular', 'asynchronous', 'stochastic']),
  pitch: z.object({
    centerType: z.enum(['tonal', 'modal', 'weakened_pitch_field', 'atonal']),
    centerPitch: z.string().trim().regex(/^[A-G](?:#|b)?$/).nullable(),
    collection: z.enum(['diatonic', 'modal', 'chromatic_saturation', 'whole_tone_fragments', 'octatonic_fragments', 'evolving_pitch_class_sets']),
    intervalRelations: z.array(z.enum(['minor_second_aggregation', 'major_seventh_tension', 'tritone_polarity', 'quartal_structures', 'quintal_structures', 'sustained_common_tones'])).min(1),
    microtonality: z.enum(['none', 'limited', 'structural']),
  }).strict(),
  harmony: z.object({
    functionalSyntax: z.enum(['prohibited', 'limited', 'allowed']),
    cadencePolicy: z.enum(['no_cadence', 'withhold_tonic', 'deceptive_only', 'open_ending', 'tonal_resolution']),
    harmonicRhythm: z.enum(['static', 'extremely_slow', 'slow', 'moderate']),
  }).strict(),
  voiceLeading: z.array(z.enum(['incremental_micro_motion', 'semitone_displacement', 'sustained_common_tones', 'contrary_motion_expansion', 'gradual_intervallic_transformation'])).min(1),
  texture: z.object({
    organization: z.enum(['sound_mass', 'micropolyphonic', 'independent_sustained_layers', 'sparse_counterpoint', 'homophonic']),
    density: scoreDensitySchema,
    layerIndependence: z.number().min(0).max(1),
  }).strict(),
  spectrum: z.object({
    foundation: z.array(scoreRegisterSchema).min(1),
    upperActivity: z.enum(['absent', 'isolated_partials', 'restricted', 'active']),
    evolution: z.enum(['static', 'gradual_expansion', 'gradual_contraction', 'continuous_redistribution']),
  }).strict(),
  orchestration: z.array(z.object({
    instrument: z.enum([
      'sub_bass_sine', 'contrabass', 'contrabassoon', 'bass_clarinet', 'low_brass',
      'prepared_piano', 'felt_piano', 'muted_string_ensemble', 'string_harmonics',
      'solo_cello', 'solo_viola', 'filtered_analog_synthesizer', 'granular_spectral_texture',
      'controlled_broadband_noise', 'soft_mallets', 'frame_drum',
    ]),
    register: scoreRegisterSchema,
    role: z.enum(['foundation', 'mass', 'motion', 'partial', 'resonance', 'pulse']),
    techniques: z.array(scoreTechniqueSchema).min(1),
  }).strict()).min(1).max(16),
  dynamics: z.object({
    envelope: z.enum(['long_arc', 'slow_oscillation', 'restrained_plateau', 'continuous_redistribution']),
    transientPolicy: z.enum(['suppressed', 'restrained', 'permitted']),
    minimumEnergy: z.number().min(0).max(1),
    maximumEnergy: z.number().min(0).max(1),
  }).strict(),
  phases: z.array(scoreTheoryPhaseSchema).min(1).max(12),
  prohibitions: z.array(z.enum(SCORE_PROHIBITIONS)).min(5),
}).strict().superRefine((spec, ctx) => {
  if (spec.dynamics.maximumEnergy < spec.dynamics.minimumEnergy) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dynamics', 'maximumEnergy'], message: 'BGM_DYNAMIC_RANGE_INVALID' })
  }
  for (const prohibition of ['vocals', 'lyrics', 'spoken_word', 'literal_sound_effects', 'environmental_recordings'] as const) {
    if (!spec.prohibitions.includes(prohibition)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prohibitions'], message: `BGM_REQUIRED_PROHIBITION_MISSING:${prohibition}` })
    }
  }
  if (spec.pitch.centerType === 'atonal' && spec.pitch.centerPitch) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pitch', 'centerPitch'], message: 'BGM_ATONAL_CENTER_NOT_ALLOWED' })
  }
  if (spec.pitch.centerType !== 'atonal' && !spec.pitch.centerPitch) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pitch', 'centerPitch'], message: 'BGM_PITCH_CENTER_REQUIRED' })
  }
  if (spec.harmony.functionalSyntax === 'prohibited' && spec.harmony.cadencePolicy === 'tonal_resolution') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['harmony', 'cadencePolicy'], message: 'BGM_FUNCTIONAL_HARMONY_CONTRADICTION' })
  }
  spec.phases.forEach((phase, index) => {
    if (phase.energy < spec.dynamics.minimumEnergy || phase.energy > spec.dynamics.maximumEnergy) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phases', index, 'energy'], message: 'BGM_PHASE_ENERGY_OUTSIDE_DYNAMIC_RANGE' })
    }
  })
})

export const scoreCueSchema = z.object({
  cueId: z.string().trim().min(1),
  musicalContinuityId: z.string().trim().min(1),
  range: frameRangeSchema,
  narrativeDiagnosis: scoreNarrativeDiagnosisSchema,
  musicTheorySpec: musicTheorySpecSchema,
}).strict().superRefine((cue, ctx) => {
  const phases = cue.musicTheorySpec.phases
  if (phases[0]?.range.startFrame !== cue.range.startFrame || phases[phases.length - 1]?.range.endFrameExclusive !== cue.range.endFrameExclusive) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['musicTheorySpec', 'phases'], message: 'BGM_PHASES_MUST_COVER_CUE' })
  }
  for (let index = 1; index < phases.length; index += 1) {
    if (phases[index - 1]?.range.endFrameExclusive !== phases[index]?.range.startFrame) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['musicTheorySpec', 'phases', index], message: 'BGM_PHASES_NOT_CONTIGUOUS' })
    }
  }
})

export const automationLaneSchema = z.object({
  laneId: z.string().trim().min(1),
  targetBus: z.enum(['score', 'master']),
  keyframes: z.array(z.object({
    frame: z.number().int().min(0),
    valueDb: z.number().finite().min(-120).max(12),
    interpolation: z.enum(['linear', 'smooth', 'equal_power']),
  }).strict()).min(2),
  postBehavior: z.enum(['hold', 'return_to_neutral']),
  reason: z.string().trim().min(1),
}).strict().superRefine((lane, ctx) => {
  for (let index = 1; index < lane.keyframes.length; index += 1) {
    if ((lane.keyframes[index]?.frame ?? 0) <= (lane.keyframes[index - 1]?.frame ?? 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keyframes', index, 'frame'], message: 'BGM_AUTOMATION_KEYFRAMES_NOT_STRICTLY_ASCENDING' })
    }
  }
})

export const bgmDesignSchema = z.object({
  clock: bgmDesignClockSchema,
  scorePresence: z.array(bgmPresenceSegmentSchema).min(1),
  scoreCue: scoreCueSchema,
  automationLanes: z.array(automationLaneSchema),
}).strict().superRefine((design, ctx) => {
  const checkRange = (path: Array<string | number>, range: FrameRange): void => {
    if (range.endFrameExclusive > design.clock.totalFrames) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: 'BGM_TIMELINE_RANGE_OUT_OF_BOUNDS' })
    }
  }
  design.scorePresence.forEach((segment, index) => checkRange(['scorePresence', index, 'range'], segment.range))
  checkRange(['scoreCue', 'range'], design.scoreCue.range)
  design.automationLanes.forEach((lane, laneIndex) => lane.keyframes.forEach((keyframe, keyframeIndex) => {
    if (keyframe.frame >= design.clock.totalFrames) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['automationLanes', laneIndex, 'keyframes', keyframeIndex], message: 'BGM_AUTOMATION_KEYFRAME_OUT_OF_BOUNDS' })
    }
  }))

  const firstPresence = design.scorePresence[0]
  const lastPresence = design.scorePresence[design.scorePresence.length - 1]
  if (firstPresence?.range.startFrame !== 0 || lastPresence?.range.endFrameExclusive !== design.clock.totalFrames) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scorePresence'], message: 'BGM_PRESENCE_COVERAGE_REQUIRED' })
  }
  for (let index = 1; index < design.scorePresence.length; index += 1) {
    if (design.scorePresence[index - 1]?.range.endFrameExclusive !== design.scorePresence[index]?.range.startFrame) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scorePresence', index], message: 'BGM_PRESENCE_NOT_CONTIGUOUS' })
    }
  }
  if (!design.scorePresence.some((segment) => segment.mode === 'score_on')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scorePresence'], message: 'BGM_PRESENCE_REQUIRES_AUDIBLE_RANGE' })
  }
  if (design.scoreCue.range.startFrame !== 0 || design.scoreCue.range.endFrameExclusive !== design.clock.totalFrames) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scoreCue', 'range'], message: 'BGM_CUE_FULL_TIMELINE_REQUIRED' })
  }
})

export type FrameRange = z.infer<typeof frameRangeSchema>
export type BgmDesignClock = z.infer<typeof bgmDesignClockSchema>
export type BgmPresenceMode = z.infer<typeof bgmPresenceSegmentSchema>['mode']
export type BgmPresenceSegment = z.infer<typeof bgmPresenceSegmentSchema>
export type MusicTheorySpec = z.infer<typeof musicTheorySpecSchema>
export type ScoreCue = z.infer<typeof scoreCueSchema>
export type AutomationLane = z.infer<typeof automationLaneSchema>
export type BgmDesign = z.infer<typeof bgmDesignSchema>

export function framesToSeconds(frames: number, clock: BgmDesignClock): number {
  if (!Number.isInteger(frames) || frames < 0) throw new Error('BGM_FRAME_INVALID')
  return frames / clock.fps
}

export function secondsToFrames(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('BGM_SECONDS_INVALID')
  return Math.round(seconds * BGM_DESIGN_FPS)
}
