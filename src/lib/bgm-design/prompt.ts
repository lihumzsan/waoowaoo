import type { TaskJobData } from '@/lib/task/types'
import type { BgmDesignPlanningInput } from './planning-input'
import { BGM_PRESENCE_MODES, SCORE_PROHIBITIONS } from './types'

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

export function buildBgmDesignPlanPrompt(input: {
  readonly planningInput: BgmDesignPlanningInput
  readonly locale: TaskJobData['locale']
}): string {
  const outputExample = {
    clock: input.planningInput.clock,
    scorePresence: [{ segmentId: 'presence_1', range: { startFrame: 0, endFrameExclusive: input.planningInput.clock.totalFrames }, mode: 'score_on', fadeInFrames: 12, fadeOutFrames: 12, reason: 'narrative and dialogue-safe BGM choice' }],
    scoreCue: {
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
      },
    },
    automationLanes: [{ laneId: 'master_arc', targetBus: 'master', keyframes: [{ frame: 0, valueDb: -3, interpolation: 'smooth' }, { frame: input.planningInput.clock.totalFrames - 1, valueDb: -3, interpolation: 'smooth' }], postBehavior: 'hold', reason: 'stable headroom' }],
  }
  const language = input.locale === 'zh' ? 'Descriptions may be Chinese.' : 'Use concise English throughout.'
  return [
    'Create one strict episode-level BgmDesign JSON object.',
    'Authority boundary: use ONLY the locked edit-script facts and rendered clip identity/duration metadata below.',
    'Do not inspect, infer from, request, or claim analysis of video frames, native audio waveforms, final video, or final mix.',
    'Do not create environmental ambience, room tone, foley, synchronized effects, dialogue, vocals, lyrics, spoken word, or literal sound effects. This system generates BGM only; native clip audio is preserved separately.',
    'The clock is immutable: 24 fps and 48000 Hz. Copy it exactly.',
    `scorePresence modes are exactly: ${BGM_PRESENCE_MODES.join(', ')}. They control generated BGM only and must cover every frame exactly once. Native clip audio is never muted by these modes.`,
    'Provide exactly one scoreCue spanning the entire timeline. It must be through-composed or continuous variation, with exact theory fields and every listed prohibition.',
    'Do not include provider names, story violence, literal action, character names, dialogue, plot text, environmental recordings, or sound effects in music fields.',
    language,
    'Return JSON only. No markdown. No extra keys. Match this exact structural example and allowed enum spellings:',
    json(outputExample),
    'LOCKED_TIMELINE_METADATA:',
    json({ clock: input.planningInput.clock, clips: input.planningInput.clips }),
    'LOCKED_EDIT_SCRIPT_FACTS:',
    json(input.planningInput.scriptShots),
  ].join('\n\n')
}
