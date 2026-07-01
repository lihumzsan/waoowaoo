import { describe, expect, it } from 'vitest'
import { buildProfileBillingDetailParts, getProfileTransactionActionTranslationKey } from '@/lib/profile/billing-transaction-display'
import { TASK_TYPE } from '@/lib/task/types'

describe('profile billing transaction display', () => {
  it('uses task action labels for consumption rows instead of the generic consume label', () => {
    expect(getProfileTransactionActionTranslationKey('consume', TASK_TYPE.IMAGE_PANEL)).toBe('actionTypes.image_panel')
    expect(getProfileTransactionActionTranslationKey('recharge', TASK_TYPE.IMAGE_PANEL)).toBe('transactionKinds.recharge')
  })

  it('builds image billing detail parts with model and image specification', () => {
    const parts = buildProfileBillingDetailParts({
      quantity: 1,
      unit: 'image',
      model: 'doubao-seedream-4-5-251128',
      resolution: '1080p',
      aspectRatio: '9:16',
    })

    expect(parts).toEqual([
      {
        kind: 'translation',
        key: 'billingDetail.imageWithRes',
        params: {
          count: 1,
          resolution: '1080p · 9:16',
        },
      },
      {
        kind: 'text',
        text: 'doubao-seedream-4-5-251128',
      },
    ])
  })

  it('builds token billing detail from actual input and output tokens', () => {
    const parts = buildProfileBillingDetailParts({
      unit: 'token',
      model: 'claude-sonnet-4',
      inputTokens: 1200,
      outputTokens: 300,
    })

    expect(parts[0]).toEqual({
      kind: 'translation',
      key: 'billingDetail.tokensWithBreakdown',
      params: {
        input: 1200,
        output: 300,
      },
    })
  })
})
