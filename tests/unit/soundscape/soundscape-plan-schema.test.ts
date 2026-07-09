import { describe, expect, it } from 'vitest'
import { soundscapePlanSchema } from '@/lib/soundscape/types'

const validPlan = {
  schemaVersion: 1,
  decision: 'soundscape',
  sources: [{
    sourceId: 'city_wind',
    environmentFingerprint: 'night_city_rooftop_wind',
    prompt: 'Seamless loop of steady rooftop wind with distant city hum, no music, no voices.',
    loopDurationSeconds: 30,
    promptInfluence: 0.55,
  }],
  sections: [{
    sourceId: 'city_wind',
    fromShotId: 'shot_001',
    toShotId: 'shot_003',
    perspective: 'exterior_near',
    intensity: 'medium',
    transitionIn: 'fade',
    transitionOut: 'crossfade',
  }],
} as const

function parseFails(value: unknown): string {
  const result = soundscapePlanSchema.safeParse(value)
  expect(result.success).toBe(false)
  if (result.success) throw new Error('Expected soundscape plan parse to fail')
  return result.error.issues.map((issue) => issue.message).join('|')
}

describe('soundscape plan schema', () => {
  it('accepts a shot-anchored soundscape plan with closed enum values', () => {
    const result = soundscapePlanSchema.safeParse(validPlan)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Expected valid plan')
    expect(result.data.sections[0]).toEqual({
      sourceId: 'city_wind',
      fromShotId: 'shot_001',
      toShotId: 'shot_003',
      perspective: 'exterior_near',
      intensity: 'medium',
      transitionIn: 'fade',
      transitionOut: 'crossfade',
    })
  })

  it('rejects unknown perspective/intensity/transition values', () => {
    const messages = parseFails({
      ...validPlan,
      sections: [{
        ...validPlan.sections[0],
        perspective: 'underwater',
        intensity: 'extreme',
        transitionIn: 'slow_ramp',
      }],
    })

    expect(messages).toContain('Invalid option')
  })

  it('rejects absolute-second fields from the LLM output', () => {
    const messages = parseFails({
      ...validPlan,
      sections: [{
        ...validPlan.sections[0],
        startSec: 12,
        endSec: 38,
      }],
    })

    expect(messages).toContain('Unrecognized keys')
  })

  it('rejects sections that reference a missing source', () => {
    const messages = parseFails({
      ...validPlan,
      sections: [{
        ...validPlan.sections[0],
        sourceId: 'missing_source',
      }],
    })

    expect(messages).toContain('SOUNDSCAPE_SECTION_SOURCE_UNKNOWN')
  })

  it('requires none_needed plans to have no sources or sections', () => {
    const messages = parseFails({
      ...validPlan,
      decision: 'none_needed',
    })

    expect(messages).toContain('SOUNDSCAPE_NONE_NEEDED_SOURCES_NOT_ALLOWED')
    expect(messages).toContain('SOUNDSCAPE_NONE_NEEDED_SECTIONS_NOT_ALLOWED')
  })
})
