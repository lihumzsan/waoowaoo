import { ApiError } from '@/lib/api-errors'
import type { AssetKind } from '@/lib/assets/contracts'

export type UploadRenderFileLike = {
  readonly name: string
  readonly type: string
  readonly size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export type ProjectUploadRenderInput = {
  readonly assetId: string
  readonly scope: 'project'
  readonly kind: Extract<AssetKind, 'character' | 'location'>
  readonly projectId: string
  readonly file: UploadRenderFileLike
  readonly appearanceId?: string
  readonly imageIndex?: number
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isUploadRenderFileLike(value: unknown): value is UploadRenderFileLike {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<UploadRenderFileLike>
  return typeof candidate.name === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.arrayBuffer === 'function'
}

function parseImageIndex(value: unknown): number | undefined {
  const raw = normalizeString(value)
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_IMAGE_INDEX',
      field: 'imageIndex',
      message: 'imageIndex must be an integer between 0 and 50',
    })
  }
  return parsed
}

export function parseProjectUploadRenderFormData(formData: FormData, assetId: string): ProjectUploadRenderInput {
  const scope = normalizeString(formData.get('scope'))
  const kind = normalizeString(formData.get('kind'))
  const projectId = normalizeString(formData.get('projectId'))
  const appearanceId = normalizeString(formData.get('appearanceId'))
  const file = formData.get('file')

  if (scope !== 'project') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ASSET_SCOPE',
      field: 'scope',
      message: 'upload-render currently requires project scope',
    })
  }
  if (kind !== 'character' && kind !== 'location') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ASSET_KIND',
      field: 'kind',
      message: 'kind must be character or location',
    })
  }
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_ID_REQUIRED',
      field: 'projectId',
      message: 'projectId is required for project asset upload',
    })
  }
  if (!isUploadRenderFileLike(file)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_REQUIRED',
      field: 'file',
      message: 'file is required',
    })
  }
  if (kind === 'character' && !appearanceId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'APPEARANCE_ID_REQUIRED',
      field: 'appearanceId',
      message: 'appearanceId is required for character asset upload',
    })
  }

  const imageIndex = parseImageIndex(formData.get('imageIndex'))

  return {
    assetId,
    scope,
    kind,
    projectId,
    file,
    ...(appearanceId ? { appearanceId } : {}),
    ...(imageIndex !== undefined ? { imageIndex } : {}),
  }
}
