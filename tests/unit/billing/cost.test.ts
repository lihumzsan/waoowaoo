import { describe, expect, it } from 'vitest'
import {
  calcImage,
  calcMusic,
  calcText,
  calcTextWithCache,
  calcVideo,
} from '@/lib/billing/cost'
import { CREDITS_PER_CNY } from '@/lib/billing/credits'
import { RETAIL_MARKUP_BY_API_TYPE } from '@/lib/ai-registry/pricing-retail'
import { SEEDANCE_2_RETAIL_CREDITS_PER_SECOND } from '@/lib/ai-providers/shared/seedance-pricing'
import { USD_TO_CNY } from '@/lib/ai-registry/pricing-currency'

/**
 * The oracle here is the arithmetic between a provider's published price and
 * what we charge: `retail credits = provider USD * USD_TO_CNY * markup * 10`.
 * Expectations are written as that expression against the published USD figure
 * rather than as a literal, so a catalog edit that changes what a user pays
 * fails here instead of being absorbed into a new magic number.
 */
function usdToRetailCredits(amountUsd: number, apiType: 'text' | 'image' | 'video' | 'music' | 'voice'): number {
  return amountUsd * USD_TO_CNY * RETAIL_MARKUP_BY_API_TYPE[apiType] * CREDITS_PER_CNY
}

function cnyToRetailCredits(amountCny: number, apiType: 'text' | 'image' | 'video' | 'music' | 'voice'): number {
  return amountCny * RETAIL_MARKUP_BY_API_TYPE[apiType] * CREDITS_PER_CNY
}

describe('billing/cost charges the retail face of the provider catalog', () => {
  it('charges text from provider input and output token tiers', () => {
    // Claude Sonnet 4.6 lists at $3 / $15 per million tokens.
    const cost = calcText('openrouter::anthropic/claude-sonnet-4.6', 1_000_000, 1_000_000)

    expect(cost).toBeCloseTo(usdToRetailCredits(3, 'text') + usdToRetailCredits(15, 'text'), 6)
  })

  it('charges Claude Fable 5 from its OpenRouter token tiers', () => {
    // $10 / $50 per million tokens.
    expect(calcText('openrouter::anthropic/claude-fable-5', 1_000_000, 1_000_000))
      .toBeCloseTo(usdToRetailCredits(10, 'text') + usdToRetailCredits(50, 'text'), 6)
  })

  it('discounts Google implicit cache hit input tokens', () => {
    // Gemini 3.5 Flash input is ¥19.44 per million; cached input bills at 10%.
    const cost = calcTextWithCache('google::gemini-3.5-flash', 1_000_000, 0, {
      cachedInputTokens: 400_000,
    })

    const fullRate = cnyToRetailCredits(19.44, 'text')
    expect(cost).toBeCloseTo(fullRate * 0.6 + fullRate * 0.4 * 0.1, 6)
  })

  it('charges images from provider size and quality tiers, rounded up to whole credits', () => {
    // GPT Image 2 at 1024x1024 high lists at $0.211 per image.
    const perImage = Math.ceil(usdToRetailCredits(0.211, 'image'))
    const cost = calcImage('fal::gpt-image-2', 2, {
      imageSize: '1024x1024',
      quality: 'high',
    })

    expect(cost).toBe(perImage * 2)
  })

  it('derives GPT Image 2 image size from product resolution and aspect ratio', () => {
    // 1K 16:9 resolves to the 1920x1080 tier, which lists at $0.040 medium.
    const cost = calcImage('fal::gpt-image-2', 1, {
      resolution: '1K',
      aspectRatio: '16:9',
      quality: 'medium',
    })

    expect(cost).toBe(Math.ceil(usdToRetailCredits(0.04, 'image')))
  })

  it('charges the same Seedance retail rate on every route it actually bills', () => {
    const duration = 4
    const expected = SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.fast['720p'] * duration

    // OpenRouter serves Seedance in production and Ark is the same model at a
    // comparable cost, so the user pays the same on either. FAL resells the
    // same model at roughly twice the cost and is deliberately not held to the
    // product rate — pricing it there would sell it below cost.
    for (const model of [
      'openrouter::bytedance/seedance-2.0-fast',
      'ark::doubao-seedance-2-0-fast-260128',
    ]) {
      expect(calcVideo(model, '720p', 1, { duration })).toBe(expected)
    }
    expect(calcVideo('fal::bytedance/seedance-2.0/fast', '720p', 1, { duration }))
      .toBeGreaterThan(expected)
  })

  it('charges Seedance per second of output, not per call', () => {
    const rate = SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['720p']

    expect(calcVideo('ark::doubao-seedance-2-0-260128', '720p', 1, { duration: 5 })).toBe(rate * 5)
    expect(calcVideo('ark::doubao-seedance-2-0-260128', '720p', 1, { duration: 10 })).toBe(rate * 10)
  })

  it('charges Lyria 3 Pro music as a provider-priced audio call', () => {
    // $0.08 per generation.
    const cost = calcMusic('fal::fal-ai/lyria3/pro', 1, {
      durationSeconds: 180,
    })

    expect(cost).toBe(Math.ceil(usdToRetailCredits(0.08, 'music')))
  })
})
