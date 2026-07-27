import { describe, expect, it } from 'vitest'
import {
  compileAssetManifest,
  screenplaySchema,
  validateAssetManifest,
} from '@/lib/screenplay'

const screenplay = screenplaySchema.parse({
  kind: 'screenplay',
  title: '坠落',
  logline: null,
  synopsis: '角色从山顶坠落并在崖底醒来。',
  screenplayText: '山顶。阿澈失足越过悬崖边缘。\n崖底。阿澈摔在碎石地上，怀表发出金光。',
  source: { kind: 'generated', label: '坠落剧本' },
  assumptions: [],
  openQuestions: [],
})

function workerManifest() {
  return {
    kind: 'asset_manifest' as const,
    overview: '只保留需要跨镜头复用的视觉资产。',
    assets: [
      {
        kind: 'character' as const,
        canonicalName: '阿澈',
        aliases: [],
        stableDescription: '短发青年，深色夹克。',
        generationPrompt: '短发青年角色参考图。',
      },
      {
        kind: 'location' as const,
        canonicalName: '崖底',
        aliases: [],
        stableDescription: '陡峭岩壁围合的碎石地。',
        generationPrompt: '完整崖底环境参考图。',
      },
    ],
    assumptions: [],
    warnings: [],
  }
}

describe('screenplay and asset manifest contracts', () => {
  it('keeps screenplay output free of production asset and scene registries', () => {
    expect(screenplay).not.toHaveProperty('entities')
    expect(screenplay).not.toHaveProperty('scenes')
  })

  it('compiles stable manifest-owned identities without requiring screenplay entity coverage', () => {
    const first = compileAssetManifest({ manifest: workerManifest() })
    const second = compileAssetManifest({ manifest: workerManifest() })

    expect(first.assets.map((asset) => asset.manifestAssetId)).toEqual(
      second.assets.map((asset) => asset.manifestAssetId),
    )
    expect(first.assets.map((asset) => asset.canonicalName)).toEqual(['阿澈', '崖底'])
  })

  it('permits an explicitly empty manifest instead of forcing an unnecessary asset', () => {
    expect(compileAssetManifest({
      manifest: {
        kind: 'asset_manifest',
        overview: '没有实体同时满足可见、需独立复用且不可由其他资产代表的门槛。',
        assets: [],
        assumptions: [],
        warnings: [],
      },
    }).assets).toEqual([])
  })

  it('rejects duplicate or forged manifest asset identity', () => {
    const manifest = compileAssetManifest({ manifest: workerManifest() })
    const forged = {
      ...manifest,
      assets: manifest.assets.map((asset, index) => (
        index === 0 ? { ...asset, manifestAssetId: 'ASSET_CHAR_FORGED' } : asset
      )),
    }

    expect(() => validateAssetManifest({ manifest: forged })).toThrow(
      'ASSET_MANIFEST_ID_INVALID',
    )
  })
})
