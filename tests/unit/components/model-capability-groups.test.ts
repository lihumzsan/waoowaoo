import { describe, expect, it } from 'vitest'
import {
  groupModelCapabilityOptions,
  resolveSelectedModelProviderLabel,
} from '@/components/ui/config-modals/model-capability-groups'

describe('model capability provider grouping', () => {
  const models = [
    { value: 'ark::doubao-lite', provider: 'ark', providerName: '火山引擎 Ark' },
    { value: 'ark::doubao-pro', provider: 'ark', providerName: '火山引擎 Ark' },
    { value: 'google::gemini-flash', provider: 'google', providerName: 'Google AI Studio' },
    { value: 'bailian::wan', provider: 'bailian', providerName: '阿里云百炼' },
  ]

  it('keeps model options grouped by provider display name in source order', () => {
    const groups = groupModelCapabilityOptions(models, '其他厂商')

    expect(groups.map(([providerLabel]) => providerLabel)).toEqual([
      '火山引擎 Ark',
      'Google AI Studio',
      '阿里云百炼',
    ])
    expect(groups[0]?.[1].map((model) => model.value)).toEqual([
      'ark::doubao-lite',
      'ark::doubao-pro',
    ])
  })

  it('resolves the selected model provider so dropdowns can open at that provider section', () => {
    expect(resolveSelectedModelProviderLabel(models, 'google::gemini-flash', '其他厂商')).toBe('Google AI Studio')
    expect(resolveSelectedModelProviderLabel(models, 'missing::model', '其他厂商')).toBeNull()
  })

  it('uses the localized fallback provider label when model metadata has no provider', () => {
    const groups = groupModelCapabilityOptions([{ value: 'custom::model' }], '其他厂商')

    expect(groups).toEqual([
      ['其他厂商', [{ value: 'custom::model' }]],
    ])
  })
})
