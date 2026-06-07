import { describe, expect, it } from 'vitest'
import { assetKindRegistry, getAssetKindRegistration } from '@/lib/assets/kinds/registry'

describe('asset kind registry', () => {
  it('declares the supported asset kinds with stable capability contracts', () => {
    expect(Object.keys(assetKindRegistry)).toEqual(['character', 'location', 'prop'])
    expect(getAssetKindRegistration('character')).toEqual(expect.objectContaining({
      kind: 'character',
      family: 'visual',
      supportsMultipleVariants: true,
      capabilities: expect.objectContaining({
        canGenerate: true,
        canCopyFromGlobal: true,
      }),
    }))
    expect(getAssetKindRegistration('location')).toEqual(expect.objectContaining({
      kind: 'location',
      family: 'visual',
      supportsMultipleVariants: true,
    }))
    expect(getAssetKindRegistration('prop')).toEqual(expect.objectContaining({
      kind: 'prop',
      family: 'visual',
      supportsMultipleVariants: true,
      capabilities: expect.objectContaining({
        canGenerate: true,
        canSelectRender: true,
        canCopyFromGlobal: true,
      }),
    }))
  })
})
