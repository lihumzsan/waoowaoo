import { describe, expect, it } from 'vitest'
import { customIcons } from '@/components/ui/icons/custom'
import { iconRegistry } from '@/components/ui/icons'

describe('app icon registry', () => {
  it('keeps zoom-style search icons mapped to their custom plus variants', () => {
    expect(iconRegistry.searchPlus).toBe(customIcons.searchPlus)
    expect(iconRegistry.searchAdd).toBe(customIcons.searchAdd)
    expect(iconRegistry.searchPlus).not.toBe(iconRegistry.search)
  })
})
