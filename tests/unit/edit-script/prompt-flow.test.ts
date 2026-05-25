import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

const styleBibleJson = JSON.stringify({
  strategy: 'style_bible',
  rawUserStyle: '禅修短片',
  styleSummary: '安静克制的东方自然主义禅修影像。',
  stylePolicy: {
    visual: {
      negativePrompt: '不要商业广告感，不要高反差大片感，不要炫技运镜。',
      imageFilterPrompt: '柔和自然光，低对比度，轻微柔焦，清澈空气感，淡雅胶片质感',
      lightingPrompt: '晨间漫射自然光，低光比。',
      colorPrompt: '低饱和自然灰绿、木色、石灰色。',
      texturePrompt: '细腻胶片颗粒，真实木材、布料、石面质感。',
      compositionPrompt: '留白多，稳定构图。',
    },
    camera: {
      movementPrompt: '固定镜头、缓慢推近、轻微横移。',
      lensAndDepthPrompt: '35mm，自然景深。',
      videoRhythmPrompt: '慢节奏，长停顿，少切换，剪辑克制。',
    },
    sound: {
      soundFilterPrompt: '柔和低动态，自然空气感，清晰但不过度锐利',
    },
    hardBans: ['不要字幕', '不要水印', '不要logo'],
  },
})

describe('edit script block-first prompt flow', () => {
  it('builds a style-bible-first prompt chain with one style source', () => {
    const screenplayText = [
      '标题：《灯下的人》',
      '',
      '故事梗概：人物进入房间，顺着光线发现桌上的旧物。',
      '',
      '场景 1｜内景. 房间 - 夜晚',
      '',
      '动作：人物走入昏暗房间，沿着窗边的光线慢慢前行，在桌前停下。',
    ].join('\n')

    const styleBiblePrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE,
      locale: 'zh',
      variables: {
        user_request: '生成一条禅修短片',
        duration_seconds: '8',
        aspect_ratio: '9:16',
        project_style_json: JSON.stringify({ artStyle: 'realistic', aspectRatio: '9:16' }),
      },
    })

    expect(styleBiblePrompt).toContain('唯一风格圣经生成器')
    expect(styleBiblePrompt).toContain('任何剧本、资产、分镜或视频提示词生成之前')
    expect(styleBiblePrompt).toContain('Style Bible 是后续资产图、分镜图、视频提示词、声音提示词的唯一风格来源')
    expect(styleBiblePrompt).toContain('不要输出大而全的正向风格字段')
    expect(styleBiblePrompt).toContain('imageFilterPrompt 必须是一句可直接塞进图片或视频提示词的画面滤镜短语')
    expect(styleBiblePrompt).toContain('sound.soundFilterPrompt')
    expect(styleBiblePrompt).toContain('hardBans')
    expect(styleBiblePrompt).toContain('禅意东方作者电影')
    expect(styleBiblePrompt).toContain('柔和自然光，低对比度，轻微柔焦')
    expect(styleBiblePrompt).toContain('不要商业广告感，不要高反差大片感')
    expect(styleBiblePrompt).not.toContain('春夏秋冬又一春')
    expect(styleBiblePrompt).not.toContain('金基德')

    const screenplayPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(screenplayPrompt).toContain('AI 可控短片剧本')
    expect(screenplayPrompt).toContain('Style Bible（唯一风格来源）')
    expect(screenplayPrompt).toContain('这里只写剧情内容')
    expect(screenplayPrompt).toContain('不要出现“镜头”“特写”“推镜”“剪切”“CUT TO”')
    expect(screenplayPrompt).toContain('柔和自然光，低对比度，轻微柔焦')

    const primaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        screenplay_text: screenplayText,
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(primaryPrompt).toContain('统一剪辑结构表 Agent')
    expect(primaryPrompt).toContain('Style Bible 是唯一风格来源')
    expect(primaryPrompt).toContain('不要从项目 artStyle 或其他风格上下文另起一套风格')
    expect(primaryPrompt).toContain('videoBlocks 是视频生成主结构')
    expect(primaryPrompt).toContain('本阶段只生成结构、动作、摄影、声音和片段编排')
    expect(primaryPrompt).toContain('shots[].videoPrompt 和 videoBlocks[].prompt 会在资产提取与资产描述完成后由下一阶段生成')
    expect(primaryPrompt).toContain('15 秒是最高优先级硬上限')
    expect(primaryPrompt).toContain('禁止为了“稳定”而默认每 2 个 shot 切一个 group')
    expect(primaryPrompt).not.toContain('timeline_json')
    expect(primaryPrompt).not.toContain('visual_action_json')
    expect(primaryPrompt).not.toContain('2x2')
    expect(primaryPrompt).not.toContain('宫格')

    const assetExtractPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT,
      locale: 'zh',
      variables: {
        edit_script_json: JSON.stringify({ shots: [], videoBlocks: [] }),
      },
    })

    expect(assetExtractPrompt).toContain('角色资产必须同时生成非空 voiceTimbreText')
    expect(assetExtractPrompt).toContain('即使角色在当前剪辑表中没有对白、旁白或画外音，也必须')
    expect(assetExtractPrompt).toContain('character 必须输出非空 voiceTimbreText；location 禁止输出 voiceTimbreText')
    expect(assetExtractPrompt).toContain('禁止因为当前角色无台词而省略、置空、写 null')

    const videoPromptBlock = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片，要安静克制',
        screenplay_text: screenplayText,
        video_block_json: JSON.stringify({ sourceVideoBlockIndex: 0, shotNumbers: [1] }),
        block_shots_json: JSON.stringify([{ shotNumber: 1 }]),
        asset_context_json: JSON.stringify({ assets: [] }),
        adjacent_blocks_json: JSON.stringify({ previous: null, next: null }),
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(videoPromptBlock).toContain('严格遵守 Style Bible')
    expect(videoPromptBlock).toContain('user_request 或 styleBible.rawUserStyle')
    expect(videoPromptBlock).toContain('styleBible.stylePolicy.visual.negativePrompt')
    expect(videoPromptBlock).toContain('styleBible.stylePolicy.visual.imageFilterPrompt')
    expect(videoPromptBlock).toContain('styleBible.stylePolicy.sound.soundFilterPrompt')
    expect(videoPromptBlock).toContain('画面滤镜')
    expect(videoPromptBlock).toContain('声音滤镜')
    expect(videoPromptBlock).toContain('不得改写或替代角色 voiceTimbreText')
    expect(videoPromptBlock).not.toContain('videoPromptBible')

    const englishPrimaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      locale: 'en',
      variables: {
        user_request: 'Create a continuous short film',
        screenplay_text: screenplayText,
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(englishPrimaryPrompt).toContain('Style Bible is the only style source')
    expect(englishPrimaryPrompt).toContain('15-second limit is the highest-priority hard ceiling')
    expect(englishPrimaryPrompt).toContain('Do not mechanically split them into multiple 2-shot groups')
  })
})
