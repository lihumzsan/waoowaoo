import { describe, expect, it } from 'vitest'
import {
  applyAssetImageFormatPolicy,
  getAssetImageFormatPolicy,
  resolveAssetImageKindForSchemaId,
} from '@/lib/asset-generation'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource'

describe('asset image format policy', () => {
  it('maps every professional asset schema to one fixed 4:3 policy', () => {
    expect(resolveAssetImageKindForSchemaId(CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE)).toBe('character')
    expect(resolveAssetImageKindForSchemaId(CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE)).toBe('location')
    expect(resolveAssetImageKindForSchemaId(CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE)).toBe('prop')
    expect(resolveAssetImageKindForSchemaId(CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE)).toBeNull()
    expect(['character', 'location', 'prop'].map((kind) => (
      getAssetImageFormatPolicy(kind as 'character' | 'location' | 'prop').aspectRatio
    ))).toEqual(['4:3', '4:3', '4:3'])
  })

  it('appends the locale-specific fixed suffix exactly once', () => {
    const once = applyAssetImageFormatPolicy({
      prompt: 'A weathered brass compass.',
      kind: 'prop',
      locale: 'en-US',
    })
    const twice = applyAssetImageFormatPolicy({ prompt: once, kind: 'prop', locale: 'en-US' })

    expect(twice).toBe(once)
    expect(once).toContain('4:3')
    expect(once).toContain('one prop only')
    expect(once).not.toContain('composition')
  })
})
