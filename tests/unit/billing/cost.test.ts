import { describe, expect, it } from 'vitest'
import {
  PRODUCT_CREDIT_PRICING,
  calcImage,
  calcLipSync,
  calcMusic,
  calcText,
  calcVideo,
  calcVideoByTokens,
  calcVoice,
  calcVoiceDesign,
} from '@/lib/billing/cost'

describe('billing/cost product credits', () => {
  it('charges text by product token credits without provider price mapping', () => {
    const cost = calcText('unknown-provider::unknown-model', 1500, 500)

    expect(cost).toBeCloseTo(0.02, 8)
  })

  it('charges images by generated unit count', () => {
    expect(calcImage('any-image-model', 3)).toBe(PRODUCT_CREDIT_PRICING.imagePerUnit * 3)
  })

  it('charges videos by duration with a minimum per clip', () => {
    expect(calcVideo('any-video-model', '720p', 1, { duration: 2 })).toBe(PRODUCT_CREDIT_PRICING.videoMinimumPerClip)
    expect(calcVideo('any-video-model', '1080p', 2, { duration: 8 })).toBe(16)
  })

  it('settles token-based video providers back to product video credits', () => {
    expect(calcVideoByTokens('any-video-model', 120_000, { duration: 6, resolution: '720p' })).toBe(6)
  })

  it('charges music, voice, voice design, and lip sync from product credits', () => {
    expect(calcMusic('any-music-model', 30)).toBe(6)
    expect(calcVoice(20)).toBe(1)
    expect(calcVoiceDesign()).toBe(1)
    expect(calcLipSync('any-lipsync-model')).toBe(2)
  })
})
