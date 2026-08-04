import { describe, expect, it } from 'vitest'
import {
  capabilitySelectionCommandSchema,
  capabilitySelectionCommandToSelections,
} from '@/lib/ai-registry/capability-selection-command'

describe('capability selection command dynamic keys', () => {
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects unsafe capability field %s',
    (field) => {
      expect(capabilitySelectionCommandSchema.safeParse([{
        modelKey: 'openrouter::example/model',
        field,
        value: true,
      }]).success).toBe(false)
    },
  )

  it('materializes validated selections without an object prototype', () => {
    const command = capabilitySelectionCommandSchema.parse([{
      modelKey: 'openrouter::example/model',
      field: 'quality',
      value: 'high',
    }])
    const selections = capabilitySelectionCommandToSelections(command)

    expect(Object.getPrototypeOf(selections)).toBeNull()
    expect(Object.getPrototypeOf(selections['openrouter::example/model'])).toBeNull()
    expect(selections['openrouter::example/model']).toEqual({ quality: 'high' })
  })
})
