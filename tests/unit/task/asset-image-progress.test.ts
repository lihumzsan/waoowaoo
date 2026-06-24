import { describe, expect, it } from 'vitest'
import { buildAssetImageProgressSource } from '@/lib/task/asset-image-progress'
import { TASK_TYPE } from '@/lib/task/types'

describe('buildAssetImageProgressSource', () => {
  it('builds a processing source for a running location image', () => {
    const source = buildAssetImageProgressSource({
      assetKind: 'location',
      targetId: 'loc-1',
      running: true,
    })
    expect(source).toEqual({
      phase: 'processing',
      runningTaskType: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'asset-location-image',
      targetId: 'loc-1',
    })
  })

  it('builds a processing source for a running character image', () => {
    const source = buildAssetImageProgressSource({
      assetKind: 'character',
      targetId: 'char-9',
      running: true,
    })
    expect(source?.runningTaskType).toBe(TASK_TYPE.IMAGE_CHARACTER)
    expect(source?.targetType).toBe('asset-character-image')
    expect(source?.phase).toBe('processing')
  })

  it('builds a failed source when not running but failed', () => {
    const source = buildAssetImageProgressSource({
      assetKind: 'location',
      targetId: 'loc-2',
      running: false,
      failed: true,
    })
    expect(source?.phase).toBe('failed')
  })

  it('returns null when neither running nor failed', () => {
    expect(
      buildAssetImageProgressSource({ assetKind: 'location', targetId: 'loc-3', running: false }),
    ).toBeNull()
  })
})
