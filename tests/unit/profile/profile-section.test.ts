import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_SECTION,
  PROFILE_SECTIONS,
  readProfileSectionParam,
} from '@/lib/profile/sections'

describe('profile section routing', () => {
  it('exposes account overview, security, api config and billing as the settings center sections', () => {
    expect(PROFILE_SECTIONS).toEqual(['overview', 'security', 'apiConfig', 'billing'])
  })

  it('uses account overview when the section query is absent', () => {
    expect(DEFAULT_PROFILE_SECTION).toBe('overview')
    expect(readProfileSectionParam(null)).toBe(DEFAULT_PROFILE_SECTION)
  })

  it('rejects unknown section query values instead of hiding them behind a fallback', () => {
    expect(() => readProfileSectionParam('legacyBilling')).toThrow('Unsupported profile section')
  })
})
