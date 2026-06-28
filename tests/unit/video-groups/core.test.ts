import { describe, expect, it } from 'vitest'
import {
  chunkVideoGroupShots,
  inferVideoGridModeForShotCount,
  validateVideoGroupShotNumbers,
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

  it('validates continuous shot numbers against the selected grid mode', () => {
    expect(videoGridCellCount('2x2')).toBe(4)
    expect(videoGridCellCount('3x3')).toBe(9)
    expect(validateVideoGroupShotNumbers({ gridMode: '2x2', shotNumbers: [11, 12, 13] })).toEqual([11, 12, 13])
    expect(() => validateVideoGroupShotNumbers({ gridMode: '2x2', shotNumbers: [11, 13] }))
      .toThrow('VIDEO_GROUP_SHOT_NUMBERS_NOT_CONTINUOUS')
    expect(() => validateVideoGroupShotNumbers({ gridMode: '2x2', shotNumbers: [11, 12, 13, 14, 15] }))
      .toThrow('VIDEO_GROUP_SHOT_COUNT_MISMATCH')
  })

  it('chunks long generation segments by the selected grid cell count', () => {
    expect(chunkVideoGroupShots({ gridMode: '3x3', shotNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] }))
      .toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9]])
  })
})
