import { describe, expect, it } from 'vitest'
import {
  buildProfileBillingDetailParts,
  buildProfileTransactionScopeLines,
  getProfileTransactionActionTranslationKey,
} from '@/lib/profile/billing-transaction-display'
import { TASK_TYPE } from '@/lib/task/types'

describe('profile billing transaction display', () => {
  it('uses task action labels for consumption rows instead of the generic consume label', () => {
    expect(getProfileTransactionActionTranslationKey('consume', TASK_TYPE.IMAGE_PANEL)).toBe('actionTypes.image_panel')
    expect(getProfileTransactionActionTranslationKey('recharge', TASK_TYPE.IMAGE_PANEL)).toBe('transactionKinds.recharge')
  })

  it('uses sync billing action labels that include hyphenated prompt ids', () => {
    expect(getProfileTransactionActionTranslationKey('consume', 'shot-execution-plan')).toBe('actionTypes.shot-execution-plan')
    expect(getProfileTransactionActionTranslationKey('consume', 'asset-extract')).toBe('actionTypes.asset-extract')
    expect(getProfileTransactionActionTranslationKey('consume', 'unknown_action')).toBe('transactionKinds.consume')
  })

  it('keeps transaction subject display scoped to the project name only', () => {
    expect(buildProfileTransactionScopeLines({
      projectName: '新项目 06-30 21:06',
      episodeNumber: 1,
      episodeName: '剧集 1',
      target: {
        targetType: 'ProjectPanel',
        targetId: 'group:ProjectPanel',
        labelKey: 'transactionTargets.projectPanelGroup',
        labelParams: { count: 3 },
      },
    })).toEqual(['新项目 06-30 21:06'])

    expect(buildProfileTransactionScopeLines({
      projectName: '  ',
    })).toEqual([])
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

  it('does not show a zero output-token breakdown for input-only token billing', () => {
    const parts = buildProfileBillingDetailParts({
      quantity: 12000,
      unit: 'token',
      model: 'google/gemini-3.5-flash',
      inputTokens: 12000,
      outputTokens: 0,
    })

    expect(parts[0]).toEqual({
      kind: 'translation',
      key: 'billingDetail.tokens',
      params: {
        count: 12000,
      },
    })

    const missingOutputParts = buildProfileBillingDetailParts({
      quantity: 27003,
      unit: 'token',
      model: 'google/gemini-3.5-flash',
    })

    expect(missingOutputParts[0]).toEqual({
      kind: 'translation',
      key: 'billingDetail.tokens',
      params: {
        count: 27003,
      },
    })
  })
})
