import { describe, expect, it } from 'vitest'
import { buildPrompt } from '@/lib/prompt-i18n/build-prompt'
import { PROMPT_IDS } from '@/lib/prompt-i18n/prompt-ids'
import {
  buildComfyUiDesignedVoiceId,
  buildFishAudioS2RenderText,
  buildVoiceDesignCharacterContextSummary,
  isComfyUiDesignedVoiceId,
} from '@/lib/voice-design/fish-audio-s2'

describe('fish audio s2 voice helpers', () => {
  it('builds a readable character context summary from profile and appearance data', () => {
    const summary = buildVoiceDesignCharacterContextSummary({
      name: 'Doctor Chen',
      aliases: 'Old Chen / Dr. Chen',
      introduction: 'A senior physician who speaks in a calm and controlled way.',
      profileData: JSON.stringify({
        role_level: 'B',
        archetype: 'professional doctor',
        personality_tags: ['strict', 'calm'],
        era_period: 'modern city',
        social_class: 'middle class',
        occupation: 'doctor',
        costume_tier: 3,
        suggested_colors: ['white'],
        visual_keywords: ['silver glasses'],
        gender: 'male',
        age_range: 'middle-aged',
      }),
      appearances: [
        {
          label: 'default',
          description: 'White coat, glasses, and restrained body language.',
        },
      ],
    })

    expect(summary).toContain('Doctor Chen')
    expect(summary).toContain('doctor')
    expect(summary).toContain('strict')
    expect(summary).toContain('White coat, glasses, and restrained body language.')
  })

  it('creates a stable comfyui-designed voice id prefix', () => {
    const voiceId = buildComfyUiDesignedVoiceId({
      workflowKey: 'baseaudio/voice/s2-se',
      preferredName: 'doctor_voice',
      fishText: '[calm] Please follow me.',
    })

    expect(isComfyUiDesignedVoiceId(voiceId)).toBe(true)
    expect(voiceId).toMatch(/^comfyui:[a-f0-9]{24}$/)
  })

  it('injects male voice tags into the render text when the user asks for a male voice', () => {
    const renderText = buildFishAudioS2RenderText({
      fishText: '[沉稳]那年夏天，我同桌偷偷拿走我一块橡皮擦。',
      voicePrompt: '成熟稳重的青年男性，冷静克制，有磁性。',
      userVoicePrompt: '成熟稳重的青年男性，注意是男声，声音冷静和感染力',
    })

    expect(renderText).toContain('[青年男声]')
    expect(renderText).toContain('[沉稳]')
    expect(renderText).toContain('[冷静]')
    expect(renderText.startsWith('[青年男声]')).toBe(true)
    expect(renderText).not.toContain('[男声][')
  })

  it('does not duplicate style tags that are already present in fish text', () => {
    const renderText = buildFishAudioS2RenderText({
      fishText: '[青年男声][沉稳]那年夏天，我同桌偷偷拿走我一块橡皮擦。',
      voicePrompt: '成熟稳重的青年男性，冷静克制',
      userVoicePrompt: '成熟稳重的青年男性，注意是男声，声音冷静和感染力',
    })

    expect(renderText.match(/\[青年男声\]/gu)).toHaveLength(1)
    expect(renderText.match(/\[沉稳\]/gu)).toHaveLength(1)
    expect(renderText).toContain('[冷静]')
  })

  it('renders the fish audio s2 line prompt template with the new variables', () => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.FISH_AUDIO_S2_LINE_RENDER,
      locale: 'zh',
      variables: {
        speaker_name: '陈迹',
        character_context: '角色名: 陈迹',
        line_text: '你回答后，我会根据我的判断进行评分，可以吗？',
        emotion_prompt: '冷静克制地试探',
        emotion_strength: '0.20',
        dialogue_context: '#1 医生: 请坐。',
        scene_context: '分镜1：诊室内，医生正在观察对方。',
      },
    })

    expect(prompt).toContain('陈迹')
    expect(prompt).toContain('冷静克制地试探')
    expect(prompt).toContain('Fish Audio S2')
  })
})
