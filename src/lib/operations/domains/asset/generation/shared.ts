import { ApiError } from '@/lib/api-errors'
import type { OperationPlan } from '@/lib/operations/planning'

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveLocaleFromContext(locale?: unknown): string {
  const normalized = normalizeString(locale)
  return normalized || 'zh'
}

export function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

export type ProjectAssetImageKind = 'character' | 'location'

type ProjectAssetImagePlanMetadata = {
  assetId: string
  assetKind: ProjectAssetImageKind
  appearanceId: string | null
  mutationTargetType: 'ProjectCharacter' | 'ProjectLocation'
  mutationTargetId: string
}

export function omitOperationControls(input: Record<string, unknown>): Record<string, unknown> {
  const body = { ...input }
  return body
}

export function readProjectAssetImagePlanMetadata(plan: OperationPlan): ProjectAssetImagePlanMetadata {
  const metadata = plan.metadata ?? {}
  const assetId = normalizeString(metadata.assetId)
  const assetKind = metadata.assetKind
  const mutationTargetType = metadata.mutationTargetType
  const mutationTargetId = normalizeString(metadata.mutationTargetId)
  if (
    !assetId
    || (assetKind !== 'character' && assetKind !== 'location')
    || (mutationTargetType !== 'ProjectCharacter' && mutationTargetType !== 'ProjectLocation')
    || !mutationTargetId
  ) {
    throw new Error('PROJECT_AGENT_ASSET_IMAGE_PLAN_METADATA_INVALID')
  }
  return {
    assetId,
    assetKind,
    mutationTargetType,
    mutationTargetId,
    appearanceId: normalizeString(metadata.appearanceId) || null,
  }
}
