import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const getModelsByTypeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-config', () => ({
  getModelsByType: getModelsByTypeMock,
  getProviderKey: (providerId?: string) => {
    if (!providerId) return ''
    const colonIndex = providerId.indexOf(':')
    return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
  },
}))

import { getProjectModelConfig } from '@/lib/config-service'

describe('getProjectModelConfig image defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelsByTypeMock.mockResolvedValue([])
  })

  it('falls back to user Codex image defaults when a project has no image model overrides', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      projectId: 'project-1',
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      audioModel: null,
      videoRatio: '16:9',
      artStyle: null,
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: null,
      characterModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      editModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      audioModel: null,
      capabilityDefaults: null,
    })

    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config.characterModel).toBe(CODEX_DEFAULT_IMAGE_MODEL_KEY)
    expect(config.locationModel).toBe(CODEX_DEFAULT_IMAGE_MODEL_KEY)
    expect(config.storyboardModel).toBe(CODEX_DEFAULT_IMAGE_MODEL_KEY)
    expect(config.editModel).toBe(CODEX_DEFAULT_IMAGE_MODEL_KEY)
  })

  it('keeps explicit project image model overrides ahead of user Codex defaults', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      projectId: 'project-1',
      analysisModel: null,
      characterModel: 'fal::banana-character',
      locationModel: 'fal::banana-location',
      storyboardModel: 'fal::banana-storyboard',
      editModel: 'fal::banana-edit',
      videoModel: null,
      audioModel: null,
      videoRatio: '16:9',
      artStyle: null,
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: null,
      characterModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      editModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      audioModel: null,
      capabilityDefaults: null,
    })

    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config.characterModel).toBe('fal::banana-character')
    expect(config.locationModel).toBe('fal::banana-location')
    expect(config.storyboardModel).toBe('fal::banana-storyboard')
    expect(config.editModel).toBe('fal::banana-edit')
  })
})
