import { z } from 'zod'
import { findAmbiencePromptPolicyViolation } from './ambience-prompt-policy'

export const AUDIO_DESIGN_FPS = 24 as const
export const AUDIO_DESIGN_SAMPLE_RATE = 48_000 as const
export const AUDIO_DESIGN_MAX_AMBIENCE_SOURCE_COUNT = 12 as const

export const AUDIO_DESIGN_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  FAILED: 'failed',
} as const

export type AudioDesignStatus = (typeof AUDIO_DESIGN_STATUS)[keyof typeof AUDIO_DESIGN_STATUS]

export const frameRangeSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrameExclusive: z.number().int().positive(),
}).strict().superRefine((range, ctx) => {
  if (range.endFrameExclusive <= range.startFrame) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endFrameExclusive'],
      message: 'AUDIO_FRAME_RANGE_INVALID',
    })
  }
})

export const audioDesignClockSchema = z.object({
  fps: z.literal(AUDIO_DESIGN_FPS),
  sampleRate: z.literal(AUDIO_DESIGN_SAMPLE_RATE),
  totalFrames: z.number().int().positive(),
}).strict()

export const acousticPerspectiveSchema = z.object({
  perspectiveId: z.string().trim().min(1),
  zoneId: z.string().trim().min(1),
  range: frameRangeSchema,
  enclosure: z.enum(['open', 'semi_open', 'enclosed']),
  distance: z.enum(['near', 'medium', 'far']),
  occlusion: z.number().min(0).max(1),
  description: z.string().trim().min(1),
}).strict()

export const soundWorldSchema = z.object({
  worldId: z.string().trim().min(1),
  continuityKey: z.string().trim().min(1),
  range: frameRangeSchema,
  location: z.string().trim().min(1),
  timeContext: z.string().trim().min(1),
  weatherContext: z.string().trim().min(1).nullable(),
  persistentSourceIds: z.array(z.string().trim().min(1)),
  perspectives: z.array(acousticPerspectiveSchema).min(1),
}).strict().superRefine((world, ctx) => {
  const first = world.perspectives[0]
  const last = world.perspectives[world.perspectives.length - 1]
  if (first?.range.startFrame !== world.range.startFrame || last?.range.endFrameExclusive !== world.range.endFrameExclusive) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['perspectives'], message: 'AUDIO_PERSPECTIVE_WORLD_COVERAGE_REQUIRED' })
  }
  for (let index = 1; index < world.perspectives.length; index += 1) {
    if (world.perspectives[index - 1]?.range.endFrameExclusive !== world.perspectives[index]?.range.startFrame) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['perspectives', index], message: 'AUDIO_PERSPECTIVES_NOT_CONTIGUOUS' })
    }
  }
})

export const acousticTransitionSchema = z.object({
  transitionId: z.string().trim().min(1),
  sourceContinuityId: z.string().trim().min(1),
  range: frameRangeSchema,
  fromZoneId: z.string().trim().min(1),
  toZoneId: z.string().trim().min(1),
  transitionType: z.enum([
    'entering_enclosure',
    'exiting_enclosure',
    'approaching_source',
    'receding_from_source',
    'occlusion_increasing',
    'occlusion_decreasing',
    'portal_opening',
    'portal_closing',
    'room_to_room',
    'perspective_shift',
  ]),
  preservePlaybackPhase: z.literal(true),
}).strict()

export const SOUND_PRESENCE_MODES = [
  'native_only',
  'ambience_only',
  'score_only',
  'ambience_and_score',
  'intentional_silence',
] as const

export const soundPresenceSegmentSchema = z.object({
  segmentId: z.string().trim().min(1),
  range: frameRangeSchema,
  mode: z.enum(SOUND_PRESENCE_MODES),
  fadeInFrames: z.number().int().min(0).max(120),
  fadeOutFrames: z.number().int().min(0).max(120),
  reason: z.string().trim().min(1),
}).strict().superRefine((segment, ctx) => {
  const durationFrames = segment.range.endFrameExclusive - segment.range.startFrame
  if (segment.fadeInFrames + segment.fadeOutFrames >= durationFrames) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fadeOutFrames'], message: 'AUDIO_SOUND_PRESENCE_FADES_TOO_LONG' })
  }
})

export const ambienceSourceSchema = z.object({
  sourceId: z.string().trim().min(1),
  sourceContinuityId: z.string().trim().min(1),
  worldId: z.string().trim().min(1),
  role: z.enum(['bed', 'detail', 'ambient_event']),
  playbackType: z.enum(['seamless_loop', 'ambient_event', 'continuous_evolving']),
  semanticRole: z.string().trim().min(1),
  baseGainDb: z.number().finite().min(-24).max(3),
  salience: z.number().min(0).max(1),
  spectralRole: z.enum(['sub', 'low', 'low_mid', 'mid', 'high_mid', 'high', 'broadband']),
  foregroundPolicy: z.enum(['background_only', 'contextual_detail', 'event_focus']),
  range: frameRangeSchema,
  generationPrompt: z.string().trim().min(20),
  promptInfluence: z.number().min(0).max(1),
  candidateCount: z.literal(2),
  loopDurationSeconds: z.number().min(1).max(22),
  crossfadeFrames: z.number().int().min(0).max(48),
  phaseOffsetFrames: z.number().int().min(0),
}).strict().superRefine((source, ctx) => {
  const violation = findAmbiencePromptPolicyViolation(source.generationPrompt)
  if (violation) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['generationPrompt'],
      message: `AUDIO_AMBIENCE_PROMPT_ACTION_SOUND_FORBIDDEN:${violation}`,
    })
  }
  if (source.role === 'bed' && (source.baseGainDb > -8 || source.salience > 0.35 || source.foregroundPolicy !== 'background_only')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseGainDb'], message: 'AUDIO_AMBIENCE_BED_HIERARCHY_INVALID' })
  }
  if (source.role === 'detail' && source.foregroundPolicy === 'event_focus') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['foregroundPolicy'], message: 'AUDIO_AMBIENCE_DETAIL_FOREGROUND_POLICY_INVALID' })
  }
  if (source.role === 'ambient_event' && source.playbackType !== 'ambient_event') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['playbackType'], message: 'AUDIO_AMBIENCE_EVENT_PLAYBACK_TYPE_REQUIRED' })
  }
  if (source.playbackType === 'seamless_loop' && source.crossfadeFrames <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['crossfadeFrames'], message: 'AUDIO_AMBIENCE_LOOP_CROSSFADE_REQUIRED' })
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dynamics', 'maximumEnergy'], message: 'AUDIO_SCORE_DYNAMIC_RANGE_INVALID' })
  }
  for (const prohibition of ['vocals', 'lyrics', 'spoken_word', 'literal_sound_effects', 'environmental_recordings'] as const) {
    if (!spec.prohibitions.includes(prohibition)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prohibitions'], message: `AUDIO_SCORE_REQUIRED_PROHIBITION_MISSING:${prohibition}` })
    }
  }
  if (spec.pitch.centerType === 'atonal' && spec.pitch.centerPitch) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pitch', 'centerPitch'], message: 'AUDIO_SCORE_ATONAL_CENTER_NOT_ALLOWED' })
  }
  if (spec.pitch.centerType !== 'atonal' && !spec.pitch.centerPitch) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pitch', 'centerPitch'], message: 'AUDIO_SCORE_PITCH_CENTER_REQUIRED' })
  }
  if (spec.harmony.functionalSyntax === 'prohibited' && spec.harmony.cadencePolicy === 'tonal_resolution') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['harmony', 'cadencePolicy'], message: 'AUDIO_SCORE_FUNCTIONAL_HARMONY_CONTRADICTION' })
  }
  spec.phases.forEach((phase, index) => {
    if (phase.energy < spec.dynamics.minimumEnergy || phase.energy > spec.dynamics.maximumEnergy) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phases', index, 'energy'], message: 'AUDIO_SCORE_PHASE_ENERGY_OUTSIDE_DYNAMIC_RANGE' })
    }
  })
})

export const scoreCueSchema = z.object({
  cueId: z.string().trim().min(1),
  musicalContinuityId: z.string().trim().min(1),
  range: frameRangeSchema,
  narrativeDiagnosis: scoreNarrativeDiagnosisSchema,
  musicTheorySpec: musicTheorySpecSchema,
  intentionalSilenceRanges: z.array(frameRangeSchema),
}).strict().superRefine((cue, ctx) => {
  const phases = cue.musicTheorySpec.phases
  if (phases[0]?.range.startFrame !== cue.range.startFrame || phases[phases.length - 1]?.range.endFrameExclusive !== cue.range.endFrameExclusive) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['musicTheorySpec', 'phases'], message: 'AUDIO_SCORE_PHASES_MUST_COVER_CUE' })
  }
  for (let index = 1; index < phases.length; index += 1) {
    if (phases[index - 1]?.range.endFrameExclusive !== phases[index]?.range.startFrame) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['musicTheorySpec', 'phases', index], message: 'AUDIO_SCORE_PHASES_NOT_CONTIGUOUS' })
    }
  }
})

export const automationLaneSchema = z.object({
  laneId: z.string().trim().min(1),
  targetBus: z.enum(['ambience', 'score', 'master']),
  targetSourceId: z.string().trim().min(1).nullable(),
  keyframes: z.array(z.object({
    frame: z.number().int().min(0),
    valueDb: z.number().finite().min(-120).max(12),
    interpolation: z.enum(['linear', 'smooth', 'equal_power']),
  }).strict()).min(2),
  postBehavior: z.enum(['hold', 'return_to_neutral']),
  reason: z.string().trim().min(1),
  sourceEventId: z.string().trim().min(1).nullable(),
}).strict().superRefine((lane, ctx) => {
  for (let index = 1; index < lane.keyframes.length; index += 1) {
    if ((lane.keyframes[index]?.frame ?? 0) <= (lane.keyframes[index - 1]?.frame ?? 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keyframes', index, 'frame'], message: 'AUDIO_AUTOMATION_KEYFRAMES_NOT_STRICTLY_ASCENDING' })
    }
  }
})

function usesAmbience(mode: SoundPresenceMode): boolean {
  return mode === 'ambience_only' || mode === 'ambience_and_score'
}

function usesScore(mode: SoundPresenceMode): boolean {
  return mode === 'score_only' || mode === 'ambience_and_score'
}

export const audioDesignSchema = z.object({
  clock: audioDesignClockSchema,
  soundWorlds: z.array(soundWorldSchema).min(1),
  acousticTransitions: z.array(acousticTransitionSchema),
  soundPresence: z.array(soundPresenceSegmentSchema).min(1),
  ambienceSources: z.array(ambienceSourceSchema).max(AUDIO_DESIGN_MAX_AMBIENCE_SOURCE_COUNT),
  scoreCues: z.array(scoreCueSchema).max(1),
  automationLanes: z.array(automationLaneSchema),
}).strict().superRefine((design, ctx) => {
  const checkRange = (path: Array<string | number>, range: FrameRange): void => {
    if (range.endFrameExclusive > design.clock.totalFrames) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: 'AUDIO_TIMELINE_RANGE_OUT_OF_BOUNDS' })
    }
  }
  design.soundWorlds.forEach((world, index) => {
    checkRange(['soundWorlds', index, 'range'], world.range)
    world.perspectives.forEach((perspective, perspectiveIndex) => checkRange(['soundWorlds', index, 'perspectives', perspectiveIndex, 'range'], perspective.range))
  })
  design.acousticTransitions.forEach((transition, index) => checkRange(['acousticTransitions', index, 'range'], transition.range))
  design.soundPresence.forEach((segment, index) => checkRange(['soundPresence', index, 'range'], segment.range))
  design.ambienceSources.forEach((source, index) => checkRange(['ambienceSources', index, 'range'], source.range))
  design.scoreCues.forEach((cue, index) => checkRange(['scoreCues', index, 'range'], cue.range))
  design.automationLanes.forEach((lane, laneIndex) => lane.keyframes.forEach((keyframe, keyframeIndex) => {
    if (keyframe.frame >= design.clock.totalFrames) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['automationLanes', laneIndex, 'keyframes', keyframeIndex], message: 'AUDIO_AUTOMATION_KEYFRAME_OUT_OF_BOUNDS' })
    }
  }))

  const firstWorld = design.soundWorlds[0]
  const lastWorld = design.soundWorlds[design.soundWorlds.length - 1]
  if (firstWorld?.range.startFrame !== 0 || lastWorld?.range.endFrameExclusive !== design.clock.totalFrames) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['soundWorlds'], message: 'AUDIO_SOUND_WORLD_COVERAGE_REQUIRED' })
  }
  for (let index = 1; index < design.soundWorlds.length; index += 1) {
    if (design.soundWorlds[index - 1]?.range.endFrameExclusive !== design.soundWorlds[index]?.range.startFrame) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['soundWorlds', index], message: 'AUDIO_SOUND_WORLDS_NOT_CONTIGUOUS' })
    }
  }
  const firstPresence = design.soundPresence[0]
  const lastPresence = design.soundPresence[design.soundPresence.length - 1]
  if (firstPresence?.range.startFrame !== 0 || lastPresence?.range.endFrameExclusive !== design.clock.totalFrames) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['soundPresence'], message: 'AUDIO_SOUND_PRESENCE_COVERAGE_REQUIRED' })
  }
  for (let index = 1; index < design.soundPresence.length; index += 1) {
    if (design.soundPresence[index - 1]?.range.endFrameExclusive !== design.soundPresence[index]?.range.startFrame) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['soundPresence', index], message: 'AUDIO_SOUND_PRESENCE_NOT_CONTIGUOUS' })
    }
  }

  const scoreRequired = design.soundPresence.some((segment) => usesScore(segment.mode))
  if (design.scoreCues.length !== (scoreRequired ? 1 : 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scoreCues'], message: 'AUDIO_SCORE_PRESENCE_MISMATCH' })
  }
  const scoreCue = design.scoreCues[0]
  if (scoreCue && (scoreCue.range.startFrame !== 0 || scoreCue.range.endFrameExclusive !== design.clock.totalFrames)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scoreCues', 0, 'range'], message: 'AUDIO_SCORE_CUE_FULL_TIMELINE_REQUIRED' })
  }

  const worldById = new Map(design.soundWorlds.map((world) => [world.worldId, world]))
  const sourceByContinuityId = new Map<string, AmbienceSource[]>()
  for (const source of design.ambienceSources) {
    const world = worldById.get(source.worldId)
    if (!world) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ambienceSources'], message: `AUDIO_AMBIENCE_WORLD_MISSING:${source.sourceId}` })
      continue
    }
    const grouped = sourceByContinuityId.get(source.sourceContinuityId) ?? []
    grouped.push(source)
    sourceByContinuityId.set(source.sourceContinuityId, grouped)
    if (source.role !== 'ambient_event' && !world.persistentSourceIds.includes(source.sourceContinuityId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ambienceSources'], message: `AUDIO_AMBIENCE_PERSISTENT_SOURCE_UNDECLARED:${source.sourceId}` })
    }
    if (source.role === 'bed' && (source.range.startFrame > world.range.startFrame || source.range.endFrameExclusive < world.range.endFrameExclusive)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ambienceSources'], message: `AUDIO_AMBIENCE_BED_WORLD_COVERAGE_REQUIRED:${source.sourceId}` })
    }
  }
  for (const world of design.soundWorlds) {
    const needsAmbience = design.soundPresence.some((segment) => (
      usesAmbience(segment.mode)
      && segment.range.startFrame < world.range.endFrameExclusive
      && world.range.startFrame < segment.range.endFrameExclusive
    ))
    const worldSources = design.ambienceSources.filter((source) => source.worldId === world.worldId)
    if (needsAmbience && !worldSources.some((source) => source.role === 'bed')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['soundWorlds'], message: `AUDIO_SOUND_WORLD_BED_REQUIRED:${world.worldId}` })
    }
    if (!needsAmbience && worldSources.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ambienceSources'], message: `AUDIO_AMBIENCE_SOURCE_WITHOUT_PRESENCE:${world.worldId}` })
    }
  }

  const transitionIds = new Set(design.acousticTransitions.map((transition) => transition.transitionId))
  for (const transition of design.acousticTransitions) {
    const sources = sourceByContinuityId.get(transition.sourceContinuityId) ?? []
    if (sources.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acousticTransitions'], message: `AUDIO_TRANSITION_SOURCE_IDENTITY_REQUIRED:${transition.transitionId}` })
      continue
    }
    const source = sources[0]
    const world = source ? worldById.get(source.worldId) : null
    const zones = new Set(world?.perspectives.map((perspective) => perspective.zoneId) ?? [])
    if (!source || source.range.startFrame > transition.range.startFrame || source.range.endFrameExclusive < transition.range.endFrameExclusive) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acousticTransitions'], message: `AUDIO_TRANSITION_SOURCE_COVERAGE_REQUIRED:${transition.transitionId}` })
    }
    if (!zones.has(transition.fromZoneId) || !zones.has(transition.toZoneId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acousticTransitions'], message: `AUDIO_TRANSITION_ZONE_COVERAGE_REQUIRED:${transition.transitionId}` })
    }
  }
  for (const lane of design.automationLanes) {
    if (lane.targetBus === 'ambience' && lane.sourceEventId && transitionIds.has(lane.sourceEventId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['automationLanes'], message: `AUDIO_TRANSITION_DUPLICATE_GAIN_AUTOMATION:${lane.laneId}` })
    }
  }
})

export type FrameRange = z.infer<typeof frameRangeSchema>
export type AudioDesignClock = z.infer<typeof audioDesignClockSchema>
export type AcousticPerspective = z.infer<typeof acousticPerspectiveSchema>
export type SoundWorld = z.infer<typeof soundWorldSchema>
export type AcousticTransition = z.infer<typeof acousticTransitionSchema>
export type SoundPresenceMode = z.infer<typeof soundPresenceSegmentSchema>['mode']
export type SoundPresenceSegment = z.infer<typeof soundPresenceSegmentSchema>
export type AmbienceSource = z.infer<typeof ambienceSourceSchema>
export type MusicTheorySpec = z.infer<typeof musicTheorySpecSchema>
export type ScoreCue = z.infer<typeof scoreCueSchema>
export type AutomationLane = z.infer<typeof automationLaneSchema>
export type AudioDesign = z.infer<typeof audioDesignSchema>

export function framesToSeconds(frames: number, clock: AudioDesignClock): number {
  if (!Number.isInteger(frames) || frames < 0) throw new Error('AUDIO_FRAME_INVALID')
  return frames / clock.fps
}

export function secondsToFrames(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('AUDIO_SECONDS_INVALID')
  return Math.round(seconds * AUDIO_DESIGN_FPS)
}

export function frameToSample(frame: number, clock: AudioDesignClock): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error('AUDIO_FRAME_INVALID')
  return Math.round(frame * clock.sampleRate / clock.fps)
}

export function soundPresenceUsesAmbience(mode: SoundPresenceMode): boolean {
  return usesAmbience(mode)
}

export function soundPresenceUsesScore(mode: SoundPresenceMode): boolean {
  return usesScore(mode)
}
