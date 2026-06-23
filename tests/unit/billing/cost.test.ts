import { describe, expect, it } from 'vitest'
import {
  calcImage,
  calcMusic,
  calcText,
  calcTextWithCache,
  calcVideo,
  calcVideoByTokens,
} from '@/lib/billing/cost'

describe('billing/cost provider catalog pricing', () => {
  it('charges text from provider input and output token tiers', () => {
    const cost = calcText('openrouter::anthropic/claude-sonnet-4.6', 1_000_000, 1_000_000)

    expect(cost).toBeCloseTo(129.6, 8)
  })

  it('discounts Google implicit cache hit input tokens', () => {
    const cost = calcTextWithCache('google::gemini-3-flash-preview', 1_000_000, 0, {
      cachedInputTokens: 400_000,
    })

    expect(cost).toBeCloseTo(2.304, 8)
  })

  it('charges images from provider size and quality tiers', () => {
    const cost = calcImage('fal::gpt-image-2', 2, {
      imageSize: '1024x1024',
      quality: 'high',
    })

    expect(cost).toBeCloseTo(3.0384, 8)
  })

  it('derives GPT Image 2 image size from product resolution and aspect ratio', () => {
    const cost = calcImage('fal::gpt-image-2', 1, {
      resolution: '1K',
      aspectRatio: '16:9',
      quality: 'medium',
    })

    expect(cost).toBeCloseTo(0.288, 8)
  })

  it('charges OpenRouter Seedance video by provider per-second tiers', () => {
    const cost = calcVideo('openrouter::bytedance/seedance-2.0-fast', '720p', 1, {
      duration: 4,
    })

    expect(cost).toBeCloseTo(3.48624, 8)
  })

  it('settles token-based video calls through the same provider video catalog', () => {
    const cost = calcVideoByTokens('openrouter::bytedance/seedance-2.0-fast', 120_000, {
      duration: 6,
      resolution: '720p',
    })

    expect(cost).toBeCloseTo(5.22936, 8)
  })

  it('charges Lyria 3 Pro music as a provider-priced audio call', () => {
    const cost = calcMusic('fal::fal-ai/lyria3/pro', 1, {
      durationSeconds: 180,
    })

    expect(cost).toBeCloseTo(0.576, 8)
  })
})
