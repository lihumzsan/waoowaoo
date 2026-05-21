import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

describe('edit script block-first prompt flow', () => {
  it('builds a unified primary prompt without intermediate specialist inputs', () => {
    const screenplayText = [
      '标题：《灯下的人》',
      '',
      '故事梗概：人物进入房间，顺着光线发现桌上的旧物。',
      '',
      '内景 房间 - 夜晚',
      '',
      '动作：人物走入昏暗房间，沿着窗边的光线慢慢前行，在桌前停下。',
    ].join('\n')

    const screenplayPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_context: 'cinematic',
      },
    })

    expect(screenplayPrompt).toContain('AI 可控短片剧本')
    expect(screenplayPrompt).toContain('这里只写剧情内容')
    expect(screenplayPrompt).toContain('不输出 JSON')
    expect(screenplayPrompt).toContain('角色表')
    expect(screenplayPrompt).toContain('场景 1｜内景/外景. 地点 - 时间')
    expect(screenplayPrompt).toContain('角色名（可选表演提示）')
    expect(screenplayPrompt).toContain('旁白（V.O.）')
    expect(screenplayPrompt).toContain('角色名（O.S.）')
    expect(screenplayPrompt).toContain('场景 N｜内景/外景. 地点 - 时间')
    expect(screenplayPrompt).toContain('不要把它写成字幕或屏幕文字')
    expect(screenplayPrompt).toContain('不要出现“镜头”“特写”“推镜”“剪切”“CUT TO”')

    const primaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        screenplay_text: screenplayText,
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_context: 'cinematic',
      },
    })

    expect(primaryPrompt).toContain('统一剪辑结构表 Agent')
    expect(primaryPrompt).toContain('从编剧剧本直接生成唯一核心剪辑结构表')
    expect(primaryPrompt).toContain('videoBlocks 是视频生成主结构')
    expect(primaryPrompt).toContain('编剧剧本是唯一剧情事实')
    expect(primaryPrompt).toContain(screenplayText)
    expect(primaryPrompt).toContain('本阶段只生成结构、动作、摄影、声音和片段编排')
    expect(primaryPrompt).toContain('shots[].videoPrompt 和 videoBlocks[].prompt 会在资产提取与资产描述完成后由下一阶段生成')
    expect(primaryPrompt).toContain('15 秒是最高优先级硬上限')
    expect(primaryPrompt).toContain('如果加入下一个 shot 会让当前 group 超过 15 秒')
    expect(primaryPrompt).toContain('不能输出一个 20 秒 group')
    expect(primaryPrompt).toContain('不能输出一个 25 秒 group')
    expect(primaryPrompt).toContain('single 必须且只能包含 1 个 shot，且这个唯一 shot 的 durationSec 必须至少为 4 秒')
    expect(primaryPrompt).toContain('不要误解为每个 shot 都必须至少 4 秒')
    expect(primaryPrompt).toContain('group 是默认优先结构')
    expect(primaryPrompt).toContain('优先使用 3-5 个 shot 的 group')
    expect(primaryPrompt).toContain('不要机械拆成多个 2-shot group')
    expect(primaryPrompt).toContain('如果一个 group 只有 2 个 shot')
    expect(primaryPrompt).toContain('禁止为了“稳定”而默认每 2 个 shot 切一个 group')
    expect(primaryPrompt).toContain('不要输出 [3,4] 和 [5,6] 两个 group')
    expect(primaryPrompt).toContain('不要输出 screenplay、clips、storyboard、panel、image、video、videoPrompt 或 prompt 字段')
    expect(primaryPrompt).not.toContain('timeline_json')
    expect(primaryPrompt).not.toContain('visual_action_json')
    expect(primaryPrompt).not.toContain('camera_json')
    expect(primaryPrompt).not.toContain('audio_json')
    expect(primaryPrompt).not.toContain('2x2')
    expect(primaryPrompt).not.toContain('3x3')
    expect(primaryPrompt).not.toContain('宫格')

    const assetExtractPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT,
      locale: 'zh',
      variables: {
        edit_script_json: JSON.stringify({ shots: [], videoBlocks: [] }),
      },
    })

    expect(assetExtractPrompt).toContain('角色资产必须同时生成 voiceTimbreText')
    expect(assetExtractPrompt).toContain('character 必须输出 voiceTimbreText；location 禁止输出 voiceTimbreText')
    expect(assetExtractPrompt).toContain('只写固定声线，不写动态表演')
    expect(assetExtractPrompt).toContain('禁止写：语速、尾音、紧张时呼吸')

    const videoPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片',
        screenplay_text: screenplayText,
        edit_script_structure_json: JSON.stringify({
          shots: [{ shotNumber: 1, durationSec: 3, visualAction: '人物走入房间', charactersAndScene: '人物 / 房间', camera: '中景推近', sound: '脚步声' }],
          videoBlocks: [{ kind: 'single', shotNumbers: [1], reason: '单镜头稳定' }],
        }),
        asset_context_json: JSON.stringify({
          assets: [
            {
              kind: 'character',
              name: '人物',
              description: '稳定人物视觉资产。',
              voiceTimbreText: '年轻女性声线，清亮、柔和、略带气声，中高音区，声带闭合感轻，口腔共鸣明亮，鼻音很弱，颗粒感少。',
              shotNumbers: [1],
            },
          ],
        }),
        aspect_ratio: '9:16',
        style_context: 'cinematic',
      },
    })

    expect(videoPrompt).toContain('videoBlocks[].prompt 是后续直接发给视频模型的最终提示词')
    expect(videoPrompt).toContain('group prompt 不是把 single prompt 机械合并')
    expect(videoPrompt).toContain('纯文字生视频')
    expect(videoPrompt).toContain('[00:00-00:03] 镜头1')
    expect(videoPrompt).toContain('每个 prompt 必须包含声音约束')
    expect(videoPrompt).toContain('字段值必须整体使用中文自然语言')
    expect(videoPrompt).toContain('仅保留音效')
    expect(videoPrompt).toContain('不要生成 BGM、背景音乐、持续配乐')
    expect(videoPrompt).toContain('有叙事目的的电影化短音效')
    expect(videoPrompt).toContain('剧本或用户需求包含对白、旁白或画外音')
    expect(videoPrompt).toContain('角色说{台词原文}')
    expect(videoPrompt).toContain('voiceTimbreText 是角色固定音色依据')
    expect(videoPrompt).toContain('角色名（固定音色：voiceTimbreText）说{台词原文}')
    expect(videoPrompt).toContain('年轻女性声线，清亮、柔和、略带气声')
    expect(videoPrompt).toContain('生成配音不等于生成字幕')
    expect(videoPrompt).toContain('音效使用 <音效描述>')
    expect(videoPrompt).toContain('台词必须来自剧本或用户需求')
    expect(videoPrompt).toContain('非同期但叙事绑定的主观声音设计')
    expect(videoPrompt).toContain('惊吓短促重音或低频短击')
    expect(videoPrompt).toContain('不能发展成连续音乐')
    expect(videoPrompt).toContain('声音可以轻微先于画面出现形成预入声')
    expect(videoPrompt).toContain('切镜后保留短暂尾音')
    expect(videoPrompt).toContain('single prompt 的声音必须克制')
    expect(videoPrompt).toContain('缓慢抬眼')
    expect(videoPrompt).not.toContain('slowly lifts')

    const videoPromptBible = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BIBLE,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片，要安静克制',
        screenplay_text: screenplayText,
        edit_script_structure_json: JSON.stringify({ shots: [], videoBlocks: [] }),
        asset_context_json: JSON.stringify({ assets: [] }),
        aspect_ratio: '9:16',
        style_context: 'cinematic',
      },
    })
    expect(videoPromptBible).toContain('如果用户原始需求里明确指定了视觉风格')
    expect(videoPromptBible).toContain('必须优先遵守')
    expect(videoPromptBible).toContain('用户没有明确要求')
    expect(videoPromptBible).toContain('自动识别最合适的统一风格')
    expect(videoPromptBible).toContain('风格转换标准')
    expect(videoPromptBible).toContain('stylePolicy')
    expect(videoPromptBible).toContain('不要再输出 styleReferenceInterpretation 或 visualPromptPolicy')
    expect(videoPromptBible).toContain('styleSummary')
    expect(videoPromptBible).toContain('visual')
    expect(videoPromptBible).toContain('camera')
    expect(videoPromptBible).toContain('motion')
    expect(videoPromptBible).toContain('sound')
    expect(videoPromptBible).toContain('positivePrompt')
    expect(videoPromptBible).toContain('negativePrompt')
    expect(videoPromptBible).toContain('lightingPrompt')
    expect(videoPromptBible).toContain('colorPrompt')
    expect(videoPromptBible).toContain('texturePrompt')
    expect(videoPromptBible).toContain('compositionPrompt')
    expect(videoPromptBible).toContain('imageFilterPrompt')
    expect(videoPromptBible).toContain('soundFilterPrompt')
    expect(videoPromptBible).toContain('只写一句可直接塞进视频提示词风格段的凝练短语')
    expect(videoPromptBible).toContain('不得覆盖角色 voiceTimbreText')
    expect(videoPromptBible).toContain('老电影窄频声音')
    expect(videoPromptBible).toContain('禁止写依赖画面元素的具体声源或音效')
    expect(videoPromptBible).toContain('现代冷峻声音')
    expect(videoPromptBible).toContain('stylePolicy 示例')
    expect(videoPromptBible).toContain('复古悬疑短片')
    expect(videoPromptBible).toContain('老电影低对比度，柔焦镜头')
    expect(videoPromptBible).toContain('明亮童话动画质感')
    expect(videoPromptBible).not.toContain('近距离衣料和脚步拟音')
    expect(videoPromptBible).toContain('柔焦镜头，高光溢出，低对比度')
    expect(videoPromptBible).toContain('导演名、影片名、流派名或年代标签')
    expect(videoPromptBible).toContain('禅意东方作者电影')
    expect(videoPromptBible).toContain('stylePolicy.visual')
    expect(videoPromptBible).toContain('不要商业广告感，不要高反差大片感')
    expect(videoPromptBible).not.toContain('春夏秋冬又一春')
    expect(videoPromptBible).not.toContain('金基德')

    const videoPromptBlock = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK,
      locale: 'zh',
      variables: {
        user_request: '生成一条连续短片，要安静克制',
        screenplay_text: screenplayText,
        video_prompt_bible_json: JSON.stringify({ userDirectedStyle: '安静克制' }),
        video_block_json: JSON.stringify({ sourceVideoBlockIndex: 0, shotNumbers: [1] }),
        block_shots_json: JSON.stringify([{ shotNumber: 1 }]),
        asset_context_json: JSON.stringify({ assets: [] }),
        adjacent_blocks_json: JSON.stringify({ previous: null, next: null }),
        aspect_ratio: '9:16',
        style_context: 'cinematic',
      },
    })
    expect(videoPromptBlock).toContain('只为当前 videoBlock 生成视频提示词')
    expect(videoPromptBlock).toContain('user_request 或 videoPromptBible.userDirectedStyle')
    expect(videoPromptBlock).toContain('最高优先级')
    expect(videoPromptBlock).toContain('每个 shots[].videoPrompt 必须显式写入可执行风格')
    expect(videoPromptBlock).toContain('videoPromptBible.stylePolicy.visual.positivePrompt')
    expect(videoPromptBlock).toContain('videoPromptBible.stylePolicy.visual.negativePrompt')
    expect(videoPromptBlock).toContain('videoPromptBible.stylePolicy.visual.imageFilterPrompt')
    expect(videoPromptBlock).toContain('videoPromptBible.stylePolicy.sound.soundFilterPrompt')
    expect(videoPromptBlock).toContain('画面滤镜')
    expect(videoPromptBlock).toContain('声音滤镜')
    expect(videoPromptBlock).toContain('不得改写或替代角色 voiceTimbreText')
    expect(videoPromptBlock).toContain('videoBlock.prompt')
    expect(videoPromptBlock).toContain('[00:00-00:03] 镜头1')
    expect(videoPromptBlock).toContain('字段值必须整体使用中文自然语言')
    expect(videoPromptBlock).toContain('仅保留音效')
    expect(videoPromptBlock).toContain('不要生成 BGM')
    expect(videoPromptBlock).toContain('优秀 videoBlock.prompt 示例')
    expect(videoPromptBlock).toContain('路边公交站')
    expect(videoPromptBlock).toContain('海边修理铺')
    expect(videoPromptBlock).not.toContain('小和尚')
    expect(videoPromptBlock).not.toContain('老僧')

    const englishPrimaryPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      locale: 'en',
      variables: {
        user_request: 'Create a continuous short film',
        screenplay_text: screenplayText,
        duration_seconds: '8',
        aspect_ratio: '9:16',
        style_context: 'cinematic',
      },
    })

    expect(englishPrimaryPrompt).toContain('15-second limit is the highest-priority hard ceiling')
    expect(englishPrimaryPrompt).toContain('If adding the next shot would make the current group exceed 15 seconds')
    expect(englishPrimaryPrompt).toContain('must not become one 20-second group')
    expect(englishPrimaryPrompt).toContain('must not become one 25-second group')
    expect(englishPrimaryPrompt).toContain("single must contain exactly 1 shot, and that one shot's durationSec must be at least 4 seconds")
    expect(englishPrimaryPrompt).toContain('Do not misread it as a minimum duration for every shot')
    expect(englishPrimaryPrompt).toContain('group is the default preferred structure')
    expect(englishPrimaryPrompt).toContain('prefer 3-5 shot groups')
    expect(englishPrimaryPrompt).toContain('Do not mechanically split them into multiple 2-shot groups')
    expect(englishPrimaryPrompt).toContain('do not output two groups [3,4] and [5,6]')
  })
})
