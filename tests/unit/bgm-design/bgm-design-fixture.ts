import { SCORE_PROHIBITIONS, type BgmDesign } from '@/lib/bgm-design/types'

export function createValidBgmDesign(): BgmDesign {
  return {
    clock: { fps: 24, sampleRate: 48_000, totalFrames: 240 },
    scorePresence: [
      {
        segmentId: 'presence-1',
        range: { startFrame: 0, endFrameExclusive: 120 },
        mode: 'score_on',
        fadeInFrames: 12,
        fadeOutFrames: 12,
        reason: 'BGM supports the opening',
      },
      {
        segmentId: 'presence-2',
        range: { startFrame: 120, endFrameExclusive: 180 },
        mode: 'score_off',
        fadeInFrames: 8,
        fadeOutFrames: 8,
        reason: 'preserve native dialogue without generated BGM',
      },
      {
        segmentId: 'presence-3',
        range: { startFrame: 180, endFrameExclusive: 240 },
        mode: 'score_on',
        fadeInFrames: 8,
        fadeOutFrames: 8,
        reason: 'BGM returns after dialogue',
      },
    ],
    scoreCue: {
      cueId: 'score-1',
      musicalContinuityId: 'score-episode',
      range: { startFrame: 0, endFrameExclusive: 240 },
      narrativeDiagnosis: {
        surfaceEmotion: 'calm',
        trueScoringEmotion: 'contained pressure',
        scoringStance: 'minimal_presence',
        avoidEmotions: ['sentimentality'],
        musicShouldDo: 'maintain restrained pressure',
        musicShouldNotDo: 'literalize synchronized action',
      },
      musicTheorySpec: {
        bpm: 60,
        meter: '4/4',
        form: 'through_composed',
        metricSalience: 'suppressed',
        eventSpacing: 'asynchronous',
        pitch: {
          centerType: 'weakened_pitch_field',
          centerPitch: 'D',
          collection: 'evolving_pitch_class_sets',
          intervalRelations: ['minor_second_aggregation'],
          microtonality: 'limited',
        },
        harmony: {
          functionalSyntax: 'prohibited',
          cadencePolicy: 'no_cadence',
          harmonicRhythm: 'extremely_slow',
        },
        voiceLeading: ['incremental_micro_motion'],
        texture: {
          organization: 'independent_sustained_layers',
          density: 'sparse',
          layerIndependence: 0.8,
        },
        spectrum: {
          foundation: ['low'],
          upperActivity: 'isolated_partials',
          evolution: 'continuous_redistribution',
        },
        orchestration: [{
          instrument: 'filtered_analog_synthesizer',
          register: 'low',
          role: 'foundation',
          techniques: ['sustained_tone'],
        }],
        dynamics: {
          envelope: 'long_arc',
          transientPolicy: 'suppressed',
          minimumEnergy: 0.1,
          maximumEnergy: 0.4,
        },
        phases: [{
          phaseId: 'phase-1',
          range: { startFrame: 0, endFrameExclusive: 240 },
          function: 'establish',
          energy: 0.2,
          density: 'sparse',
          spectralBand: 'low',
          transientDensity: 0.05,
        }],
        prohibitions: [...SCORE_PROHIBITIONS],
      },
    },
    automationLanes: [],
  }
}
