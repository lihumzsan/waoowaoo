import { describe, expect, it, vi } from 'vitest'
import {
  createProjectCharacterWithAnalyzedAppearances,
  readAnalyzedCharacterAppearances,
  type CharacterAnalysisDb,
} from '@/lib/workers/handlers/analyzed-character-appearance'

describe('analyzed character appearance persistence', () => {
  it('creates a confirmed character and direct appearance rows from analyzed output', async () => {
    const db: CharacterAnalysisDb = {
      projectCharacter: {
        create: vi.fn(async () => ({ id: 'character-1' })),
      },
      characterAppearance: {
        create: vi.fn(async () => ({})),
      },
    }

    const created = await createProjectCharacterWithAnalyzedAppearances({
      db,
      projectId: 'project-1',
      name: '武僧',
      aliases: ['僧人'],
      introduction: '山寺武僧，故事中的核心修行者',
      character: {
        role_level: 'S',
        archetype: '武僧',
        personality_tags: ['沉稳', '克制'],
        visual_keywords: ['旧棉麻质感', '克制轮廓'],
        style_alignment_notes: '服装材质和低饱和配色服从东方武侠电影 Style Bible',
        appearances: [{
          id: 1,
          change_reason: '初始形象',
          descriptions: [
            '武僧，剃发，精瘦有力，旧棉麻僧衣，深色布鞋，低饱和东方武侠质感',
            '武僧，眉骨清晰，灰褐僧衣，素布束带，深色布鞋，旧木与晨雾质感',
          ],
        }],
      },
    })

    expect(created).toEqual({ id: 'character-1' })
    expect(db.projectCharacter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        name: '武僧',
        aliases: JSON.stringify(['僧人']),
        introduction: '山寺武僧，故事中的核心修行者',
        profileConfirmed: true,
      }),
      select: { id: true },
    })
    expect(db.characterAppearance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'character-1',
        appearanceIndex: 0,
        changeReason: '初始形象',
        description: '武僧，剃发，精瘦有力，旧棉麻僧衣，深色布鞋，低饱和东方武侠质感',
        descriptions: JSON.stringify([
          '武僧，剃发，精瘦有力，旧棉麻僧衣，深色布鞋，低饱和东方武侠质感',
          '武僧，眉骨清晰，灰褐僧衣，素布束带，深色布鞋，旧木与晨雾质感',
        ]),
        imageUrls: '[]',
        previousImageUrls: '[]',
      }),
    })
  })

  it('fails explicitly when analyzed appearances omit descriptions', () => {
    expect(() => readAnalyzedCharacterAppearances({
      name: '角色A',
      appearances: [{ id: 1, change_reason: '初始形象' }],
    })).toThrow('ANALYZED_CHARACTER_APPEARANCE_DESCRIPTIONS_MISSING:角色A:1')
  })
})
