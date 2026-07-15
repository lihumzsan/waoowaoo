import { describe, expect, it } from 'vitest'
import { compileBgmPresenceAutomation } from '@/lib/bgm-design/automation'
import { parseBgmDesignStrict } from '@/lib/bgm-design/contract'
import { assertLyriaPromptSafe, buildLyriaPrompts } from '@/lib/bgm-design/lyria-prompt'
import { resolveScoreDurationConformance, resolveScoreProviderDurationSeconds } from '@/lib/bgm-design/score-duration'
import { bgmDesignSchema } from '@/lib/bgm-design/types'
import { FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY } from '@/lib/ai-providers/fal/models'
import { createValidBgmDesign } from './bgm-design-fixture'

/**
 * Logic Specification
 * Authority: BgmDesign is the only episode generated-audio plan; music duration comes from the production capability registry.
 * Rejects: timeline gaps, legacy environment-audio fields, native-audio automation, optional/missing BGM, and discrete duration declarations.
 * Production entries: bgmDesignSchema, compileBgmPresenceAutomation, buildLyriaPrompts, resolveScoreProviderDurationSeconds.
 * Final oracle: one strict 24 fps/48 kHz BGM design covers the timeline, compiles only a score lane, rejects every legacy environment-audio key, and FAL Lyria accepts exactly the continuous 120–180 second provider range.
 * Command: npx vitest run tests/unit/bgm-design/bgm-design-acceptance.test.ts
 */
describe('BGM-only sound-stage acceptance', () => {
  it('accepts one strict whole-timeline BGM design', () => {
    const design = parseBgmDesignStrict(createValidBgmDesign())
    expect(design.clock).toEqual({ fps: 24, sampleRate: 48_000, totalFrames: 240 })
    expect(design.scorePresence.map((segment) => segment.range)).toEqual([
      { startFrame: 0, endFrameExclusive: 120 },
      { startFrame: 120, endFrameExclusive: 180 },
      { startFrame: 180, endFrameExclusive: 240 },
    ])
    expect(design.scoreCue.range).toEqual({ startFrame: 0, endFrameExclusive: 240 })
  })

  it('fails closed on timeline gaps and every legacy environment-audio contract field', () => {
    const valid = createValidBgmDesign()
    expect(bgmDesignSchema.safeParse({
      ...valid,
      scorePresence: valid.scorePresence.map((segment, index) => index === 1
        ? { ...segment, range: { startFrame: 121, endFrameExclusive: 180 } }
        : segment),
    }).success).toBe(false)
    for (const legacyField of ['soundWorlds', 'acousticTransitions', 'soundPresence', 'ambienceSources', 'scoreCues']) {
      expect(bgmDesignSchema.safeParse({ ...valid, [legacyField]: [] }).success, legacyField).toBe(false)
    }
  })

  it('compiles BGM presence into one score lane and never creates a native or environment-audio lane', () => {
    const design = createValidBgmDesign()
    const lane = compileBgmPresenceAutomation({ presence: design.scorePresence, clock: design.clock })
    expect(lane.targetBus).toBe('score')
    expect(lane.laneId).toBe('score_presence')
    expect(lane.keyframes).toEqual(expect.arrayContaining([
      expect.objectContaining({ frame: 120, valueDb: -120 }),
      expect.objectContaining({ frame: 180, valueDb: 0 }),
    ]))
  })

  it('derives continuous music duration only from the declared 120–180 second capability', () => {
    expect(resolveScoreProviderDurationSeconds({ musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY, targetDurationSeconds: 90 })).toBe(120)
    expect(resolveScoreProviderDurationSeconds({ musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY, targetDurationSeconds: 149.5 })).toBe(149.5)
    expect(resolveScoreProviderDurationSeconds({ musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY, targetDurationSeconds: 180 })).toBe(180)
    expect(() => resolveScoreProviderDurationSeconds({ musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY, targetDurationSeconds: 180.001 }))
      .toThrow('AUDIO_SCORE_DURATION_EXCEEDS_MODEL_RANGE')
    expect(() => resolveScoreProviderDurationSeconds({ musicModel: 'fal::unknown-music-model', targetDurationSeconds: 120 }))
      .toThrow('AUDIO_SCORE_CONTINUOUS_DURATION_CAPABILITY_REQUIRED')
  })

  it('conforms generated music by exact trim or tightly bounded tempo correction', () => {
    expect(resolveScoreDurationConformance({ sourceDurationSeconds: 120, targetDurationSeconds: 90 }))
      .toMatchObject({ method: 'trim', tempoRatio: 1 })
    expect(resolveScoreDurationConformance({ sourceDurationSeconds: 119, targetDurationSeconds: 120 }))
      .toMatchObject({ method: 'tempo', tempoRatio: 119 / 120 })
    expect(() => resolveScoreDurationConformance({ sourceDurationSeconds: 100, targetDurationSeconds: 120 }))
      .toThrow('AUDIO_SCORE_DURATION_CONFORMANCE_OUT_OF_RANGE')
  })

  it('builds a deterministic instrumental prompt that forbids environmental recordings and literal effects', () => {
    const design = createValidBgmDesign()
    const prompts = buildLyriaPrompts({ cue: design.scoreCue, clock: design.clock })
    expect(prompts.prompt).toContain('through composed')
    expect(prompts.prompt).toContain('weakened pitch field')
    expect(prompts.negativePrompt).toContain('non-pitched concrete-source transients')
    expect(prompts.negativePrompt).toContain('non-musical broadband noise beds')
    expect(() => assertLyriaPromptSafe('A blood-soaked literal action cue.'))
      .toThrow('LYRIA_PROMPT_POLICY_VALIDATION_FAILED')
  })
})
