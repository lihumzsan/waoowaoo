import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('model capability dropdown empty state', () => {
  it('renders localized empty guidance when no model options are available', () => {
    const source = readFileSync('src/components/ui/config-modals/ModelCapabilityDropdown.tsx', 'utf8')

    expect(source).toContain('providerGroups.length === 0')
    expect(source).toContain("t('noModelOptions')")
  })
})
