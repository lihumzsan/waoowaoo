import { describe, expect, it } from 'vitest'
import {
  buildComfyUiDesignedVoiceId,
  buildVoiceDesignCharacterContextSummary,
  isComfyUiDesignedVoiceId,
} from '@/lib/voice-design/fish-audio-s2'

describe('fish audio s2 voice design helpers', () => {
  it('builds a readable character context summary from profile and appearance data', () => {
    const summary = buildVoiceDesignCharacterContextSummary({
      name: '中年医生',
      aliases: '陈医生, 老陈',
      introduction: '资深主治医师，说话克制可靠。',
      profileData: JSON.stringify({
        role_level: 'B',
        archetype: '专业医生',
        personality_tags: ['严谨', '冷静'],
        era_period: '现代都市',
        social_class: '中产',
        occupation: '医生',
        costume_tier: 3,
        suggested_colors: ['白'],
        visual_keywords: ['鼻梁眼镜'],
        gender: '男',
        age_range: '中年',
      }),
      appearances: [
        {
          label: '默认',
          description: '白大褂，戴眼镜，说话克制。',
        },
      ],
    })

    expect(summary).toContain('角色名: 中年医生')
    expect(summary).toContain('职业: 医生')
    expect(summary).toContain('性格标签: 严谨 / 冷静')
    expect(summary).toContain('默认: 白大褂，戴眼镜，说话克制。')
  })

  it('creates a stable comfyui-designed voice id prefix', () => {
    const voiceId = buildComfyUiDesignedVoiceId({
      workflowKey: 'baseaudio/音色/s2-se',
      preferredName: 'doctor_voice',
      fishText: '[冷静]请跟我来。',
    })

    expect(isComfyUiDesignedVoiceId(voiceId)).toBe(true)
    expect(voiceId).toMatch(/^comfyui:[a-f0-9]{24}$/)
  })
})
