import type { VideoGridMode, VideoGroupShot } from './types'

const GRID_CELLS = {
  '2x2': 4,
  '3x3': 9,
} as const satisfies Record<VideoGridMode, number>

function normalizeShotIds(shotIds: readonly string[]): string[] {
  const normalized = shotIds.map((value) => value.trim())
  if (normalized.some((value) => value.length === 0)) {
    throw new Error('VIDEO_GROUP_SHOT_IDS_INVALID')
  }
  const unique = new Set(normalized)
  if (unique.size !== normalized.length) throw new Error('VIDEO_GROUP_SHOT_IDS_DUPLICATE')
  return normalized
}

function assertContinuousShotOrder(input: {
  readonly shotIds: readonly string[]
  readonly shots: readonly Pick<VideoGroupShot, 'shotId'>[]
}): void {
  const orderByShotId = new Map(input.shots.map((shot, index) => [shot.shotId, index]))
  input.shotIds.forEach((shotId, index) => {
    const order = orderByShotId.get(shotId)
    if (order === undefined) throw new Error(`VIDEO_GROUP_SHOT_ID_UNKNOWN:${shotId}`)
    if (index === 0) return
    const previousOrder = orderByShotId.get(input.shotIds[index - 1])
    if (previousOrder === undefined || order !== previousOrder + 1) {
      throw new Error('VIDEO_GROUP_SHOT_IDS_NOT_CONTINUOUS')
    }
  })
}

export function videoGridCellCount(gridMode: VideoGridMode): number {
  return GRID_CELLS[gridMode]
}

export function validateVideoGroupShotIds(params: {
  readonly gridMode: VideoGridMode
  readonly shotIds: readonly string[]
  readonly shots?: readonly Pick<VideoGroupShot, 'shotId'>[]
}): string[] {
  const normalized = normalizeShotIds(params.shotIds)
  const maxCount = videoGridCellCount(params.gridMode)
  if (normalized.length < 2 || normalized.length > maxCount) {
    throw new Error(`VIDEO_GROUP_SHOT_COUNT_MISMATCH:${normalized.length}:2-${maxCount}`)
  }
  if (params.shots) {
    assertContinuousShotOrder({
      shotIds: normalized,
      shots: params.shots,
    })
  }
  return normalized
}

export function inferVideoGridModeForShotCount(shotCount: number): VideoGridMode {
  if (Number.isInteger(shotCount) && shotCount >= 2 && shotCount <= 4) return '2x2'
  if (Number.isInteger(shotCount) && shotCount >= 5 && shotCount <= 9) return '3x3'
  throw new Error(`VIDEO_GROUP_SHOT_COUNT_UNSUPPORTED:${shotCount}`)
}

export function chunkVideoGroupShotIds(params: {
  readonly gridMode: VideoGridMode
  readonly shotIds: readonly string[]
  readonly shots?: readonly Pick<VideoGroupShot, 'shotId'>[]
}): string[][] {
  const normalized = normalizeShotIds(params.shotIds)
  if (params.shots) {
    assertContinuousShotOrder({
      shotIds: normalized,
      shots: params.shots,
    })
  }
  const cellCount = videoGridCellCount(params.gridMode)
  const chunks: string[][] = []
  for (let index = 0; index < normalized.length; index += cellCount) {
    const chunk = normalized.slice(index, index + cellCount)
    if (chunk.length >= 2) chunks.push(chunk)
  }
  return chunks
}

export function resolveVideoGroupShots<TShot extends VideoGroupShot>(
  shots: readonly TShot[],
  shotIds: readonly string[],
): TShot[] {
  const byId = new Map(shots.map((shot) => [shot.shotId, shot]))
  return normalizeShotIds(shotIds).map((shotId) => {
    const shot = byId.get(shotId)
    if (!shot) throw new Error(`VIDEO_GROUP_SHOT_ID_UNKNOWN:${shotId}`)
    return shot
  })
}

export function totalVideoGroupDuration(shots: readonly Pick<VideoGroupShot, 'durationSec'>[]): number {
  return shots.reduce((total, shot) => total + shot.durationSec, 0)
}
