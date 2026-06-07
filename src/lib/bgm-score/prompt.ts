import type {
  FinalRenderClipPlan,
  FinalRenderEditScriptInput,
  FinalRenderProjectContextInput,
} from '@/lib/video-compose/final-render-plan'
import type { Locale } from '@/i18n/routing'
import type { BgmScorePlan } from './types'

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildEditScriptPayload(editScript: FinalRenderEditScriptInput | null): unknown {
  if (!editScript) return null
  return {
    id: editScript.id,
    title: editScript.title,
    logline: editScript.logline ?? null,
    durationSec: editScript.durationSec,
    styleBible: editScript.styleBible ?? null,
    shots: editScript.shots.map((shot) => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      dramaticPurpose: shot.dramaticPurpose,
      visibleAction: shot.visibleAction,
      audienceFocus: shot.audienceFocus,
      viewpoint: shot.viewpoint,
      revealPlan: shot.revealPlan,
      performanceBeat: shot.performanceBeat,
      continuityIn: shot.continuityIn,
      continuityOut: shot.continuityOut,
      charactersAndScene: shot.charactersAndScene ?? '',
      sound: shot.sound,
    })),
    videoBlocks: editScript.videoBlocks.map((block, index) => ({
      blockNumber: index + 1,
      kind: block.kind,
      shotNumbers: block.shotNumbers,
      gridMode: block.gridMode ?? null,
      reason: block.reason,
      prompt: block.prompt,
    })),
  }
}

function buildProjectContextPayload(projectContext: FinalRenderProjectContextInput | null | undefined): unknown {
  if (!projectContext) return {}
  return {
    videoRatio: normalizeString(projectContext.videoRatio) || null,
  }
}

function buildTimelinePayload(clips: readonly FinalRenderClipPlan[]): unknown {
  return clips.map((clip) => ({
    order: clip.order,
    sourceKind: clip.sourceKind,
    panelId: clip.panelId,
    groupId: clip.groupId ?? null,
    shotNumber: clip.shotNumber,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
    visualSummary: clip.description,
    videoSoundDirection: clip.sound,
  }))
}

export function buildBgmScorePlanPrompt(input: {
  readonly editScript: FinalRenderEditScriptInput | null
  readonly projectContext?: FinalRenderProjectContextInput | null
  readonly clips: readonly FinalRenderClipPlan[]
  readonly totalDurationSeconds: number
  readonly locale?: Locale
}): string {
  if (input.locale === 'zh') {
    return [
      '你是专业影视作曲师，只为 AI 生成视频设计连续背景配乐。',
      '视频模型已经负责对白、角色声音、环境声和事件音效。不要设计拟音、配音、环境声替代、字面环境音或字面音效。',
      '最终输出会作为一整条完整纯器乐背景音乐生成，不是多个分轨或孤立片段。',
      '',
      '请先创建灵活的配乐设计，再把设计压缩成一段优秀的音乐生成提示词。',
      '必要时可以使用专业影视配乐概念：速度图、拍号、强拍、段落、调性中心、转调、和声节奏、和弦语言、情绪击点、停顿、张力释放、动机、音区、配器、频段角色、混音空间、对白下方克制感。',
      '这些概念只是辅助，不是固定模板。科幻、黑帮、恐怖、犯罪、喜剧、爱情、剧情、动作等不同影片应使用不同结构。',
      '只包含真正服务本条配乐的设计段落，不要强行覆盖所有类别。',
      '',
      '规则：',
      '1. 为完整时长生成一条连贯背景音乐。音乐供应商只会收到 finalPrompt 和 negativePrompt。',
      '2. scoreDesign.sections 是给 UI 展示的动态专业设计说明；类别和标题要贴合影片，不要使用固定清单。',
      '3. virtualLayers 是文本说明层，用来解释单条最终配乐内部如何运作，不会独立渲染。',
      '4. promptSections 是文本提示词积木，用来说明 finalPrompt 压缩前的音乐逻辑。',
      '5. finalPrompt 必须是一段自洽的单条纯器乐电影背景音乐提示词，包含时长、风格、情绪弧线、有用时的速度/调性、配乐段落、关键击点、编曲/配器和混音约束。',
      '6. 为视频对白和原生视频声音留出空间，避免过度配乐和全频拥挤。',
      '7. 不要人声、歌词、对白、拟音、脚步声、物件声、字面环境声替代、转场音效或独立音效。',
      '8. 所有会显示在画布上的字段值必须使用中文自然语言，包括 creativeBrief、scoreDesign.sections、virtualLayers、promptSections、finalPrompt 和 negativePrompt；除专有名词、模型字段名和原文台词外，不要输出英文句子。',
      '9. 只返回严格 JSON。不要 markdown、注释或 JSON 外文字。',
      '',
      'Required JSON shape:',
      safeJson({
        durationSeconds: input.totalDurationSeconds,
        creativeBrief: {
          cueType: '连续纯器乐背景配乐',
          genre: '贴合影片的类型，例如科幻剧情 / 黑色犯罪 / 浪漫喜剧',
          mood: '主要情绪方向',
          narrativeFunction: '音乐如何服务故事与剪辑连续性',
        },
        scoreDesign: {
          overview: '用一段话说明完整配乐策略',
          sections: [
            {
              category: '动态类别，例如情绪弧线 / 速度 / 调性 / 击点 / 配器 / 动机 / 混音空间',
              title: '具体段落标题',
              purpose: '这条设计为什么对配乐重要',
              startSec: 0,
              endSec: input.totalDurationSeconds,
              content: '专业音乐方向；只有在有帮助时才写具体数值',
            },
          ],
        },
        virtualLayers: [
          {
            name: '文本说明用内部编曲层名称',
            purpose: '它在单条最终配乐内部承担的音乐职责',
            content: '它贡献什么，以及应该避免什么',
          },
        ],
        promptSections: [
          {
            title: '提示词积木标题',
            purpose: '这个积木为什么存在',
            startSec: 0,
            endSec: input.totalDurationSeconds,
            content: '应被压缩进 finalPrompt 的提示词语言',
          },
        ],
        finalPrompt: '生成一条 57 秒完整连续的纯器乐电影背景配乐……',
        negativePrompt: '不要人声、不要歌词、不要对白、不要拟音、不要字面音效、不要全频拥挤',
      }),
      '',
      'Edit script JSON:',
      safeJson(buildEditScriptPayload(input.editScript)),
      '',
      'Project visual/director context JSON:',
      safeJson(buildProjectContextPayload(input.projectContext)),
      '',
      'Final rendered media timeline JSON:',
      safeJson(buildTimelinePayload(input.clips)),
    ].join('\n')
  }

  return [
    'You are a professional film composer designing only the continuous BGM score for an AI-generated video.',
    'The video model already produces dialogue, character sounds, environment sounds, and event sound effects. Do not design Foley, voice, ambience replacement, literal ambience, or literal sound effects.',
    'The final output will be generated as one single complete instrumental BGM track, not separate rendered stems.',
    '',
    'First create a flexible score design, then condense that design into one excellent music-generation prompt.',
    'Use professional film-scoring concepts when useful: tempo map, meter, downbeat, cue sections, tonal center, modulation, harmonic rhythm, chord language, hit points, rests, tension and release, motif, register, orchestration, frequency roles, mix space, and restraint under dialogue.',
    'These concepts are guidance, not a fixed template. Different films need different structures: sci-fi, gangster, horror, crime, comedy, romance, drama, and action cues can organize themselves differently.',
    'Only include design sections that actually help this cue. Do not force every category to appear.',
    '',
    'Rules:',
    '1. Generate one coherent BGM cue for the full duration. The music provider will receive only finalPrompt and negativePrompt.',
    '2. scoreDesign.sections must be dynamic professional notes for the UI; use categories and titles that match the film, not a fixed list.',
    '3. virtualLayers are text-only arrangement layers that explain how the single final cue should internally behave. They are not rendered independently.',
    '4. promptSections are text-only prompt building blocks. They should explain the musical logic that finalPrompt compresses.',
    '5. finalPrompt must be a self-contained prompt for a single instrumental cinematic BGM track. It must include duration, style, emotional arc, tempo/tonality only when useful, cue sections, key hit points, arrangement/orchestration, and mix constraints.',
    '6. Leave space for video dialogue and native video sound. Avoid over-scoring and avoid full-range clutter.',
    '7. No vocals, lyrics, dialogue, Foley, footsteps, object sounds, literal ambience replacement, whoosh SFX, or standalone sound effects.',
    '8. Return strict JSON only. No markdown, no comments, no prose outside JSON.',
    '',
    'Required JSON shape:',
    safeJson({
      durationSeconds: input.totalDurationSeconds,
      creativeBrief: {
        cueType: 'continuous instrumental underscore',
        genre: 'film-specific genre, e.g. sci-fi drama / noir crime / romantic comedy',
        mood: 'main emotional direction',
        narrativeFunction: 'what the music must do for story and edit continuity',
      },
      scoreDesign: {
        overview: 'one paragraph explaining the complete score strategy',
        sections: [
          {
            category: 'dynamic category such as Cue Arc / Tempo / Tonality / Hit Point / Orchestration / Motif / Mix Space',
            title: 'specific section title',
            purpose: 'why this note matters for the cue',
            startSec: 0,
            endSec: input.totalDurationSeconds,
            content: 'professional music direction; include concrete values only when they help',
          },
        ],
      },
      virtualLayers: [
        {
          name: 'text-only internal arrangement layer name',
          purpose: 'its musical responsibility inside the one final cue',
          content: 'what it contributes and what it should avoid',
        },
      ],
      promptSections: [
        {
          title: 'prompt building block title',
          purpose: 'why this block exists',
          startSec: 0,
          endSec: input.totalDurationSeconds,
          content: 'prompt language that should be condensed into finalPrompt',
        },
      ],
      finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 57 seconds...',
      negativePrompt: 'no vocals, no lyrics, no dialogue, no Foley, no literal sound effects, no full-range clutter',
    }),
    '',
    'Edit script JSON:',
    safeJson(buildEditScriptPayload(input.editScript)),
    '',
    'Project visual/director context JSON:',
    safeJson(buildProjectContextPayload(input.projectContext)),
    '',
    'Final rendered media timeline JSON:',
    safeJson(buildTimelinePayload(input.clips)),
  ].join('\n')
}

export function buildFinalBgmMusicPrompt(plan: BgmScorePlan, options: { readonly locale?: Locale } = {}): string {
  const negativePrompt = plan.negativePrompt?.trim()
  if (options.locale === 'zh') {
    return [
      plan.finalPrompt.trim(),
      '',
      '生成单条最终配乐时必须遵守的作曲设计说明：',
      `创意简报：${safeJson(plan.creativeBrief)}`,
      `配乐设计：${safeJson(plan.scoreDesign)}`,
      `文本说明用内部编曲层：${safeJson(plan.virtualLayers)}`,
      `提示词积木：${safeJson(plan.promptSections)}`,
      '',
      '请精确渲染一条连贯的纯器乐背景音乐，不要输出分轨，也不要做孤立乐器片段演示。',
      '让配乐贯穿完整时间线，同时为视频对白、原生声音和事件音频留出空间。',
      '避免字面音效，避免拥挤的全频编曲，除非设计明确要求密集度。',
      negativePrompt ? `负向提示词：${negativePrompt}` : '',
    ].filter(Boolean).join('\n')
  }

  return [
    plan.finalPrompt.trim(),
    '',
    'Composer design notes to honor inside the single rendered cue:',
    `Creative brief: ${safeJson(plan.creativeBrief)}`,
    `Score design: ${safeJson(plan.scoreDesign)}`,
    `Text-only internal arrangement layers: ${safeJson(plan.virtualLayers)}`,
    `Prompt building blocks: ${safeJson(plan.promptSections)}`,
    '',
    'Render exactly one coherent instrumental BGM track, not separate stems, not a demo of isolated parts.',
    'Keep the score continuous across the full timeline while leaving space for video dialogue, native sound, and event audio.',
    'Avoid literal sound effects and avoid cluttered full-range arrangement unless the design explicitly calls for density.',
    negativePrompt ? `Negative prompt: ${negativePrompt}` : '',
  ].filter(Boolean).join('\n')
}
