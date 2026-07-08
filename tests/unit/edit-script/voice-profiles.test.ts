import { describe, expect, it } from 'vitest'
import { resolveEditScriptDialogueVoiceContext } from '@/lib/edit-script/voice-profiles'
import type { EditScriptShot } from '@/lib/edit-script/types'

const linXiaoVoiceProfile = {
  ageImpression: '青年女性声感',
  pitchRange: '中低音区',
  timbre: '清冷透明，边缘不尖',
  resonance: '口腔前部共鸣清晰，鼻腔色彩很轻',
  vocalWeight: '偏轻到中等声线',
  texture: '细微气声边缘，表面干净',
} as const

const baseBible = {
  synopsis: '林晓和阿澈在黑暗走廊里听见脚步声。',
  characters: [
    {
      entityId: 'character_lin_xiao',
      name: '林晓',
      aliases: [],
      summary: '在走廊里提醒同伴保持安静的人。',
      voiceProfile: linXiaoVoiceProfile,
    },
  ],
  locations: [],
  worldRules: [],
  styleGuide: {},
} as const

function shotWithDialogue(): EditScriptShot {
  return {
    shotId: 'shot-1',
    shotNumber: 1,
    shotPurpose: 'action',
    durationSec: 3,
    scene: { locationId: 'location-1', name: '走廊', subScene: '门边' },
    action: '林晓贴着门边听外面的脚步声。',
    characters: [
      {
        characterId: 'project-character-lin-xiao',
        name: '林晓',
        visibility: 'visible',
        role: 'focus',
        performance: '压低声音提醒同伴',
      },
    ],
    keyObjects: [],
    dialogue: [
      { characterId: 'project-character-lin-xiao', line: '别开灯。' },
    ],
    sound: '远处脚步声。',
  }
}

describe('edit script dialogue voice context', () => {
  it('binds verbatim dialogue lines to the speaker fixed voice profile', () => {
    const context = resolveEditScriptDialogueVoiceContext({
      storyBibleJson: baseBible,
      shots: [shotWithDialogue()],
    })

    expect(context.characters).toEqual([{
      characterId: 'project-character-lin-xiao',
      name: '林晓',
      voiceProfile: linXiaoVoiceProfile,
      voiceSignature: 'ageImpression=青年女性声感; pitchRange=中低音区; timbre=清冷透明，边缘不尖; resonance=口腔前部共鸣清晰，鼻腔色彩很轻; vocalWeight=偏轻到中等声线; texture=细微气声边缘，表面干净',
    }])
    expect(context.shots[0]?.dialogue).toEqual([{
      characterId: 'project-character-lin-xiao',
      name: '林晓',
      voiceProfile: linXiaoVoiceProfile,
      voiceSignature: 'ageImpression=青年女性声感; pitchRange=中低音区; timbre=清冷透明，边缘不尖; resonance=口腔前部共鸣清晰，鼻腔色彩很轻; vocalWeight=偏轻到中等声线; texture=细微气声边缘，表面干净',
      line: '别开灯。',
    }])
  })

  it('fails explicitly when a dialogue speaker has no bible voice profile', () => {
    const shot = {
      ...shotWithDialogue(),
      characters: [{
        ...shotWithDialogue().characters[0]!,
        name: '阿澈',
      }],
    }

    expect(() => resolveEditScriptDialogueVoiceContext({
      storyBibleJson: baseBible,
      shots: [shot],
    })).toThrow('EDIT_SCRIPT_DIALOGUE_VOICE_PROFILE_MISSING:1:阿澈')
  })

  it('rejects legacy free-text voice profiles instead of accepting delivery state as timbre', () => {
    expect(() => resolveEditScriptDialogueVoiceContext({
      storyBibleJson: {
        ...baseBible,
        characters: [{
          ...baseBible.characters[0],
          voiceProfile: '清冷偏低的青年女声，音量压得很轻，语速短促。',
        }],
      },
      shots: [shotWithDialogue()],
    })).toThrow()
  })
})
