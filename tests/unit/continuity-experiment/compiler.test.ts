import { describe, expect, it } from 'vitest'
import { compileContinuityExperimentCell } from '@/lib/continuity-experiment/compiler'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EXPECTED_RECORD')
  }
  return value as Record<string, unknown>
}

describe('continuity experiment compiler', () => {
  it('keeps the baseline packet free of spatial and adjacent-state fields', () => {
    const result = compileContinuityExperimentCell({
      locale: 'zh',
      storyId: 'elevator',
      variantId: 'baseline',
      shotId: 'e4',
    })
    const packet = asRecord(result.packet)

    expect(packet.protocol).toBe('baseline_independent_panel')
    expect(packet).not.toHaveProperty('topology')
    expect(packet).not.toHaveProperty('cameraVantage')
    expect(packet).not.toHaveProperty('stateBefore')
    expect(packet).not.toHaveProperty('stateDelta')
    expect(packet).not.toHaveProperty('stateAfter')
  })

  it('adds topology without adjacent-state history to the spatial variant', () => {
    const result = compileContinuityExperimentCell({
      locale: 'en',
      storyId: 'restaurant',
      variantId: 'spatial',
      shotId: 'r3',
    })
    const packet = asRecord(result.packet)
    const vantage = asRecord(packet.cameraVantage)

    expect(packet.protocol).toBe('camera_independent_topology')
    expect(packet.topology).toEqual(expect.arrayContaining([
      'table_7 is centered between west banquette and east aisle',
    ]))
    expect(vantage.id).toBe('R_D')
    expect(packet).toHaveProperty('renderState')
    expect(packet).not.toHaveProperty('stateBefore')
    expect(packet).not.toHaveProperty('stateDelta')
  })

  it('compiles singular ownership and before/delta/after for the full variant', () => {
    const result = compileContinuityExperimentCell({
      locale: 'zh',
      storyId: 'warehouse',
      variantId: 'continuity',
      shotId: 'w5',
    })
    const packet = asRecord(result.packet)

    expect(packet.protocol).toBe('full_text_continuity')
    expect(packet).toHaveProperty('referenceBindings')
    expect(packet).toHaveProperty('stateBefore')
    expect(packet.stateDelta).toContain('no duplicate case')
    expect(packet).toHaveProperty('stateAfter')
    expect(result.prompt).toContain('实验数据包')
    expect(result.prompt).toContain('Kai.right_hand')
  })

  it('fails closed for an unknown shot', () => {
    expect(() => compileContinuityExperimentCell({
      locale: 'zh',
      storyId: 'elevator',
      variantId: 'continuity',
      shotId: 'missing',
    })).toThrow('CONTINUITY_EXPERIMENT_SHOT_NOT_FOUND:elevator:missing')
  })
})
