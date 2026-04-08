import { describe, expect, it } from 'vitest'
import {
  getAddableModelTypesForProvider,
  getVisibleModelTypesForProvider,
} from '@/app/[locale]/profile/components/api-config/provider-card/ProviderAdvancedFields'
import { shouldShowProviderModelInCard } from '@/app/[locale]/profile/components/api-config/provider-card/hooks/useProviderCardState'

describe('provider card model type filters', () => {
  it('limits bailian coding plan cards to text models', () => {
    expect(getAddableModelTypesForProvider('bailian', {
      isBailianCodingPlan: true,
    })).toEqual(['llm'])
  })

  it('hides bailian coding plan non-text tabs even when saved models exist', () => {
    const visibleTypes = getVisibleModelTypesForProvider('bailian', {
      llm: [{
        modelId: 'qwen3.5-plus',
        modelKey: 'bailian::qwen3.5-plus',
        name: 'Qwen 3.5 Plus',
        type: 'llm',
        provider: 'bailian',
        price: 0,
        enabled: true,
      }],
      video: [{
        modelId: 'wan2.7-i2v',
        modelKey: 'bailian::wan2.7-i2v',
        name: 'Wan2.7 I2V',
        type: 'video',
        provider: 'bailian',
        price: 0,
        enabled: true,
      }],
    }, {
      isBailianCodingPlan: true,
    })

    expect(visibleTypes).toEqual(['llm'])
  })

  it('disables manual add actions for bailian coding plan cards', () => {
    expect(getAddableModelTypesForProvider('bailian', {
      isBailianCodingPlan: true,
      allowManualAdd: false,
    })).toEqual([])
  })

  it('hides unsupported bailian llm ids on coding plan cards', () => {
    expect(shouldShowProviderModelInCard({
      providerKey: 'bailian',
      apiKey: 'sk-sp-demo',
      model: {
        modelId: 'qwen3.5-flash',
        modelKey: 'bailian::qwen3.5-flash',
        name: 'Qwen 3.5 Flash',
        type: 'llm',
        provider: 'bailian',
        price: 0,
        enabled: false,
      },
    })).toBe(false)
  })
})
