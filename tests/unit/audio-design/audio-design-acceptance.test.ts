import { describe, expect, it } from 'vitest'
import { compileSoundPresenceAutomation } from '@/lib/audio-design/automation'
import { parseAudioDesignStrict } from '@/lib/audio-design/contract'
import { assertLyriaPromptSafe, buildLyriaPrompts } from '@/lib/audio-design/lyria-prompt'
import { resolveScoreDurationConformance, resolveScoreProviderDurationSeconds } from '@/lib/audio-design/score-duration'
import { audioDesignSchema } from '@/lib/audio-design/types'
import { FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY } from '@/lib/ai-providers/fal/models'
import { buildAudioDesignAmbienceGraph } from '@/lib/ambient-sound/mixer'
import { createValidAudioDesign } from './audio-design-fixture'

/**
 * Logic Specification
 * Authority: AudioDesign is the only episode sound-plan contract; model duration comes from the music capability registry.
 * Rejects: split plan semantics, timeline gaps, action sounds in ambience, one-candidate generation, generated audio leaking into native-only ranges, and fixed duration enumerations.
 * Production entries: audioDesignSchema, compileSoundPresenceAutomation, buildLyriaPrompts, resolveScoreProviderDurationSeconds.
 * Oracle: one strict 24 fps/48 kHz design covers the timeline, each ambience source declares two candidates, deterministic lanes mute only generated buses, and FAL Lyria accepts the continuous 120-180 second range.
 * Command: npx vitest run tests/unit/audio-design/audio-design-acceptance.test.ts
 */
describe('unified audio-design acceptance', () => {
  it('accepts one strict whole-timeline design with SoundWorld, SoundPresence, ambience, and score facts', () => {
    const design = parseAudioDesignStrict(createValidAudioDesign())

    expect(design.clock).toEqual({ fps: 24, sampleRate: 48_000, totalFrames: 240 })
    expect(design.soundWorlds).toHaveLength(1)
    expect(design.soundPresence.map((segment) => segment.range)).toEqual([
      { startFrame: 0, endFrameExclusive: 120 },
      { startFrame: 120, endFrameExclusive: 180 },
      { startFrame: 180, endFrameExclusive: 240 },
    ])
    expect(design.ambienceSources).toEqual([
      expect.objectContaining({ role: 'bed', candidateCount: 2, sourceContinuityId: 'room-air' }),
    ])
    expect(design.scoreCues).toEqual([
      expect.objectContaining({ range: { startFrame: 0, endFrameExclusive: 240 } }),
    ])
  })

  it('fails closed on timeline gaps, action-sound ambience, or any candidate count other than two', () => {
    const valid = createValidAudioDesign()
    const gap = {
      ...valid,
      soundPresence: valid.soundPresence.map((segment, index) => index === 1
        ? { ...segment, range: { startFrame: 121, endFrameExclusive: 180 } }
        : segment),
    }
    expect(audioDesignSchema.safeParse(gap).success).toBe(false)

    const actionSound = {
      ...valid,
      ambienceSources: valid.ambienceSources.map((source) => ({
        ...source,
        generationPrompt: 'Steady neutral room tone with distinct footsteps crossing the floor.',
      })),
    }
    expect(audioDesignSchema.safeParse(actionSound).success).toBe(false)

    const oneCandidate = {
      ...valid,
      ambienceSources: valid.ambienceSources.map((source) => ({ ...source, candidateCount: 1 })),
    }
    expect(audioDesignSchema.safeParse(oneCandidate).success).toBe(false)
  })

  it('compiles SoundPresence into generated-bus automation without a native-audio lane', () => {
    const design = createValidAudioDesign()
    const lanes = compileSoundPresenceAutomation({ presence: design.soundPresence, clock: design.clock })

    expect(lanes.map((lane) => lane.targetBus)).toEqual(['ambience', 'score'])
    expect(lanes.some((lane) => lane.targetBus === 'master')).toBe(false)
    for (const lane of lanes) {
      expect(lane.keyframes).toEqual(expect.arrayContaining([
        expect.objectContaining({ frame: 120, valueDb: -120 }),
        expect.objectContaining({ frame: 180, valueDb: 0 }),
      ]))
    }
  })

  it('keeps one ambience playback phase across an acoustic perspective transition', () => {
    const valid = createValidAudioDesign()
    const design = parseAudioDesignStrict({
      ...valid,
      soundWorlds: valid.soundWorlds.map((world) => ({
        ...world,
        perspectives: [
          {
            ...world.perspectives[0],
            perspectiveId: 'perspective-near',
            zoneId: 'room-near',
            range: { startFrame: 0, endFrameExclusive: 120 },
            distance: 'near',
          },
          {
            ...world.perspectives[0],
            perspectiveId: 'perspective-far',
            zoneId: 'room-far',
            range: { startFrame: 120, endFrameExclusive: 240 },
            distance: 'far',
          },
        ],
      })),
      acousticTransitions: [{
        transitionId: 'transition-1',
        sourceContinuityId: 'room-air',
        range: { startFrame: 108, endFrameExclusive: 132 },
        fromZoneId: 'room-near',
        toZoneId: 'room-far',
        transitionType: 'receding_from_source',
        preservePlaybackPhase: true,
      }],
    })
    const source = design.ambienceSources[0]
    const world = design.soundWorlds[0]
    if (!source || !world) throw new Error('TEST_AMBIENCE_FACTS_REQUIRED')
    const graph = buildAudioDesignAmbienceGraph({
      design,
      tracks: [{
        source,
        path: '/tmp/generated-ambience.wav',
        perspectives: world.perspectives,
        transitions: design.acousticTransitions,
      }],
    })

    expect(graph.inputArgs).toEqual([
      '-stream_loop', '-1', '-i', '/tmp/generated-ambience.wav',
      '-stream_loop', '-1', '-i', '/tmp/generated-ambience.wav',
    ])
    expect(graph.filterComplex).toContain('atrim=start_sample=216000')
    expect(graph.filterComplex).toContain('afade=t=out')
    expect(graph.filterComplex).toContain('afade=t=in')
  })

  it('derives continuous music duration only from the declared 120-180 second capability', () => {
    expect(resolveScoreProviderDurationSeconds({
      musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
      targetDurationSeconds: 90,
    })).toBe(120)
    expect(resolveScoreProviderDurationSeconds({
      musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
      targetDurationSeconds: 149.5,
    })).toBe(149.5)
    expect(resolveScoreProviderDurationSeconds({
      musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
      targetDurationSeconds: 180,
    })).toBe(180)
    expect(() => resolveScoreProviderDurationSeconds({
      musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
      targetDurationSeconds: 180.001,
    })).toThrow('AUDIO_SCORE_DURATION_EXCEEDS_MODEL_RANGE')
    expect(() => resolveScoreProviderDurationSeconds({
      musicModel: 'fal::unknown-music-model',
      targetDurationSeconds: 120,
    })).toThrow('AUDIO_SCORE_CONTINUOUS_DURATION_CAPABILITY_REQUIRED')
  })

  it('conforms model audio by exact trim or tightly bounded tempo correction', () => {
    expect(resolveScoreDurationConformance({ sourceDurationSeconds: 120, targetDurationSeconds: 90 }))
      .toMatchObject({ method: 'trim', tempoRatio: 1 })
    expect(resolveScoreDurationConformance({ sourceDurationSeconds: 119, targetDurationSeconds: 120 }))
      .toMatchObject({ method: 'tempo', tempoRatio: 119 / 120 })
    expect(() => resolveScoreDurationConformance({ sourceDurationSeconds: 100, targetDurationSeconds: 120 }))
      .toThrow('AUDIO_SCORE_DURATION_CONFORMANCE_OUT_OF_RANGE')
  })

  it('builds a deterministic music-theory prompt and rejects narrative-danger leakage', () => {
    const design = createValidAudioDesign()
    const cue = design.scoreCues[0]
    if (!cue) throw new Error('TEST_SCORE_CUE_REQUIRED')
    const prompts = buildLyriaPrompts({ cue, clock: design.clock })

    expect(prompts.prompt).toContain('through composed')
    expect(prompts.prompt).toContain('weakened pitch field')
    expect(prompts.negativePrompt).toContain('pitched vocal timbres')
    expect(prompts.negativePrompt).toContain('non-musical broadband noise beds')
    expect(() => assertLyriaPromptSafe('A blood-soaked literal action cue.'))
      .toThrow('LYRIA_PROMPT_POLICY_VALIDATION_FAILED')
  })
})
