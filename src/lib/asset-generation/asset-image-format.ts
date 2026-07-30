import {
  CREATIVE_RESOURCE_SCHEMA,
  type CreativeResourceSchemaId,
} from '@/lib/creative-resource/schema-registry'
import type { CreativeDirection } from '@/lib/creative-direction/contracts'

export type AssetImageKind = 'character' | 'location' | 'prop'
export type AssetImageFormatLocale = 'zh' | 'en'
const ASSET_IMAGE_ASPECT_RATIO = '4:3' as const

interface AssetImageFormatPolicy {
  readonly kind: AssetImageKind
  readonly schemaId: CreativeResourceSchemaId
  readonly aspectRatio: typeof ASSET_IMAGE_ASPECT_RATIO
  readonly instruction: Readonly<Record<AssetImageFormatLocale, string>>
}

/** Asset-image format authority. Generic images, previews, frames and video are outside this policy. */
export const ASSET_IMAGE_FORMAT_POLICIES = {
  character: {
    kind: 'character',
    schemaId: CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    aspectRatio: ASSET_IMAGE_ASPECT_RATIO,
    instruction: {
      zh: `【角色资产图固定版式】只生成一张完整的 ${ASSET_IMAGE_ASPECT_RATIO} 横向长方形资产图，画面严格分为左右两半：左半边只展示该角色的脸部特写，右半边只展示同一角色从头到脚无遮挡的完整全身。背景必须为纯白色。画面中只能出现同一个角色，不得出现其他人物、任何道具或场景环境。`,
      en: `[Fixed character asset-image format] Generate exactly one complete ${ASSET_IMAGE_ASPECT_RATIO} landscape rectangular asset image split into equal left and right halves. The left half shows only a close-up of this character's face; the right half shows the same character's complete, unobstructed, head-to-toe full body. Use a pure white background. Show only this same character, with no other people, props, or scene environment.`,
    },
  },
  location: {
    kind: 'location',
    schemaId: CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    aspectRatio: ASSET_IMAGE_ASPECT_RATIO,
    instruction: {
      zh: `【场景资产图固定版式】只生成一张完整的 ${ASSET_IMAGE_ASPECT_RATIO} 横向长方形场景资产图，使用正前方视角完整展示整个场景，不得拆分成多视图。画面中不得出现任何人物、松散家具或独立道具资产；墙体、门窗、楼梯等属于场景本体的固定结构与内建要素可以正常出现。`,
      en: `[Fixed location asset-image format] Generate exactly one complete ${ASSET_IMAGE_ASPECT_RATIO} landscape rectangular location asset image: a straight-on, full-scene view that shows the entire environment, never a multi-view sheet. Show no people, loose furniture, or independent prop assets. Fixed structures and built-in elements that are part of the location itself, such as walls, doors, windows, and stairs, may remain.`,
    },
  },
  prop: {
    kind: 'prop',
    schemaId: CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE,
    aspectRatio: ASSET_IMAGE_ASPECT_RATIO,
    instruction: {
      zh: `【道具资产图固定版式】只生成一张完整的 ${ASSET_IMAGE_ASPECT_RATIO} 横向长方形资产图，只展示一个摆放方正、方向明确、居中且完整无遮挡的道具。背景必须为纯白色。画面中不得出现人物、其他道具或场景环境。`,
      en: `[Fixed prop asset-image format] Generate exactly one complete ${ASSET_IMAGE_ASPECT_RATIO} landscape rectangular asset image showing one prop only, squarely aligned, clearly oriented, centered, complete, and unobstructed. Use a pure white background. Show no people, other props, or scene environment.`,
    },
  },
} as const satisfies Record<AssetImageKind, AssetImageFormatPolicy>

const ASSET_IMAGE_KIND_BY_SCHEMA_ID = new Map<CreativeResourceSchemaId, AssetImageKind>(
  Object.values(ASSET_IMAGE_FORMAT_POLICIES).map((policy) => [policy.schemaId, policy.kind]),
)

function normalizeLocale(locale: string | null | undefined): AssetImageFormatLocale {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function getAssetImageFormatPolicy(kind: AssetImageKind): AssetImageFormatPolicy {
  return ASSET_IMAGE_FORMAT_POLICIES[kind]
}

export function resolveAssetImageKindForSchemaId(schemaId: string): AssetImageKind | null {
  return ASSET_IMAGE_KIND_BY_SCHEMA_ID.get(schemaId as CreativeResourceSchemaId) ?? null
}

/** The only compiler that turns stable asset facts into an executable asset-image prompt. */
export function compileAssetImagePrompt(input: {
  readonly stableDescription: string
  readonly creativeDirection: CreativeDirection | null
  readonly kind: AssetImageKind
  readonly locale?: string | null
}): string {
  const locale = normalizeLocale(input.locale)
  const direction = input.creativeDirection
  const semanticPrompt = direction
    ? locale === 'en'
      ? [
          `Stable asset design: ${input.stableDescription.trim()}`,
          `Project visual style: ${direction.visual.visualStyle}`,
          `Asset-image lighting: ${direction.visual.assetImageStyle.lighting}`,
          `Asset-image texture: ${direction.visual.assetImageStyle.texture}`,
        ].join('\n')
      : [
          `稳定资产设计：${input.stableDescription.trim()}`,
          `项目视觉风格：${direction.visual.visualStyle}`,
          `资产图灯光：${direction.visual.assetImageStyle.lighting}`,
          `资产图材质：${direction.visual.assetImageStyle.texture}`,
        ].join('\n')
    : input.stableDescription.trim()
  const instruction = getAssetImageFormatPolicy(input.kind).instruction[locale]
  return semanticPrompt ? `${semanticPrompt}\n\n${instruction}` : instruction
}
