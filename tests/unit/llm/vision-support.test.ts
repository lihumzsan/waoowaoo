import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveModelSelectionMock = vi.hoisted(() => vi.fn(async () => ({
  provider: 'openrouter',
  modelId: 'vision-model',
  modelKey: 'openrouter::vision-model',
  mediaType: 'llm',
  variantSubKind: 'official',
})))

const resolveAiProviderAdapterMock = vi.hoisted(() => vi.fn(() => ({
  providerKey: 'openrouter',
  completeVision: vi.fn(),
})))

vi.mock('@/lib/user-api/runtime-config', () => ({
  resolveModelSelection: resolveModelSelectionMock,
}))

vi.mock('@/lib/ai-providers', () => ({
  resolveAiProviderAdapter: resolveAiProviderAdapterMock,
}))

import { assertVisionModelSupported } from '@/lib/ai-exec/vision-support'

describe('vision model support guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveModelSelectionMock.mockResolvedValue({
      provider: 'openrouter',
      modelId: 'vision-model',
      modelKey: 'openrouter::vision-model',
      mediaType: 'llm',
      variantSubKind: 'official',
    })
    resolveAiProviderAdapterMock.mockReturnValue({
      providerKey: 'openrouter',
      completeVision: vi.fn(),
    })
  })

  it('accepts an llm model whose provider implements vision completion', async () => {
    await expect(assertVisionModelSupported({
      userId: 'user-1',
      model: 'openrouter::vision-model',
      errorCode: 'LOCATION_SPATIAL_PROFILE_MODEL_UNSUPPORTED',
    })).resolves.toBeUndefined()

    expect(resolveModelSelectionMock).toHaveBeenCalledWith('user-1', 'openrouter::vision-model', 'llm')
    expect(resolveAiProviderAdapterMock).toHaveBeenCalledWith('openrouter')
  })

  it('rejects an llm model whose provider does not implement vision completion', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'example',
      modelId: 'text-only',
      modelKey: 'example::text-only',
      mediaType: 'llm',
      variantSubKind: 'official',
    })
    resolveAiProviderAdapterMock.mockReturnValueOnce({
      providerKey: 'example',
    })

    await expect(assertVisionModelSupported({
      userId: 'user-1',
      model: 'example::text-only',
      errorCode: 'LOCATION_SPATIAL_PROFILE_MODEL_UNSUPPORTED',
    })).rejects.toThrow('LOCATION_SPATIAL_PROFILE_MODEL_UNSUPPORTED:example::text-only')
  })
})
