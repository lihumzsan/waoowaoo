import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  }
})

import { useApiConfigFilters } from '@/app/[locale]/profile/components/api-config-tab/hooks/useApiConfigFilters'
import type { CustomModel, Provider } from '@/app/[locale]/profile/components/api-config/types'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_DEFAULT_IMAGE_MODEL_ID,
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_DEFAULT_MODEL_KEY,
  CODEX_PROVIDER_KEY,
} from '@/lib/ai-providers/codex/constants'

describe('api config filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes Codex text and image models without requiring an API key', () => {
    const providers: Provider[] = [
      {
        id: CODEX_PROVIDER_KEY,
        name: 'Codex Local',
        hasApiKey: false,
        baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH,
      },
    ]
    const models: CustomModel[] = [
      {
        modelId: 'gpt-5.5',
        modelKey: CODEX_DEFAULT_MODEL_KEY,
        name: 'Codex GPT 5.5',
        type: 'llm',
        provider: CODEX_PROVIDER_KEY,
        price: 0,
        enabled: true,
      },
      {
        modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
        modelKey: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        name: 'Codex GPT Image 2',
        type: 'image',
        provider: CODEX_PROVIDER_KEY,
        price: 0,
        enabled: true,
      },
    ]

    const result = useApiConfigFilters({ providers, models })

    expect(result.modelProviders.map((provider) => provider.id)).toEqual([CODEX_PROVIDER_KEY])
    expect(result.getEnabledModelsByType('llm').map((model) => model.modelKey)).toEqual([
      CODEX_DEFAULT_MODEL_KEY,
    ])
    expect(result.getEnabledModelsByType('image').map((model) => model.modelKey)).toEqual([
      CODEX_DEFAULT_IMAGE_MODEL_KEY,
    ])
  })
})
