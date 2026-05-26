import {
  textPlacementPlanSchema,
  type TextPlacementAssetKind,
  type TextPlacementFinalImageResult,
  type TextPlacementPlan,
} from '@/lib/text-placement-test/types'

export interface TextPlacementTestResponse {
  readonly success: true
  readonly llmModelKey: string
  readonly imageModelKey: string
  readonly placementPlan: TextPlacementPlan
  readonly placementPrompt: string
  readonly placementRawText: string
  readonly scenePrompt: string
  readonly characterAPrompt: string
  readonly characterBPrompt: string
  readonly sceneImageUrl: string
  readonly sceneStorageKey: string
  readonly characterAImageUrl: string
  readonly characterAStorageKey: string
  readonly characterBImageUrl: string
  readonly characterBStorageKey: string
  readonly finalImages: readonly TextPlacementFinalImageResult[]
  readonly totalFinalImageCount?: number
}

export interface TextPlacementProgressResult {
  readonly llmModelKey: string
  readonly imageModelKey: string
  readonly placementPlan?: TextPlacementPlan
  readonly placementPrompt?: string
  readonly placementRawText?: string
  readonly scenePrompt?: string
  readonly characterAPrompt?: string
  readonly characterBPrompt?: string
  readonly sceneImageUrl?: string
  readonly sceneStorageKey?: string
  readonly characterAImageUrl?: string
  readonly characterAStorageKey?: string
  readonly characterBImageUrl?: string
  readonly characterBStorageKey?: string
  readonly finalImages: readonly TextPlacementFinalImageResult[]
  readonly totalFinalImageCount?: number
}

export interface PersistedTextPlacementTestState {
  readonly storyPrompt: string
  readonly llmModelKey: string
  readonly imageModelKey: string
  readonly result: TextPlacementTestResponse | null
  readonly progressResult: TextPlacementProgressResult | null
  readonly error: string | null
}

export type TextPlacementTestStreamEvent =
  | {
      readonly type: 'placementPlan'
      readonly placementPlan: TextPlacementPlan
      readonly placementPrompt: string
      readonly placementRawText: string
    }
  | {
      readonly type: 'asset'
      readonly asset: 'scene' | 'characterA' | 'characterB'
      readonly prompt: string
      readonly imageUrl: string
      readonly storageKey: string
    }
  | {
      readonly type: 'finalImage'
      readonly image: TextPlacementFinalImageResult
      readonly completedFinalImageCount: number
      readonly totalFinalImageCount: number
    }
  | {
      readonly type: 'complete'
      readonly result: TextPlacementTestResponse
    }
  | {
      readonly type: 'error'
      readonly message: string
    }

export type RetryResponse =
  | {
      readonly success: true
      readonly type: 'asset'
      readonly asset: {
        readonly asset: TextPlacementAssetKind
        readonly prompt: string
        readonly imageUrl: string
        readonly storageKey: string
      }
    }
  | {
      readonly success: true
      readonly type: 'finalImage'
      readonly image: TextPlacementFinalImageResult
    }

export type RetryAssetPayload = Extract<RetryResponse, { readonly type: 'asset' }>['asset']

export const TEXT_PLACEMENT_TEST_STORAGE_KEY = 'waoowaoo.textPlacementTest.state.v1'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isFinalImageResult(value: unknown): value is TextPlacementFinalImageResult {
  return isRecord(value)
    && Number.isInteger(value.shotNumber)
    && typeof value.shotLabel === 'string'
    && typeof value.prompt === 'string'
    && typeof value.imageUrl === 'string'
    && typeof value.storageKey === 'string'
}

export function isTextPlacementTestResponse(value: unknown): value is TextPlacementTestResponse {
  if (!isRecord(value)) return false
  return value.success === true
    && typeof value.llmModelKey === 'string'
    && typeof value.imageModelKey === 'string'
    && textPlacementPlanSchema.safeParse(value.placementPlan).success
    && typeof value.placementPrompt === 'string'
    && typeof value.placementRawText === 'string'
    && typeof value.scenePrompt === 'string'
    && typeof value.characterAPrompt === 'string'
    && typeof value.characterBPrompt === 'string'
    && typeof value.sceneImageUrl === 'string'
    && typeof value.sceneStorageKey === 'string'
    && typeof value.characterAImageUrl === 'string'
    && typeof value.characterAStorageKey === 'string'
    && typeof value.characterBImageUrl === 'string'
    && typeof value.characterBStorageKey === 'string'
    && Array.isArray(value.finalImages)
    && value.finalImages.every(isFinalImageResult)
}

export function isTextPlacementProgressResult(value: unknown): value is TextPlacementProgressResult {
  if (!isRecord(value)) return false
  return typeof value.llmModelKey === 'string'
    && typeof value.imageModelKey === 'string'
    && (value.placementPlan === undefined || textPlacementPlanSchema.safeParse(value.placementPlan).success)
    && (value.placementPrompt === undefined || typeof value.placementPrompt === 'string')
    && (value.placementRawText === undefined || typeof value.placementRawText === 'string')
    && (value.scenePrompt === undefined || typeof value.scenePrompt === 'string')
    && (value.characterAPrompt === undefined || typeof value.characterAPrompt === 'string')
    && (value.characterBPrompt === undefined || typeof value.characterBPrompt === 'string')
    && (value.sceneImageUrl === undefined || typeof value.sceneImageUrl === 'string')
    && (value.sceneStorageKey === undefined || typeof value.sceneStorageKey === 'string')
    && (value.characterAImageUrl === undefined || typeof value.characterAImageUrl === 'string')
    && (value.characterAStorageKey === undefined || typeof value.characterAStorageKey === 'string')
    && (value.characterBImageUrl === undefined || typeof value.characterBImageUrl === 'string')
    && (value.characterBStorageKey === undefined || typeof value.characterBStorageKey === 'string')
    && Array.isArray(value.finalImages)
    && value.finalImages.every(isFinalImageResult)
    && (value.totalFinalImageCount === undefined || Number.isInteger(value.totalFinalImageCount))
}

export function isPersistedTextPlacementTestState(value: unknown): value is PersistedTextPlacementTestState {
  if (!isRecord(value)) return false
  return typeof value.storyPrompt === 'string'
    && typeof value.llmModelKey === 'string'
    && typeof value.imageModelKey === 'string'
    && (value.result === null || isTextPlacementTestResponse(value.result))
    && (value.progressResult === null || isTextPlacementProgressResult(value.progressResult))
    && (value.error === null || typeof value.error === 'string')
}

export function isTextPlacementTestStreamEvent(value: unknown): value is TextPlacementTestStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'placementPlan') {
    return textPlacementPlanSchema.safeParse(value.placementPlan).success
      && typeof value.placementPrompt === 'string'
      && typeof value.placementRawText === 'string'
  }
  if (value.type === 'asset') {
    return (value.asset === 'scene' || value.asset === 'characterA' || value.asset === 'characterB')
      && typeof value.prompt === 'string'
      && typeof value.imageUrl === 'string'
      && typeof value.storageKey === 'string'
  }
  if (value.type === 'finalImage') {
    return isFinalImageResult(value.image)
      && Number.isInteger(value.completedFinalImageCount)
      && Number.isInteger(value.totalFinalImageCount)
  }
  if (value.type === 'complete') {
    return isTextPlacementTestResponse(value.result)
  }
  if (value.type === 'error') {
    return typeof value.message === 'string'
  }
  return false
}

export function isRetryResponse(value: unknown): value is RetryResponse {
  if (!isRecord(value) || value.success !== true || typeof value.type !== 'string') return false
  if (value.type === 'asset') {
    const asset = value.asset
    return isRecord(asset)
      && (asset.asset === 'scene' || asset.asset === 'characterA' || asset.asset === 'characterB')
      && typeof asset.prompt === 'string'
      && typeof asset.imageUrl === 'string'
      && typeof asset.storageKey === 'string'
  }
  if (value.type === 'finalImage') {
    return isFinalImageResult(value.image)
  }
  return false
}
