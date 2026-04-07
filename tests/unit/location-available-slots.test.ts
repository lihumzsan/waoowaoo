import { describe, expect, it } from 'vitest'
import { formatLocationAvailableSlotsText } from '@/lib/location-available-slots'

describe('location available slots', () => {
  it('formats english slot headers without leaking chinese labels', () => {
    const text = formatLocationAvailableSlotsText(
      ['left side near the wall'],
      'en',
    )

    expect(text).toBe('Available character slots:\n- left side near the wall')
    expect(text).not.toContain('可站位置：')
  })
})
