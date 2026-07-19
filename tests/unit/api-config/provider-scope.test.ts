import { describe, expect, it } from 'vitest'
import {
  getAddableModelTypesForProvider,
  getVisibleModelTypesForProvider,
} from '@/app/[locale]/profile/components/api-config/provider-card/ProviderAdvancedFields'
import { getDefaultModelEmptyStateText } from '@/app/[locale]/profile/components/api-config-tab/default-model-empty-state'
import type { CustomModel } from '@/app/[locale]/profile/components/api-config/types'

function model(type: CustomModel['type']): CustomModel {
  return {
    modelId: `${type}-model`,
    modelKey: `google::${type}-model`,
    name: `${type} model`,
    type,
    provider: 'google',
    price: 0,
    enabled: true,
  }
}

describe('api config provider scope', () => {
  it('allows model types only for the supported providers', () => {
    expect(getAddableModelTypesForProvider('ark')).toEqual(['llm', 'image', 'video'])
    expect(getAddableModelTypesForProvider('openrouter')).toEqual(['llm', 'image', 'video'])
    expect(getAddableModelTypesForProvider('fal')).toEqual(['image', 'video'])
    expect(getAddableModelTypesForProvider('google')).toEqual(['llm', 'image', 'video', 'music'])
    expect(getAddableModelTypesForProvider('unsupported-provider')).toEqual([])
  })

  it('shows only llm/image/video/music model sections', () => {
    expect(getVisibleModelTypesForProvider('google', {
      llm: [model('llm')],
      image: [model('image')],
      video: [model('video')],
      music: [model('music')],
    })).toEqual(['llm', 'image', 'video', 'music'])
  })

  it('has empty-state copy for the supported default model types', () => {
    const t = (key: string) => key
    expect(getDefaultModelEmptyStateText('llm', t).description).toBe('defaultModelEmptyState.llmDescription')
    expect(getDefaultModelEmptyStateText('image', t).description).toBe('defaultModelEmptyState.imageDescription')
    expect(getDefaultModelEmptyStateText('video', t).description).toBe('defaultModelEmptyState.videoDescription')
    expect(getDefaultModelEmptyStateText('music', t).description).toBe('defaultModelEmptyState.musicDescription')
  })
})
