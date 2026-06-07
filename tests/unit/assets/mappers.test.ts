import { describe, expect, it } from 'vitest'
import { mapProjectCharacterToAsset, mapProjectPropToAsset } from '@/lib/assets/mappers'
import { groupAssetsByKind } from '@/lib/assets/grouping'

describe('asset mappers', () => {
  it('maps project characters into the unified character asset contract', () => {
    const asset = mapProjectCharacterToAsset({
      id: 'character-1',
      name: '林夏',
      introduction: '主角',
      profileData: JSON.stringify({ archetype: 'lead' }),
      profileConfirmed: true,
      appearances: [
        {
          id: 'appearance-1',
          appearanceIndex: 0,
          changeReason: '初始形象',
          description: '短发，风衣',
          imageUrl: 'https://example.com/char.jpg',
          media: null,
          imageUrls: ['https://example.com/char.jpg'],
          imageMedias: [],
          selectedIndex: 0,
          previousImageUrl: null,
          previousMedia: null,
          previousImageUrls: [],
          previousImageMedias: [],
        },
      ],
    })

    expect(asset).toEqual(expect.objectContaining({
      id: 'character-1',
      scope: 'project',
      kind: 'character',
      introduction: '主角',
      profileData: JSON.stringify({ archetype: 'lead' }),
      profileConfirmed: true,
    }))
    expect(asset.variants[0]).toEqual(expect.objectContaining({
      id: 'appearance-1',
      index: 0,
      label: '初始形象',
    }))
  })

  it('maps project props into the unified visual asset contract and groups them by kind', () => {
    const propAsset = mapProjectPropToAsset({
      id: 'prop-1',
      name: '青铜匕首',
      summary: '古旧短刃，雕纹手柄',
      images: [
        {
          id: 'prop-image-1',
          imageIndex: 0,
          description: '古旧短刃，雕纹手柄',
          imageUrl: 'https://example.com/prop.jpg',
          media: null,
          previousImageUrl: null,
          previousMedia: null,
          isSelected: true,
        },
      ],
    })
    expect(propAsset).toEqual(expect.objectContaining({
      id: 'prop-1',
      scope: 'project',
      kind: 'prop',
      summary: '古旧短刃，雕纹手柄',
      selectedVariantId: 'prop-image-1',
    }))
    expect(propAsset.variants[0]).toEqual(expect.objectContaining({
      id: 'prop-image-1',
      index: 0,
      description: '古旧短刃，雕纹手柄',
    }))

    const groups = groupAssetsByKind([propAsset])
    expect(groups.prop.map((asset) => asset.id)).toEqual(['prop-1'])
  })
})
