import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiConfig } from '@/app/[locale]/profile/components/api-config/types'
import type { WorkflowConcurrency } from '@/app/[locale]/profile/components/api-config/selectors'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_DEFAULT_IMAGE_MODEL_ID,
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_DEFAULT_MODEL_ID,
  CODEX_DEFAULT_MODEL_KEY,
  CODEX_PROVIDER_KEY,
} from '@/lib/ai-providers/codex/constants'

type StateSetter<T> = (next: T | ((previous: T) => T)) => void

const reactHookMocks = vi.hoisted(() => ({
  useState: vi.fn(<T,>(initial: T): [T, StateSetter<T>] => {
    let current = initial
    const setState: StateSetter<T> = (next) => {
      current = typeof next === 'function'
        ? (next as (previous: T) => T)(current)
        : next
    }
    return [current, setState]
  }),
  useEffect: vi.fn((effect: () => void | (() => void)) => {
    effect()
  }),
  useRef: vi.fn(<T,>(initial: T): { current: T } => ({ current: initial })),
  useCallback: vi.fn(<T,>(callback: T): T => callback),
}))

const queryMock = vi.hoisted(() => ({
  data: undefined as unknown,
}))

const saverMock = vi.hoisted(() => ({
  performSave: vi.fn(async () => true),
  flushConfig: vi.fn(async () => undefined),
}))

vi.mock('react', () => reactHookMocks)

vi.mock('next-intl', () => ({
  useLocale: () => 'zh',
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[locale]/profile/components/api-config/query', () => ({
  useUserApiConfigQuery: () => ({
    data: queryMock.data,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/app/[locale]/profile/components/api-config/editor', () => ({
  useApiConfigSaver: () => ({
    saveStatus: 'idle',
    performSave: saverMock.performSave,
    flushConfig: saverMock.flushConfig,
  }),
}))

import { useProviders } from '@/app/[locale]/profile/components/api-config/hooks'

describe('useProviders Codex default migration', () => {
  afterEach(() => {
    vi.clearAllMocks()
    queryMock.data = undefined
  })

  it('preserves workflow concurrency and capability defaults when saving Codex migration', () => {
    const workflowConcurrency: WorkflowConcurrency = {
      analysis: 7,
      image: 8,
      video: 9,
    }
    const capabilityDefaults = {
      [CODEX_DEFAULT_IMAGE_MODEL_KEY]: {
        resolution: '1024x1024',
      },
    }
    const apiConfig: ApiConfig = {
      providers: [],
      models: [],
      defaultModels: {},
      workflowConcurrency,
      capabilityDefaults,
      pricingDisplay: {},
      catalog: {
        providers: [{
          id: CODEX_PROVIDER_KEY,
          name: 'Codex Local',
          baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH,
        }],
        models: [
          {
            provider: CODEX_PROVIDER_KEY,
            modelId: CODEX_DEFAULT_MODEL_ID,
            name: 'Codex GPT 5.5',
            type: 'llm',
          },
          {
            provider: CODEX_PROVIDER_KEY,
            modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
            name: 'Codex GPT Image 2',
            type: 'image',
          },
        ],
      },
    }
    queryMock.data = apiConfig

    useProviders()

    expect(saverMock.performSave).toHaveBeenCalledWith({
      defaultModels: {
        analysisModel: CODEX_DEFAULT_MODEL_KEY,
        characterModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        locationModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        storyboardModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        editModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      },
      workflowConcurrency,
      capabilityDefaults,
    })
  })
})
