import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

const styleBibleJson = JSON.stringify({
  rawUserStyle: '禅修短片',
  styleSummary: '安静克制的东方自然主义禅修影像。',
  stylePolicy: {
    visual: {
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
  },
})
const durationGuidance = '中时长档位，约 60 秒。允许完整起承转合，最终总时长可按叙事自然落在约 45-75 秒，不要机械凑满固定秒数。'
const englishDurationGuidance = 'Medium duration tier, around 60 seconds. Allow a complete beginning, turn, and ending; the final total duration may naturally land around 45-75 seconds instead of mechanically matching an exact second count.'

describe('edit script block-first prompt flow', () => {
  it('builds a screenplay-first prompt chain with style preview candidates before the single confirmed style source', () => {
    const screenplayText = [
      '标题：《灯下的人》',
      '',
      '故事梗概：人物进入房间，顺着光线发现桌上的旧物。',
      '',
      '场景 1｜内景. 房间 - 夜晚',
      '',
      '动作：人物走入昏暗房间，沿着窗边的光线慢慢前行，在桌前停下。',
    ].join('\n')

    const screenplayPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        duration_guidance: durationGuidance,
        aspect_ratio: '16:9',
      },
    })

    expect(screenplayPrompt).toContain('短片编剧 AI')
    expect(screenplayPrompt).toContain('剧情容量是否适配所选时长档位且不超过 120 秒')
    expect(screenplayPrompt).toContain('角色必须是虚构角色')
    expect(screenplayPrompt).toContain('最终画面比例：')
    expect(screenplayPrompt).toContain('16:9')
    expect(screenplayPrompt).not.toContain('aspect_ratio')
    expect(screenplayPrompt).toContain('不要机械凑满固定秒数')
    expect(screenplayPrompt).toContain('只写剧情事实和可见、可表演的动作，不写镜头语言')
    expect(screenplayPrompt).toContain('用户需求中的风格、画风、美术媒介或视觉效果要求不写入剧本文本')
    expect(screenplayPrompt).toContain('角色名：2-3 个客观、剧情识别所需的稳定外观/状态特征')
    expect(screenplayPrompt).toContain('动作段落是否只写剧情事实、空间事实和可见动作')
    expect(screenplayPrompt).toContain('是否没有写入镜头、特写、推镜、剪切、CUT TO')
    expect(screenplayPrompt).not.toContain('项目风格输入')
    expect(screenplayPrompt).not.toContain('style_context_json')
    expect(screenplayPrompt).not.toContain('Style Bible（唯一风格来源）')
    expect(screenplayPrompt).not.toContain('柔和自然光，低对比度，轻微柔焦')

    const revisionPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
      locale: 'zh',
      variables: {
        original_user_request: '生成一条黏土动画风格短片',
        current_screenplay_text: screenplayText,
        revision_instruction: '改成更黑暗的黏土动画风格',
        duration_guidance: durationGuidance,
        aspect_ratio: '9:16',
      },
    })

    expect(revisionPrompt).toContain('用户修改要求中的视觉风格、画风、美术媒介或视觉效果变化不写入剧本文本')
    expect(revisionPrompt).toContain('只吸收其中非视觉的剧情、情绪或主题意图')
    expect(revisionPrompt).toContain('只写剧情事实和可见、可表演的动作，不写镜头语言')
    expect(revisionPrompt).toContain('动作段落是否只写剧情事实、空间事实和可见动作')
    expect(revisionPrompt).not.toContain('如果用户要求风格、主题、氛围或剧情方向变化')

    const styleBiblePrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE,
      locale: 'zh',
      variables: {
        user_request: '生成一条风格化 3D 短片',
        duration_guidance: durationGuidance,
        aspect_ratio: '16:9',
        style_context_json: JSON.stringify({ style: '风格化 3D' }),
      },
    })

    expect(styleBiblePrompt).toContain('Style Bible 不得使用或暗示真人类型')
    expect(styleBiblePrompt).toContain('真人 3D、写实真人 3D、数字人、CG 真人、CGI 真人')
    expect(styleBiblePrompt).toContain('3D/CG 可以作为动漫 3D、风格化 3D、非真人角色/物体/生物主导 CG')
    expect(styleBiblePrompt).not.toContain('visual.negativePrompt')
    expect(styleBiblePrompt).not.toContain('"negativePrompt"')
    expect(styleBiblePrompt).not.toContain('视觉负向约束')
    expect(styleBiblePrompt).not.toContain('hardBans')
    expect(styleBiblePrompt).not.toContain('必须改写成非真人且非 3D')

    const stylePreviewPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS,
      locale: 'zh',
      variables: {
        user_request: '生成一条禅修短片',
        screenplay_text: screenplayText,
        duration_guidance: durationGuidance,
        style_direction: '更黑暗一些',
        style_preview_count: '2',
      },
    })

    expect(stylePreviewPrompt).toContain('设计 1-3 套可供选择的影片风格方案')
    expect(stylePreviewPrompt).toContain('候选数量必须严格等于 2')
    expect(stylePreviewPrompt).toContain('风格调整方向：')
    expect(stylePreviewPrompt).toContain('更黑暗一些')
    expect(stylePreviewPrompt).toContain('所有方案都必须忠于同一份剧本事实')
    expect(stylePreviewPrompt).toContain('美术媒介、画面质感、光影色彩、构图镜头和声音气质')
    expect(stylePreviewPrompt).toContain('至少两个候选必须采用明显不同的非真人美术媒介/画风')
    expect(stylePreviewPrompt).toContain('而不是只改变调色、明暗、颗粒或镜头滤镜')
    expect(stylePreviewPrompt).toContain('候选风格不得是真人类型、实拍真人、真人演员、写实真人')
    expect(stylePreviewPrompt).toContain('真人 3D、写实真人 3D、数字人、CG 真人、CGI 真人')
    expect(stylePreviewPrompt).toContain('3D/CG 可以作为非真人美术媒介')
    expect(stylePreviewPrompt).toContain('动漫 3D、风格化 3D/CG')
    expect(stylePreviewPrompt).not.toContain('visual.negativePrompt')
    expect(stylePreviewPrompt).not.toContain('"negativePrompt"')
    expect(stylePreviewPrompt).not.toContain('hardBans')
    expect(stylePreviewPrompt).toContain('每个候选必须包含完整 styleBible')
    expect(stylePreviewPrompt).toContain('gridImagePrompt 只负责预览图本身')
    expect(stylePreviewPrompt).toContain('九宫格 contact sheet')
    expect(stylePreviewPrompt).toContain('它必须使用同一候选的 styleBible 作为唯一风格来源')
    expect(stylePreviewPrompt).toContain('不得新增、替换、扩展、弱化或硬化 styleBible 里的风格规则')
    expect(stylePreviewPrompt).toContain('不得另写一套风格负面约束')
    expect(stylePreviewPrompt).not.toContain('aspectRatio')
    expect(stylePreviewPrompt).toContain('style_a')
    expect(stylePreviewPrompt).toContain('style_b')
    expect(stylePreviewPrompt).toContain('style_c')
    expect(stylePreviewPrompt).toContain('"gridImagePrompt"')
    expect(stylePreviewPrompt).not.toContain('每格按该候选 aspectRatio')
    expect(stylePreviewPrompt).not.toContain('项目风格输入')
    expect(stylePreviewPrompt).not.toContain('style_context_json')
    expect(stylePreviewPrompt).not.toContain('春夏秋冬又一春')
    expect(stylePreviewPrompt).not.toContain('金基德')
    expect(stylePreviewPrompt).not.toContain('即便是“风格化 3D”也不允许')
    expect(stylePreviewPrompt).not.toContain('非真人且非 3D')

    const primaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        screenplay_text: screenplayText,
        director_decoupage_json: JSON.stringify({ shots: [] }),
        duration_guidance: durationGuidance,
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(primaryPrompt).toContain('短片剪辑结构规划 AI')
    expect(primaryPrompt).toContain('Style Bible 是风格事实')
    expect(primaryPrompt).toContain('Director Decoupage 是 shot 创作事实')
    expect(primaryPrompt).toContain('剪辑结构总时长不得超过 120 秒')
    expect(primaryPrompt).toContain('不得引入真人类型、实拍真人、真人演员、写实真人')
    expect(primaryPrompt).toContain('顶层 durationSec 必须符合所选时长档位范围')
    expect(primaryPrompt).toContain('videoBlock：视频模型的一次生成单元')
    expect(primaryPrompt).toContain('你不重新创作镜头，也不改变镜头含义')
    expect(primaryPrompt).toContain('本任务不输出 camera、shotScale、lens、cameraPosition、depthOfField、imagePrompt、videoPrompt')
    expect(primaryPrompt).toContain('15 秒是 group 的硬上限')
    expect(primaryPrompt).toContain('group 是默认优先结构')
    expect(primaryPrompt).not.toContain('timeline_json')
    expect(primaryPrompt).not.toContain('visual_action_json')
    expect(primaryPrompt).not.toContain('2x2')
    expect(primaryPrompt).not.toContain('宫格')

    const assetExtractPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT,
      locale: 'zh',
      variables: {
        structure_json: JSON.stringify({ shots: [], videoBlocks: [] }),
      },
    })

    expect(assetExtractPrompt).toContain('"kind": "character"')
    expect(assetExtractPrompt).toContain('"description": "需要生成该人物资产的识别依据"')
    expect(assetExtractPrompt).toContain('description 是否是资产识别依据，而不是最终图片生成提示词')
    expect(assetExtractPrompt).toContain('只提取 character 和 location，不提取道具、音频、分镜图或视频')

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

    expect(videoPromptBlock).toContain('Style Bible 是唯一风格来源')
    expect(videoPromptBlock).toContain('user_request 或 styleBible.rawUserStyle')
    expect(videoPromptBlock).not.toContain('styleBible.stylePolicy.visual.negativePrompt')
    expect(videoPromptBlock).toContain('styleBible.stylePolicy.visual.imageFilterPrompt')
    expect(videoPromptBlock).toContain('styleBible.stylePolicy.sound.soundFilterPrompt')
    expect(videoPromptBlock).toContain('画面滤镜')
    expect(videoPromptBlock).toContain('声音滤镜')
    expect(videoPromptBlock).not.toContain('videoPromptBible')

    const panelFinalPromptBlock = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK,
      locale: 'zh',
      variables: {
        director_decoupage_json: JSON.stringify({ shots: [] }),
        cinematography_shot_plan_json: JSON.stringify({ shots: [] }),
        full_structure_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        source_snapshot_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        spatial_profile_output_json: JSON.stringify({ locations: [] }),
        video_block_json: JSON.stringify({ sourceVideoBlockId: 'block-1' }),
        block_shots_json: JSON.stringify([{ shotNumber: 1 }]),
        previous_block_json: JSON.stringify(null),
        next_block_json: JSON.stringify(null),
        panel_contract_json: JSON.stringify([{ panelIndex: 0, sourceShotNumber: 1 }]),
      },
    })

    expect(panelFinalPromptBlock).toContain('分镜画面执行 AI')
    expect(panelFinalPromptBlock).toContain('Director Decoupage 决定 shot 的戏剧目的')
    expect(panelFinalPromptBlock).toContain('Cinematography Shot Plan 决定 shot 的景别、焦段、景深、机位')
    expect(panelFinalPromptBlock).toContain('不重新发明镜头')
    expect(panelFinalPromptBlock).toContain('每个 panel 必须输出 shotBlocking')
    expect(panelFinalPromptBlock).toContain('shotBlocking 只包含 JSON 示例中的字段')
    expect(panelFinalPromptBlock).toContain('禁止在 shotBlocking 中输出 lighting、lens、shotScale')
    expect(panelFinalPromptBlock).toContain('转写进 finalPanelPrompt / finalVideoPrompt')
    expect(panelFinalPromptBlock).toContain('"absolutePosition"')
    expect(panelFinalPromptBlock).toContain('"relativePosition"')
    expect(panelFinalPromptBlock).toContain('"screenPosition"')
    expect(panelFinalPromptBlock).toContain('"characterPlacements"')
    expect(panelFinalPromptBlock).toContain('finalPanelPrompt 是可直接交给图片模型的单张电影分镜图提示词')
    expect(panelFinalPromptBlock).toContain('finalVideoPrompt 是可直接交给视频模型的目标 shot 视频提示词')
    expect(panelFinalPromptBlock).toContain('panelFinalPromptBlockOutput')
    expect(panelFinalPromptBlock).not.toContain('panelVisualPlanBlockOutput')
    expect(panelFinalPromptBlock).not.toContain('cameraPlanBlockOutput')

    const englishPanelFinalPromptBlock = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK,
      locale: 'en',
      variables: {
        director_decoupage_json: JSON.stringify({ shots: [] }),
        cinematography_shot_plan_json: JSON.stringify({ shots: [] }),
        full_structure_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        source_snapshot_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        spatial_profile_output_json: JSON.stringify({ locations: [] }),
        video_block_json: JSON.stringify({ sourceVideoBlockId: 'block-1' }),
        block_shots_json: JSON.stringify([{ shotNumber: 1 }]),
        previous_block_json: JSON.stringify(null),
        next_block_json: JSON.stringify(null),
        panel_contract_json: JSON.stringify([{ panelIndex: 0, sourceShotNumber: 1 }]),
      },
    })

    expect(englishPanelFinalPromptBlock).toContain('shotBlocking may contain only the fields shown in the JSON example')
    expect(englishPanelFinalPromptBlock).toContain('Do not output lighting, lens, shotScale')
    expect(englishPanelFinalPromptBlock).toContain('must be rewritten into finalPanelPrompt / finalVideoPrompt')

    const englishPrimaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
      locale: 'en',
      variables: {
        user_request: 'Create a continuous short film',
        screenplay_text: screenplayText,
        director_decoupage_json: JSON.stringify({ shots: [] }),
        duration_guidance: englishDurationGuidance,
        aspect_ratio: '9:16',
        style_bible_json: styleBibleJson,
      },
    })

    expect(englishPrimaryPrompt).toContain('The Style Bible is style truth')
    expect(englishPrimaryPrompt).toContain('Cut structure total duration must not exceed 120 seconds')
    expect(englishPrimaryPrompt).toContain('must not introduce real-person, live-action real human, human actor')
    expect(englishPrimaryPrompt).toContain('The 15-second group limit is a hard ceiling')
    expect(englishPrimaryPrompt).toContain('Director Decoupage is the shot creation truth')

    const englishStyleBiblePrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE,
      locale: 'en',
      variables: {
        user_request: 'Create a stylized 3D short film',
        duration_guidance: englishDurationGuidance,
        aspect_ratio: '16:9',
        style_context_json: JSON.stringify({ style: 'stylized 3D' }),
      },
    })

    expect(englishStyleBiblePrompt).toContain('Style Bible must not use or imply real-person')
    expect(englishStyleBiblePrompt).toContain('real-person 3D, photorealistic 3D humans, digital humans')
    expect(englishStyleBiblePrompt).toContain('3D/CG is allowed as anime 3D, stylized 3D')
    expect(englishStyleBiblePrompt).not.toContain('visual.negativePrompt')
    expect(englishStyleBiblePrompt).not.toContain('"negativePrompt"')
    expect(englishStyleBiblePrompt).not.toContain('visual negative constraints')
    expect(englishStyleBiblePrompt).not.toContain('hardBans')
    expect(englishStyleBiblePrompt).not.toContain('rewrite it into a non-real-person and non-3D')

    const englishStylePreviewPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS,
      locale: 'en',
      variables: {
        user_request: 'Create a stylized 3D short film',
        screenplay_text: screenplayText,
        duration_guidance: englishDurationGuidance,
        style_direction: 'more graphic',
        style_preview_count: '2',
      },
    })

    expect(englishStylePreviewPrompt).toContain('non-real-person art medium')
    expect(englishStylePreviewPrompt).toContain('real-person 3D, photorealistic 3D humans, digital humans')
    expect(englishStylePreviewPrompt).toContain('3D/CG may be used as a non-real-person art medium')
    expect(englishStylePreviewPrompt).toContain('anime 3D, stylized 3D/CG')
    expect(englishStylePreviewPrompt).not.toContain('visual.negativePrompt')
    expect(englishStylePreviewPrompt).not.toContain('"negativePrompt"')
    expect(englishStylePreviewPrompt).toContain('Every candidate must include a complete styleBible')
    expect(englishStylePreviewPrompt).toContain("use the same candidate's styleBible as the only style source")
    expect(englishStylePreviewPrompt).toContain('must not write a separate set of negative style constraints')
    expect(englishStylePreviewPrompt).toContain('"gridImagePrompt"')
    expect(englishStylePreviewPrompt).not.toContain('hardBans')
    expect(englishStylePreviewPrompt).not.toContain('Stylized 3D is also prohibited')
    expect(englishStylePreviewPrompt).not.toContain('non-3D')
  })
})
