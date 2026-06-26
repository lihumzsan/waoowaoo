import { describe, expect, it } from 'vitest'
import { bgmScorePlanSchema } from '@/lib/bgm-score/types'

const basePlan = {
  durationSeconds: 30,
  creativeBrief: {
    cueType: 'continuous instrumental underscore',
    genre: 'noir crime drama',
    mood: 'restrained tension',
    narrativeFunction: 'connect the edit while staying below dialogue and native video sound',
  },
  scoreDesign: {
    overview: 'A single cohesive cue with sparse harmony, cigarette-smoke noir restraint, and one late swell.',
    sections: [
      {
        category: 'Cue Arc',
        title: 'Cold opening restraint',
        purpose: 'Keep the scene tense without over-scoring.',
        startSec: 0,
        endSec: 18,
        content: 'Slow implied tempo, mostly static harmony, soft brushed texture without literal Foley.',
      },
      {
        category: 'Hit Point',
        title: 'Suspicion turn',
        purpose: 'Support the visual turn without adding a sound effect.',
        startSec: 18,
        endSec: 22,
        content: 'Small dissonant swell and immediate restraint.',
      },
    ],
  },
  virtualLayers: [
    {
      name: 'muted harmonic bed',
      purpose: 'Main continuity and noir color inside the single cue.',
      content: 'Low piano voicings and soft strings, no separate rendered stem.',
    },
  ],
  promptSections: [
    {
      title: 'Core music prompt',
      purpose: 'Condenses the cue strategy.',
      startSec: 0,
      endSec: 30,
      content: 'Generate one continuous noir crime underscore with sparse harmony and restrained tension.',
    },
  ],
  finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 30 seconds. Noir crime drama underscore, restrained tension, sparse low piano and soft strings, slow implied tempo, one subtle dissonant swell at 18 seconds, then return to quiet restraint, leave space for dialogue and native video sound.',
}

describe('bgm score plan schema', () => {
  it('accepts a valid dynamic single-track score plan', () => {
    const result = bgmScorePlanSchema.safeParse(basePlan)
    expect(result.success).toBe(true)
  })

  it('allows film-specific dynamic design categories instead of fixed stem roles', () => {
    const result = bgmScorePlanSchema.safeParse({
      ...basePlan,
      scoreDesign: {
        overview: basePlan.scoreDesign.overview,
        sections: [
          {
            category: 'Romantic Timing',
            title: 'Breath before confession',
            purpose: 'Let the dialogue breathe.',
            startSec: 5,
            endSec: 9,
            content: 'Hold a warm unresolved chord and avoid rhythmic material.',
          },
        ],
      },
      virtualLayers: [
        {
          name: 'soft piano implication',
          purpose: 'Text-only internal layer for emotional shape.',
          content: 'Sparse upper-register piano color, rendered only as part of the final single cue.',
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('rejects empty score design sections', () => {
    const result = bgmScorePlanSchema.safeParse({
      ...basePlan,
      scoreDesign: {
        overview: basePlan.scoreDesign.overview,
        sections: [],
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects design sections outside the plan duration', () => {
    const result = bgmScorePlanSchema.safeParse({
      ...basePlan,
      scoreDesign: {
        ...basePlan.scoreDesign,
        sections: [{ ...basePlan.scoreDesign.sections[0], endSec: 40 }],
      },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message === 'BGM_SCORE_DESIGN_TIMING_OUT_OF_RANGE')).toBe(true)
  })

  it('rejects invalid section time ranges', () => {
    const result = bgmScorePlanSchema.safeParse({
      ...basePlan,
      promptSections: [{ ...basePlan.promptSections[0], startSec: 12, endSec: 10 }],
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message === 'BGM_SCORE_DESIGN_SECTION_INVALID_TIME_RANGE')).toBe(true)
  })

  it('rejects short final prompts because the provider receives only one final prompt', () => {
    const result = bgmScorePlanSchema.safeParse({
      ...basePlan,
      finalPrompt: 'Too short.',
    })

    expect(result.success).toBe(false)
  })
})
