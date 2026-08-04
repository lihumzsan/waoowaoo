import { describe, expect, it } from 'vitest'
import {
  GPT_IMAGE_2_RESOLUTION_OPTIONS,
  resolveGptImage2ImageSize,
} from '@/lib/ai-providers/shared/gpt-image-2'

// provider 硬约束:宽高必须能被 16 整除,否则提交必败
// (真实事故:4:3@1K 曾映射出 1440×1080,7/7 图片任务全灭)。
// 这里穷尽固定比例 × 全分辨率,再扫描自由比例区间,任何回归立即被拒。
const FIXED_RATIOS = [
  '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16',
  '21:9', '9:21', '5:4', '4:5', '2:1', '1:2', '3:1', '1:3',
] as const

const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_EDGE = 3840

describe('gpt-image-2 size invariants', () => {
  it('every fixed ratio × resolution yields 16-aligned dimensions inside provider bounds', () => {
    for (const resolution of GPT_IMAGE_2_RESOLUTION_OPTIONS) {
      for (const aspectRatio of FIXED_RATIOS) {
        const { width, height } = resolveGptImage2ImageSize({ aspectRatio, resolution })
        expect(width % 16, `${aspectRatio}@${resolution} width=${String(width)}`).toBe(0)
        expect(height % 16, `${aspectRatio}@${resolution} height=${String(height)}`).toBe(0)
        expect(width).toBeLessThanOrEqual(MAX_EDGE)
        expect(height).toBeLessThanOrEqual(MAX_EDGE)
        expect(width * height).toBeGreaterThanOrEqual(MIN_PIXELS)
        expect(width * height).toBeLessThanOrEqual(MAX_PIXELS)
      }
    }
  })

  it('free-form ratios across the accepted range stay 16-aligned', () => {
    for (const resolution of GPT_IMAGE_2_RESOLUTION_OPTIONS) {
      for (let numerator = 1; numerator <= 30; numerator += 1) {
        for (const denominator of [10, 13, 17]) {
          const ratio = numerator / denominator
          if (ratio < 1 / 3 || ratio > 3) continue
          const aspectRatio = `${String(numerator)}:${String(denominator)}`
          const { width, height } = resolveGptImage2ImageSize({ aspectRatio, resolution })
          expect(width % 16, `${aspectRatio}@${resolution} width=${String(width)}`).toBe(0)
          expect(height % 16, `${aspectRatio}@${resolution} height=${String(height)}`).toBe(0)
        }
      }
    }
  })

  it('regression: 4:3 at 1K no longer produces a height indivisible by 16', () => {
    const { width, height } = resolveGptImage2ImageSize({ aspectRatio: '4:3', resolution: '1K' })
    expect(height % 16).toBe(0)
    expect(width % 16).toBe(0)
    expect(height).not.toBe(1080)
  })
})
