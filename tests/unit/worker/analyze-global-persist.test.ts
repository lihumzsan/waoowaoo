import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  projectCharacter: {
    create: vi.fn(async () => ({ id: 'character-1' })),
    update: vi.fn(async () => ({})),
  },
  characterAppearance: {
    create: vi.fn(async () => ({})),
  },
  projectLocation: {
    create: vi.fn(async () => ({ id: 'location-1' })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/assets/services/location-backed-assets', () => ({
  seedProjectLocationBackedImageSlots: vi.fn(async () => undefined),
}))

import { createAnalyzeGlobalStats, persistAnalyzeGlobalChunk } from '@/lib/workers/handlers/analyze-global-persist'

describe('analyze global persist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
      await callback(prismaMock),
    )
  })

  it('persists analyzed character appearances directly without a second visual-profile task', async () => {
    const stats = createAnalyzeGlobalStats(1)

    await persistAnalyzeGlobalChunk({
      projectId: 'project-1',
      charactersData: {
        new_characters: [{
          name: '武僧',
          aliases: ['山寺僧人'],
          introduction: '山寺武僧，故事核心角色',
          personality_tags: ['沉稳', '克制'],
          visual_keywords: ['旧棉麻质感', '低饱和武侠'],
          appearances: [{
            id: 1,
            change_reason: '初始形象',
            descriptions: ['武僧，剃发，旧棉麻僧衣，深色布鞋，低饱和武侠电影质感'],
          }],
        }],
      },
      locationsData: { locations: [] },
      propsData: { props: [] },
      existingCharacters: [],
      existingCharacterNames: [],
      existingLocationNames: [],
      existingLocationInfo: [],
      existingPropNames: [],
      stats,
    })

    expect(stats.newCharacters).toBe(1)
    expect(prismaMock.projectCharacter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        name: '武僧',
        profileConfirmed: true,
      }),
      select: { id: true },
    })
    expect(prismaMock.characterAppearance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'character-1',
        appearanceIndex: 0,
        changeReason: '初始形象',
        description: '武僧，剃发，旧棉麻僧衣，深色布鞋，低饱和武侠电影质感',
      }),
    })
  })
})
