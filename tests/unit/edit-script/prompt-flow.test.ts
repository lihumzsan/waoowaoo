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
    directing: {
      pointOfViewPrompt: 'restricted protagonist viewpoint',
      performancePrompt: 'restrained performance through small gestures',
      informationReleasePrompt: 'reveal information through reaction before event truth',
      rhythmPrompt: 'hold suspense pauses before faster turns',
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
    expect(styleBiblePrompt).toContain('Style Bible 是后续导演拆镜、资产图、摄影方案、分镜图、视频提示词、声音提示词的唯一风格来源')
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
        director_decoupage_json: JSON.stringify({ shots: [] }),
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(primaryPrompt).toContain('剪辑结构整理器')
    expect(primaryPrompt).toContain('Style Bible 是唯一风格来源')
    expect(primaryPrompt).toContain('Director Decoupage 是 shot 创作事实')
    expect(primaryPrompt).toContain('videoBlocks 是技术生成主结构')
    expect(primaryPrompt).toContain('本阶段只做结构整理、时长合法化和 videoBlock 分组')
    expect(primaryPrompt).toContain('禁止输出 camera、shotScale、lens、cameraPosition、depthOfField、imagePrompt、videoPrompt')
    expect(primaryPrompt).toContain('15 秒是 group 的最高优先级硬上限')
    expect(primaryPrompt).toContain('group 是默认优先结构')
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

    const panelFinalPromptBlock = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK,
      locale: 'zh',
      variables: {
        director_decoupage_json: JSON.stringify({ shots: [] }),
        cinematography_shot_plan_json: JSON.stringify({ shots: [] }),
        full_edit_script_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        source_snapshot_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        spatial_profile_strategy_output_json: JSON.stringify({ strategy: 'spatial_text_blocking', locations: [] }),
        video_block_json: JSON.stringify({ sourceVideoBlockId: 'block-1' }),
        block_shots_json: JSON.stringify([{ shotNumber: 1 }]),
        adjacent_blocks_json: JSON.stringify({ previous: null, next: null }),
        previous_block_json: JSON.stringify(null),
        next_block_json: JSON.stringify(null),
        panel_contract_json: JSON.stringify([{ panelIndex: 0, sourceShotNumber: 1 }]),
      },
    })

    expect(panelFinalPromptBlock).toContain('edit-first 分镜执行 Agent')
    expect(panelFinalPromptBlock).toContain('Director Decoupage 决定 shot 的戏剧目的')
    expect(panelFinalPromptBlock).toContain('Cinematography Shot Plan 决定 shot 的景别、焦段、景深、机位')
    expect(panelFinalPromptBlock).toContain('不能重新发明镜头')
    expect(panelFinalPromptBlock).toContain('finalPanelPrompt 必须是可直接交给图片模型的单张电影分镜图提示词')
    expect(panelFinalPromptBlock).toContain('finalVideoPrompt 必须是可直接交给视频模型的当前 shot 视频提示词')
    expect(panelFinalPromptBlock).toContain('panelFinalPromptBlockOutput')
    expect(panelFinalPromptBlock).not.toContain('panelVisualPlanBlockOutput')
    expect(panelFinalPromptBlock).not.toContain('cameraPlanBlockOutput')

    const englishPrimaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      locale: 'en',
      variables: {
        user_request: 'Create a continuous short film',
        screenplay_text: screenplayText,
        director_decoupage_json: JSON.stringify({ shots: [] }),
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(englishPrimaryPrompt).toContain('Style Bible is the only style source')
    expect(englishPrimaryPrompt).toContain('The 15-second group limit is the highest-priority hard ceiling')
    expect(englishPrimaryPrompt).toContain('Director Decoupage is the shot creation truth')
  })
})
