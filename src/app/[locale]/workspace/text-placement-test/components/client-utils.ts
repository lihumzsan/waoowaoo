import type { TextPlacementAssetKind, TextPlacementFinalImageResult } from '@/lib/text-placement-test/types'
import type { TextPlacementProgressResult, TextPlacementTestResponse } from './client-state'

export function readErrorMessage(payload: unknown, fallback: string): string {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? JSON.stringify(payload) : fallback
}

export function parseStreamEventBlock(block: string): unknown {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  return JSON.parse(data) as unknown
}

export function sortFinalImages(images: readonly TextPlacementFinalImageResult[]): readonly TextPlacementFinalImageResult[] {
  return [...images].sort((left, right) => left.shotNumber - right.shotNumber)
}

export function upsertFinalImage(
  images: readonly TextPlacementFinalImageResult[],
  nextImage: TextPlacementFinalImageResult,
): readonly TextPlacementFinalImageResult[] {
  const withoutCurrent = images.filter((image) => image.shotNumber !== nextImage.shotNumber)
  return sortFinalImages([...withoutCurrent, nextImage])
}

export function getAssetPrompt(result: TextPlacementProgressResult | TextPlacementTestResponse, asset: TextPlacementAssetKind): string {
  if (asset === 'scene') return result.scenePrompt || ''
  if (asset === 'characterA') return result.characterAPrompt || ''
  return result.characterBPrompt || ''
}

export function getFinalImageByShot(
  images: readonly TextPlacementFinalImageResult[],
  shotNumber: number,
): TextPlacementFinalImageResult | null {
  return images.find((image) => image.shotNumber === shotNumber) || null
}
