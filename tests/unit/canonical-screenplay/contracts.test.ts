import { describe, expect, it } from 'vitest'
import {
  compileCanonicalScreenplay,
  validateAssetManifestCoverage,
} from '@/lib/canonical-screenplay'

function screenplayInput() {
  const screenplayText = 'INT. OLD STATION - NIGHT\nLin Xia opens the unsent letter.'
  return {
    kind: 'canonical_screenplay' as const,
    title: 'The Unsent Letter',
    logline: null,
    synopsis: 'Lin Xia finds an unsent letter in the old station.',
    screenplayText,
    estimatedDurationSeconds: 30,
    source: { kind: 'provided' as const, label: 'User screenplay' },
    entities: {
      characters: [{ canonicalName: 'Lin Xia', aliases: ['Xia'], description: 'A determined traveler.' }],
      locations: [{ canonicalName: 'Old Station', aliases: ['Station'], description: 'An abandoned station.' }],
      props: [{ canonicalName: 'Unsent Letter', aliases: ['Letter'], description: 'A sealed paper letter.' }],
    },
    scenes: [{
      order: 1,
      heading: 'INT. OLD STATION - NIGHT',
      summary: 'Lin Xia opens the letter.',
      sourceStart: 0,
      sourceEnd: screenplayText.length,
      locationCanonicalName: 'Station',
      characterCanonicalNames: ['Xia'],
      propCanonicalNames: ['Letter'],
    }],
    assumptions: [],
    openQuestions: [],
  }
}

describe('canonical screenplay compiler', () => {
  it('assigns deterministic server identities and resolves scene aliases', () => {
    const first = compileCanonicalScreenplay(screenplayInput())
    const second = compileCanonicalScreenplay(screenplayInput())

    expect(first.entities).toEqual(second.entities)
    expect(first.entities.characters[0]?.entityId).toMatch(/^CHAR_[A-F0-9]{16}$/)
    expect(first.entities.locations[0]?.entityId).toMatch(/^LOC_[A-F0-9]{16}$/)
    expect(first.entities.props[0]?.entityId).toMatch(/^PROP_[A-F0-9]{16}$/)
    expect(first.scenes).toEqual([expect.objectContaining({
      sceneId: 'SCENE_0001',
      locationId: first.entities.locations[0]?.entityId,
      characterIds: [first.entities.characters[0]?.entityId],
      propIds: [first.entities.props[0]?.entityId],
    })])
  })

  it('rejects an unregistered scene entity instead of inventing identity', () => {
    const input = screenplayInput()
    input.scenes[0]!.characterCanonicalNames = ['Unregistered Character']

    expect(() => compileCanonicalScreenplay(input)).toThrow(
      'CANONICAL_SCREENPLAY_SCENE_CHARACTER_UNKNOWN',
    )
  })

  it('requires an asset manifest to cover every registered entity exactly once', () => {
    const screenplay = compileCanonicalScreenplay(screenplayInput())
    const assets = [
      ...screenplay.entities.characters,
      ...screenplay.entities.locations,
      ...screenplay.entities.props,
    ].map((entity) => ({
      canonicalEntity: { entityId: entity.entityId, kind: entity.kind },
      title: entity.canonicalName,
      stableDescription: entity.description,
      generationPrompt: `Design ${entity.canonicalName}.`,
      negativePrompt: null,
      referenceRequirements: [],
      continuityRequirements: [],
    }))
    const manifest = {
      kind: 'asset_manifest' as const,
      overview: 'All registered assets.',
      assets,
      assumptions: [],
      warnings: [],
    }

    expect(validateAssetManifestCoverage({ screenplay, manifest })).toEqual(manifest)
    expect(() => validateAssetManifestCoverage({
      screenplay,
      manifest: { ...manifest, assets: assets.slice(1) },
    })).toThrow('ASSET_MANIFEST_CANONICAL_ENTITY_MISSING')
    expect(() => validateAssetManifestCoverage({
      screenplay,
      manifest: { ...manifest, assets: [...assets, assets[0]] },
    })).toThrow('ASSET_MANIFEST_CANONICAL_ENTITY_DUPLICATE')
  })
})
