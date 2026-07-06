import { describe, expect, it } from 'vitest'
import {
  buildChapterPlanOutputSchema,
  enrichChapterPlanOutputWithAssetNames,
  type ChapterPlanAssetMenu,
} from '@/lib/edit-chapter/schemas'
import { assertChapterPlanAssetMenuReady } from '@/lib/edit-chapter/asset-menu'

const assetMenu: ChapterPlanAssetMenu = {
  locations: [{
    id: 'location-1',
    name: '地下室工作台',
    description: '低矮昏暗的地下室工作区',
  }],
  characters: [{
    id: 'character-1',
    name: '民科',
    description: '狂热的民间科学家',
  }],
}

function validOutput() {
  return {
    shots: [{
      shotNumber: 1,
      shotId: 'shot-1',
      durationSec: 3,
      scene: {
        locationId: 'location-1',
        subScene: '工作台上的钟表盘面特写',
      },
      action: '民科低头调整盘面。',
      characters: [{
        characterId: 'character-1',
        visibility: 'visible',
        role: 'focus',
        performance: '紧张地拨动旋钮',
      }],
      keyObjects: [{
        name: '钟表盘面',
        role: 'plot_device',
      }],
      sound: '机械滴答声',
    }],
    generationSegments: [{
      shotIds: ['shot-1'],
      continuity: 'single shot',
    }],
    persistentFactsIntroduced: [],
  }
}

function captureAssetMenuReadinessError(menu: ChapterPlanAssetMenu): unknown {
  try {
    assertChapterPlanAssetMenuReady(menu)
    return null
  } catch (error) {
    return error
  }
}

describe('chapter plan output schema', () => {
  it('rejects locations outside the confirmed asset menu before name matching can occur', () => {
    const schema = buildChapterPlanOutputSchema(assetMenu)
    const output = validOutput()
    output.shots[0]!.scene.locationId = 'invented-location'

    expect(schema.safeParse(output).success).toBe(false)
  })

  it('rejects characters outside the confirmed asset menu before name matching can occur', () => {
    const schema = buildChapterPlanOutputSchema(assetMenu)
    const output = validOutput()
    output.shots[0]!.characters[0]!.characterId = 'invented-character'

    expect(schema.safeParse(output).success).toBe(false)
  })

  it('enriches accepted asset IDs with confirmed asset names for downstream renderers', () => {
    const enriched = enrichChapterPlanOutputWithAssetNames(validOutput(), assetMenu)

    expect(enriched.shots[0]?.scene).toEqual({
      locationId: 'location-1',
      name: '地下室工作台',
      subScene: '工作台上的钟表盘面特写',
    })
    expect(enriched.shots[0]?.characters[0]).toMatchObject({
      characterId: 'character-1',
      name: '民科',
    })
  })

  it('fails explicitly before LLM execution when the confirmed asset menu is empty', () => {
    expect(captureAssetMenuReadinessError({
      locations: [],
      characters: assetMenu.characters,
    })).toMatchObject({
      code: 'EDIT_SCRIPT_ASSET_MENU_EMPTY',
      details: expect.objectContaining({ locationCount: 0 }),
    })
    expect(captureAssetMenuReadinessError({
      locations: assetMenu.locations,
      characters: [],
    })).toMatchObject({
      code: 'EDIT_SCRIPT_ASSET_MENU_EMPTY',
      details: expect.objectContaining({ characterCount: 0 }),
    })
  })
})
