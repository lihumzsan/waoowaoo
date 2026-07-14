import type { TaskJobData } from '@/lib/task/types'
import type { AudioDesignPlanningInput } from './planning-input'
import { SCORE_PROHIBITIONS, SOUND_PRESENCE_MODES } from './types'

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

export function buildAudioDesignPlanPrompt(input: {
  readonly planningInput: AudioDesignPlanningInput
  readonly locale: TaskJobData['locale']
}): string {
  const outputExample = {
    clock: input.planningInput.clock,
    soundWorlds: [{
      worldId: 'world_1', continuityKey: 'place_time_weather_sources', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames },
      location: 'location', timeContext: 'time', weatherContext: null, persistentSourceIds: ['source_air'],
      perspectives: [{ perspectiveId: 'perspective_1', zoneId: 'zone_1', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames }, enclosure: 'enclosed', distance: 'medium', occlusion: 0.2, description: 'acoustic perspective' }],
    }],
    acousticTransitions: [],
    soundPresence: [{ segmentId: 'presence_1', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames }, mode: 'ambience_and_score', fadeInFrames: 12, fadeOutFrames: 12, reason: 'narrative and dialogue-safe layer choice' }],
    ambienceSources: [{ sourceId: 'ambience_1', sourceContinuityId: 'source_air', worldId: 'world_1', role: 'bed', playbackType: 'seamless_loop', semanticRole: 'neutral room air', baseGainDb: -14, salience: 0.15, spectralRole: 'broadband', foregroundPolicy: 'background_only', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames }, generationPrompt: 'Steady neutral interior room tone with soft ventilation, no people and no distinct actions.', promptInfluence: 0.7, candidateCount: 2, loopDurationSeconds: 20, crossfadeFrames: 12, phaseOffsetFrames: 0 }],
    scoreCues: [{
      cueId: 'score_1', musicalContinuityId: 'score_episode', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames },
      narrativeDiagnosis: { surfaceEmotion: 'surface', trueScoringEmotion: 'scoring emotion', scoringStance: 'minimal_presence', avoidEmotions: ['sentimentality'], musicShouldDo: 'shape pressure', musicShouldNotDo: 'literalize action' },
      musicTheorySpec: {
        bpm: 60, meter: '4/4', form: 'through_composed', metricSalience: 'suppressed', eventSpacing: 'asynchronous',
        pitch: { centerType: 'weakened_pitch_field', centerPitch: 'D', collection: 'evolving_pitch_class_sets', intervalRelations: ['minor_second_aggregation'], microtonality: 'limited' },
        harmony: { functionalSyntax: 'prohibited', cadencePolicy: 'no_cadence', harmonicRhythm: 'extremely_slow' },
        voiceLeading: ['incremental_micro_motion'], texture: { organization: 'independent_sustained_layers', density: 'sparse', layerIndependence: 0.8 },
        spectrum: { foundation: ['low'], upperActivity: 'isolated_partials', evolution: 'continuous_redistribution' },
        orchestration: [{ instrument: 'filtered_analog_synthesizer', register: 'low', role: 'foundation', techniques: ['sustained_tone'] }],
        dynamics: { envelope: 'long_arc', transientPolicy: 'suppressed', minimumEnergy: 0.1, maximumEnergy: 0.4 },
        phases: [{ phaseId: 'phase_1', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames }, function: 'establish', energy: 0.2, density: 'sparse', spectralBand: 'low', transientDensity: 0.05 }],
        prohibitions: [...SCORE_PROHIBITIONS],
      }, intentionalSilenceRanges: [],
    }],
    automationLanes: [{ laneId: 'master_arc', targetBus: 'master', targetSourceId: null, keyframes: [{ frame: 0, valueDb: -3, interpolation: 'smooth' }, { frame: input.planningInput.clock.totalFrames - 1, valueDb: -3, interpolation: 'smooth' }], postBehavior: 'hold', reason: 'stable headroom', sourceEventId: null }],
  }
  const language = input.locale === 'zh' ? 'Use concise English in generationPrompt; other descriptions may be Chinese.' : 'Use concise English throughout.'
  return [
    'Create one strict episode-level AudioDesign JSON object.',
    'Authority boundary: use ONLY the locked edit-script facts and rendered clip identity/duration metadata below.',
    'Do not inspect, infer from, request, or claim analysis of video frames, native audio waveforms, final video, or final mix.',
    'The clock is immutable: 24 fps and 48000 Hz. Copy it exactly.',
    `SoundPresence modes are exactly: ${SOUND_PRESENCE_MODES.join(', ')}. They control generated ambience/score only; native dialogue and synchronized action audio is always preserved. intentional_silence means no generated layer, never mute native audio.`,
    'SoundWorlds and SoundPresence must each be contiguous and cover every frame exactly once.',
    `Every SoundWorld start must be one of these script-confirmed boundary frames: ${input.planningInput.soundWorldBoundaryFrames.join(', ')}. Camera cuts alone never create a new SoundWorld.`,
    'A world that uses ambience must have a low-salience bed covering the whole world. Persistent physical sources keep one sourceContinuityId and playback phase across perspective changes.',
    'Ambience prompts describe only neutral environmental ambience. Do not include dialogue, footsteps, impacts, doors, weapons, movement, or other synchronized action sounds. Every source has exactly candidateCount=2.',
    'Use zero or one score cue. When present it must span the entire timeline and be through-composed or continuous variation, with exact theory fields and all five required prohibitions: vocals, lyrics, spoken_word, literal_sound_effects, environmental_recordings.',
    'Do not include provider names, story violence, literal action, character names, dialogue, or plot text in music prompts/specification fields.',
    'Acoustic transitions must preservePlaybackPhase=true. Do not duplicate transition gain changes in automationLanes.',
    language,
    'Return JSON only. No markdown. No extra keys. Match this exact structural example and allowed enum spellings:',
    json(outputExample),
    'LOCKED_TIMELINE_METADATA:',
    json({ clock: input.planningInput.clock, clips: input.planningInput.clips }),
    'LOCKED_EDIT_SCRIPT_FACTS:',
    json(input.planningInput.scriptShots),
  ].join('\n\n')
}
