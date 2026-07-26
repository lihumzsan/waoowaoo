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
        sourceRefs: [{ sourceExcerpt: '阿澈失足越过悬崖边缘', reason: '主要角色需要跨镜头保持身份。' }],
        stableDescription: '短发青年，深色夹克。',
        generationPrompt: '短发青年角色参考图。',
      },
      {
        kind: 'location' as const,
        canonicalName: '崖底',
        aliases: [],
        sourceRefs: [{ sourceExcerpt: '崖底。阿澈摔在碎石地上', reason: '独立承载坠落后的关键画面动作。' }],
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
    const first = compileAssetManifest({ screenplay, manifest: workerManifest() })
    const second = compileAssetManifest({ screenplay, manifest: workerManifest() })

    expect(first.assets.map((asset) => asset.manifestAssetId)).toEqual(
      second.assets.map((asset) => asset.manifestAssetId),
    )
    expect(first.assets.map((asset) => asset.canonicalName)).toEqual(['阿澈', '崖底'])
  })

  it('permits an explicitly empty manifest instead of forcing an unnecessary asset', () => {
    expect(compileAssetManifest({
      screenplay,
      manifest: {
        kind: 'asset_manifest',
        overview: '没有实体同时满足可见、需独立复用且不可由其他资产代表的门槛。',
        assets: [],
        assumptions: [],
        warnings: [],
      },
    }).assets).toEqual([])
  })

  it('rejects an asset that has no exact evidence in the screenplay', () => {
    const manifest = workerManifest()
    manifest.assets[1]!.sourceRefs = [{
      sourceExcerpt: '不存在的宫殿',
      reason: '没有原文依据。',
    }]

    expect(() => compileAssetManifest({ screenplay, manifest })).toThrow(
      'ASSET_MANIFEST_SOURCE_REF_INVALID',
    )
  })

  it('rejects duplicate or forged manifest asset identity', () => {
    const manifest = compileAssetManifest({ screenplay, manifest: workerManifest() })
    const forged = {
      ...manifest,
      assets: manifest.assets.map((asset, index) => (
        index === 0 ? { ...asset, manifestAssetId: 'ASSET_CHAR_FORGED' } : asset
      )),
    }

    expect(() => validateAssetManifest({ screenplay, manifest: forged })).toThrow(
      'ASSET_MANIFEST_ID_INVALID',
    )
  })
})
