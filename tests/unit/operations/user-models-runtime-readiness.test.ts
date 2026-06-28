import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY, CODEX_DEFAULT_MODEL_KEY, CODEX_PROVIDER_KEY } from '@/lib/ai-providers/codex/constants'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-exec/catalog-bootstrap', () => ({ ensureAiCatalogsRegistered: vi.fn() }))
vi.mock('@/lib/ai-registry/capabilities-catalog', () => ({ findBuiltinCapabilities: vi.fn(() => undefined) }))
vi.mock('@/lib/ai-registry/pricing-catalog', () => ({ findBuiltinPricingCatalogEntry: vi.fn(() => undefined) }))

import { createUserModelsOperations } from '@/lib/operations/domains/config/user-models-ops'

interface UserModelOption {
  value: string
}

interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  music: UserModelOption[]
}

function buildContext() {
  return {
    request: new Request('http://localhost/api/user/models') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'system',
    context: {},
    source: 'test',
    writer: null,
    toolCallId: null,
  }
}

describe('list_user_models runtime readiness', () => {
  const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
  const originalProviderCredentialMode = process.env.PROVIDER_CREDENTIAL_MODE

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'self-hosted'
    process.env.PROVIDER_CREDENTIAL_MODE = 'user-key'
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalProviderCredentialMode === undefined) {
      delete process.env.PROVIDER_CREDENTIAL_MODE
    } else {
      process.env.PROVIDER_CREDENTIAL_MODE = originalProviderCredentialMode
    }
  })

  it('keeps Codex local CLI models selectable without an API key while filtering unconfigured API-key providers', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customProviders: JSON.stringify([
        { id: CODEX_PROVIDER_KEY, name: 'Codex', apiKey: '' },
        { id: 'openrouter', name: 'OpenRouter', apiKey: '' },
        { id: 'fal', name: 'FAL', apiKey: 'fal-key' },
      ]),
      customModels: JSON.stringify([
        {
          modelId: 'gpt-5.5',
          modelKey: CODEX_DEFAULT_MODEL_KEY,
          name: 'Codex GPT 5.5',
          type: 'llm',
          provider: CODEX_PROVIDER_KEY,
        },
        {
          modelId: 'gpt-image-2',
          modelKey: CODEX_DEFAULT_IMAGE_MODEL_KEY,
          name: 'Codex GPT Image 2',
          type: 'image',
          provider: CODEX_PROVIDER_KEY,
        },
        {
          modelId: 'openai/gpt-5',
          modelKey: 'openrouter::openai/gpt-5',
          name: 'OpenRouter GPT',
          type: 'llm',
          provider: 'openrouter',
        },
        {
          modelId: 'fal-ai/veo',
          modelKey: 'fal::fal-ai/veo',
          name: 'FAL Video',
          type: 'video',
          provider: 'fal',
        },
      ]),
    })

    const result = await createUserModelsOperations().list_user_models.execute(buildContext(), {}) as UserModelsPayload

    expect(result.llm.map((model) => model.value)).toEqual([CODEX_DEFAULT_MODEL_KEY])
    expect(result.image.map((model) => model.value)).toEqual([CODEX_DEFAULT_IMAGE_MODEL_KEY])
    expect(result.video.map((model) => model.value)).toEqual(['fal::fal-ai/veo'])
    expect(result.music).toEqual([])
  })
})
