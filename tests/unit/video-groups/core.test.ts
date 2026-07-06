import { describe, expect, it } from 'vitest'
import {
  chunkVideoGroupShotIds,
  inferVideoGridModeForShotCount,
  validateVideoGroupShotIds,
  videoGridCellCount,
} from '@/lib/video-groups/core'

describe('video generation segment grid mode', () => {
  it('derives 2x2 for 2-4 shots and 3x3 for 5-9 shots', () => {
    expect(inferVideoGridModeForShotCount(2)).toBe('2x2')
    expect(inferVideoGridModeForShotCount(4)).toBe('2x2')
    expect(inferVideoGridModeForShotCount(5)).toBe('3x3')
    expect(inferVideoGridModeForShotCount(9)).toBe('3x3')
  })

  it('rejects unsupported segment sizes instead of falling back silently', () => {
    expect(() => inferVideoGridModeForShotCount(1)).toThrow('VIDEO_GROUP_SHOT_COUNT_UNSUPPORTED')
    expect(() => inferVideoGridModeForShotCount(10)).toThrow('VIDEO_GROUP_SHOT_COUNT_UNSUPPORTED')
  })

  it('validates continuous shot ids against the selected grid mode', () => {
    const shots = [
      { shotId: 'shot-11' },
      { shotId: 'shot-12' },
      { shotId: 'shot-13' },
      { shotId: 'shot-14' },
      { shotId: 'shot-15' },
    ]
    expect(videoGridCellCount('2x2')).toBe(4)
    expect(videoGridCellCount('3x3')).toBe(9)
    expect(validateVideoGroupShotIds({
      gridMode: '2x2',
      shotIds: ['shot-11', 'shot-12', 'shot-13'],
      shots,
    })).toEqual(['shot-11', 'shot-12', 'shot-13'])
    expect(() => validateVideoGroupShotIds({
      gridMode: '2x2',
      shotIds: ['shot-11', 'shot-13'],
      shots,
    }))
      .toThrow('VIDEO_GROUP_SHOT_IDS_NOT_CONTINUOUS')
    expect(() => validateVideoGroupShotIds({
      gridMode: '2x2',
      shotIds: ['shot-11', 'shot-12', 'shot-13', 'shot-14', 'shot-15'],
      shots,
    }))
      .toThrow('VIDEO_GROUP_SHOT_COUNT_MISMATCH')
  })

  it('chunks long generation segments by the selected grid cell count', () => {
    expect(chunkVideoGroupShotIds({
      gridMode: '3x3',
      shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4', 'shot-5', 'shot-6', 'shot-7', 'shot-8', 'shot-9'],
    }))
      .toEqual([['shot-1', 'shot-2', 'shot-3', 'shot-4', 'shot-5', 'shot-6', 'shot-7', 'shot-8', 'shot-9']])
  })
})
