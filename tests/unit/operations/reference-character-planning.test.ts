import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const prismaMock = vi.hoisted(() => ({
  characterAppearance: { findFirst: vi.fn() },
  projectCharacter: { findFirst: vi.fn() },
  globalCharacterAppearance: { findFirst: vi.fn() },
  globalCharacter: { findFirst: vi.fn() },
}))

const configMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({ characterModel: 'fal::gpt-image-2' })),
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'fal::gpt-image-2',
    analysisModel: 'openrouter::analysis',
    capabilityDefaults: {},
  })),
  buildImageBillingPayload: vi.fn(async (input: {
    imageModel: string
    basePayload: Record<string, unknown>
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
    generationOptions: { resolution: '1K', quality: 'medium', aspectRatio: '16:9' },
  })),
  buildImageBillingPayloadFromUserConfig: vi.fn((input: {
    imageModel: string
    basePayload: Record<string, unknown>
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
    generationOptions: { resolution: '1K', quality: 'medium', aspectRatio: '16:9' },
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/user-api/runtime-config', () => ({
  resolveModelSelection: vi.fn(async () => ({ modelKey: 'fal::gpt-image-2' })),
}))

import { planReferenceCharacterGeneration } from '@/lib/operations/domains/reference-character-operations'

function createContext(projectId: string) {
  return {
    request: buildMockRequest({
      path: '/api/reference-plan',
      method: 'POST',
      headers: { 'accept-language': 'en' },
    }),
    projectId,
    userId: 'user-1',
    context: {},
    source: 'project-ui',
    writer: null,
    toolCallId: null,
  }
}

describe('reference character immutable planning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.characterAppearance.findFirst.mockResolvedValue({ id: 'appearance-1', characterId: 'character-1' })
    prismaMock.globalCharacterAppearance.findFirst.mockResolvedValue({ id: 'appearance-1', characterId: 'character-1' })
  })

  it('quotes project image generation as image billing and binds the owned appearance', async () => {
    const plan = await planReferenceCharacterGeneration({
      ctx: createContext('project-1'),
      scope: 'project',
      operationId: 'reference_to_character',
      input: {
        referenceImageUrls: ['https://example.com/reference.png'],
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        isBackgroundJob: true,
        count: 2,
      },
    })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]).toMatchObject({
      taskType: 'reference_to_character',
      target: { targetType: 'CharacterAppearance', targetId: 'appearance-1' },
      billingInfo: { billable: true, apiType: 'image', quantity: 2 },
      payload: {
        imageModel: 'fal::gpt-image-2',
        extractOnly: false,
        referenceImageUrls: ['https://example.com/reference.png'],
      },
    })
  })

  it('fails closed when an asset-hub target does not belong to the user', async () => {
    prismaMock.globalCharacterAppearance.findFirst.mockResolvedValueOnce(null)
    await expect(planReferenceCharacterGeneration({
      ctx: createContext('global-asset-hub'),
      scope: 'asset_hub',
      operationId: 'asset_hub_reference_to_character',
      input: {
        referenceImageUrls: ['https://example.com/reference.png'],
        characterId: 'character-1',
        appearanceId: 'someone-else-appearance',
        isBackgroundJob: true,
      },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
