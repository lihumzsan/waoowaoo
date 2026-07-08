import { describe, expect, it } from 'vitest'
import { buildBgmScorePlanPrompt, buildFinalBgmMusicPrompt } from '@/lib/bgm-score/prompt'

describe('bgm score prompt builder', () => {
  it('builds a plan prompt with timeline context and dynamic single-track guidance', () => {
    const prompt = buildBgmScorePlanPrompt({
      editScript: {
        id: 'edit-1',
        userPrompt: 'A suspense scene.',
        durationSec: 12,
        shots: [{
          shotId: 'shot-1',
          shotNumber: 1,
          shotPurpose: 'action',
          durationSec: 12,
          scene: { locationId: 'location-1', name: 'Dark room', subScene: 'Dark room' },
          action: 'The detective enters the room.',
          characters: [
            {
              characterId: 'character-1',
              name: 'Detective',
              visibility: 'visible',
              role: 'focus',
              performance: 'enters cautiously',
            },
          ],
          keyObjects: [],
          dialogue: [],
          sound: 'room tone and footsteps only, no BGM',
        }],
        generationSegments: [{
          shotIds: ['shot-1'],
          continuity: 'Single suspense shot.',
        }],
      },
      projectContext: { videoRatio: '16:9' },
      totalDurationSeconds: 12,
      clips: [{
        panelId: 'panel-1',
        groupId: null,
        sourceKind: 'panel',
        source: '/m/video.mp4',
        durationSeconds: 12,
        order: 1,
        shotNumber: 1,
        shotNumbers: [1],
        shotId: 'shot-1',
        shotIds: ['shot-1'],
        description: 'The detective enters the room.',
        sound: 'room tone and footsteps only, no BGM',
      }],
      locale: 'en',
    })

    expect(prompt).toContain('one single complete instrumental BGM track')
    expect(prompt).toContain('These concepts are guidance, not a fixed template')
    expect(prompt).toContain('scoreDesign.sections must be dynamic')
    expect(prompt).toContain('virtualLayers are text-only')
    expect(prompt).toContain('finalPrompt must be a self-contained prompt')
    expect(prompt).toContain('Final rendered media timeline JSON')
    expect(prompt).toContain('The detective enters the room')
    expect(prompt).not.toContain('Allowed stem roles')
    expect(prompt).not.toContain('isolated stem only')
  })

  it('builds Chinese plan and provider prompts for canvas-visible music prompt fields', () => {
    const prompt = buildBgmScorePlanPrompt({
      editScript: null,
      projectContext: { videoRatio: '16:9' },
      totalDurationSeconds: 12,
      clips: [],
      locale: 'zh',
    })

    expect(prompt).toContain('所有会显示在画布上的字段值必须使用中文自然语言')
    expect(prompt).toContain('finalPrompt')
    expect(prompt).not.toContain('negativePrompt')
    expect(prompt).toContain('生成一条 57 秒完整连续的纯器乐电影背景配乐')
    expect(prompt).not.toContain('Generate one complete continuous instrumental cinematic BGM track')

    const providerPrompt = buildFinalBgmMusicPrompt({
      durationSeconds: 12,
      creativeBrief: {
        cueType: '连续纯器乐背景配乐',
        genre: '科幻剧情',
        mood: '敬畏与不安',
        narrativeFunction: '连接剪辑并给原生视频声音留空间',
      },
      scoreDesign: {
        overview: '单条配乐从冷峻压迫转向温暖揭示。',
        sections: [{
          category: '击点',
          title: '星球揭示',
          purpose: '托住敬畏感但不写字面冲击音效。',
          startSec: 8,
          endSec: 12,
          content: '揭示处打开和声并抬高音区。',
        }],
      },
      virtualLayers: [{
        name: '宽阔和声铺底',
        purpose: '提供单条最终配乐内部的主要色彩。',
        content: '从阴暗缓慢打开到温暖。',
      }],
      promptSections: [{
        title: '揭示段落',
        purpose: '提示词积木。',
        startSec: 8,
        endSec: 12,
        content: '在揭示处逐渐打开和声。',
      }],
      finalPrompt: '生成一条 12 秒完整连续的纯器乐电影背景配乐，科幻剧情，从冷峻压迫转向温暖揭示，编曲克制，给原生视频声音留空间。',
    }, { locale: 'zh' })

    expect(providerPrompt).toContain('生成单条最终配乐时必须遵守的作曲设计说明')
    expect(providerPrompt).toContain('宽阔和声铺底')
    expect(providerPrompt).not.toContain('负向提示词')
    expect(providerPrompt).not.toContain('negativePrompt')
    expect(providerPrompt).not.toContain('Composer design notes')
  })

  it('condenses the score plan into one final provider prompt with design notes', () => {
    const providerPrompt = buildFinalBgmMusicPrompt({
      durationSeconds: 12,
      creativeBrief: {
        cueType: 'continuous instrumental underscore',
        genre: 'sci-fi drama',
        mood: 'awe and dread',
        narrativeFunction: 'connect the edit while leaving space for native video sound',
      },
      scoreDesign: {
        overview: 'A single cue with cold opening pressure and a warm reveal.',
        sections: [{
          category: 'Hit Point',
          title: 'planet reveal',
          purpose: 'Support awe without literal impact sound.',
          startSec: 8,
          endSec: 12,
          content: 'Open harmony and brighter register at the reveal.',
        }],
      },
      virtualLayers: [{
        name: 'wide harmonic pad',
        purpose: 'Internal color inside the single final cue.',
        content: 'Slowly opens from dark to warm.',
      }],
      promptSections: [{
        title: 'Reveal cue',
        purpose: 'Prompt building block.',
        startSec: 8,
        endSec: 12,
        content: 'Gradual harmonic opening at the reveal.',
      }],
      finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 12 seconds, sci-fi drama, cold pressure into warm reveal, restrained orchestration, leave space for native video sound.',
    })

    expect(providerPrompt).toContain('Generate one complete continuous instrumental cinematic BGM track')
    expect(providerPrompt).toContain('Composer design notes')
    expect(providerPrompt).toContain('wide harmonic pad')
    expect(providerPrompt).toContain('Render exactly one coherent instrumental BGM track')
    expect(providerPrompt).not.toContain('Negative prompt:')
    expect(providerPrompt).not.toContain('negativePrompt')
  })
})
