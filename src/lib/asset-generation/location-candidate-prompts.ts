import type { Locale } from '@/i18n/routing'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import type { EditScriptStyleBible } from '@/lib/edit-script/types'
import { renderStyleBiblePromptBlock } from '@/lib/edit-script/style-bible-prompt'

export type LocationCandidateStrategyId =
  | 'current_baseline'
  | 'narrative_core_set'
  | 'production_texture_set'

export const LOCATION_CANDIDATE_PROMPT_COUNT = 3

export interface LocationCandidateStrategy {
  readonly id: LocationCandidateStrategyId
  readonly label: string
  readonly aspectRatio: '4:3'
  readonly draftInstruction: string
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function joinLines(lines: ReadonlyArray<string | null>): string {
  return lines
    .map((line) => line?.trim() || '')
    .filter((line) => line.length > 0)
    .join('\n')
}

function outputRule(locale: Locale): string {
  if (locale === 'en') {
    return joinLines([
      'Output JSON only: {"prompt":"final image-generation prompt"}.',
      'The prompt value must be the final image prompt only. It must not include analysis notes, strategy names, hidden reasoning, the original full input, or instructions to choose a scene.',
      'The final image prompt must directly describe one empty reusable scene asset image: visible space, production design, lighting, color, material, atmosphere, composition, stable anchors, and usable open floor or open space for later character placement.',
      'Final composition requirement: 4:3 landscape aspect ratio, centered composition, complete full-scene establishing view, clear foreground/midground/background, not a narrative action beat.',
      'No named main characters, dialogue, readable subtitles, labels, arrows, watermark, or logo.',
    ])
  }

  return joinLines([
    '只输出 JSON：{"prompt":"最终图片生成提示词"}。',
    'prompt 字段必须只包含最终图片提示词，不得包含分析说明、策略名称、隐藏推理、完整原始输入或“选择场景”这类任务指令。',
    '最终 prompt 必须直接描述一张空场景资产图：可见空间、美术造景、灯光、色彩、材质、空气感、构图、稳定锚点和后续人物可落位区域。',
    '最终构图要求：4:3 横版画幅，居中构图，展示完整全景，清楚呈现前景/中景/背景，不要像分镜截图或叙事动作瞬间。',
    '不要出现有名主角、对白、可读字幕、标签、箭头、水印或 Logo。',
  ])
}

function sharedContext(input: { readonly description: string; readonly locale: Locale }): string[] {
  const description = normalizeText(input.description)
  if (input.locale === 'en') {
    return [
      `Scene source input: ${description}`,
      'Infer scene identity, story phase, implied genre, emotional direction, reusable video-reference needs, and visible production-design requirements only from this input plus any style block appended later by the system.',
      'Choose the most useful single scene asset for later full-reference video generation; do not merely repeat the first mentioned location if another visible space better carries the story.',
    ]
  }
  return [
    `场景来源输入：${description}`,
    '只能从这个输入以及系统稍后追加的风格块中推断场景身份、故事阶段、隐含类型、情绪走向、后续分镜复用需求和可见美术造景要求。',
    '要选择最适合后续分镜继承的单一场景资产，不要只是机械复述第一个被提到的地点。',
  ]
}

function styleBibleContext(input: {
  readonly locale: Locale
  readonly styleBible: EditScriptStyleBible | null
}): string | null {
  if (!input.styleBible) return null
  const block = renderStyleBiblePromptBlock({
    styleBible: input.styleBible,
    usage: 'assetImage',
    locale: input.locale,
  })
  return input.locale === 'en'
    ? `Project Style Bible:\n${block}`
    : `项目 Style Bible：\n${block}`
}

function buildCurrentBaseline(input: {
  readonly description: string
  readonly locale: Locale
  readonly styleBible: EditScriptStyleBible | null
}): LocationCandidateStrategy {
  const baseInstruction = buildAiPrompt({
    promptId: AI_PROMPT_IDS.LOCATION_CREATE,
    locale: input.locale,
    variables: {
      user_input: input.description,
    },
  })
  const draftInstruction = joinLines([
    baseInstruction,
    styleBibleContext(input),
    input.locale === 'en'
      ? 'Convert the result into a final reusable scene asset prompt.'
      : '请把结果转换成一条最终可复用场景资产图片提示词。',
    outputRule(input.locale),
  ])
  return {
    id: 'current_baseline',
    label: input.locale === 'en' ? 'Current baseline' : '当前基准',
    aspectRatio: '4:3',
    draftInstruction,
  }
}

function buildNarrativeCore(input: {
  readonly description: string
  readonly locale: Locale
  readonly styleBible: EditScriptStyleBible | null
}): LocationCandidateStrategy {
  const draftInstruction = input.locale === 'en'
    ? joinLines([
      'You are a film production designer and story-aware location designer. Convert the scene source input into one final image-generation prompt.',
      ...sharedContext(input),
      styleBibleContext(input),
      'Strategy: choose the location that best carries the story conflict, reveal, reversal, recurring dramatic pressure, or emotional turn. Make that choice visible through set design, not explanatory text.',
      'Use mise-en-scene: architecture, negative space, object placement, motivated lighting, color contrast, material age, and atmosphere should imply the story tension.',
      'General example of the expected reasoning-to-prompt style, do not copy the subject: If the story is about a family-heir discovering forged accident records, choose a basement archive rather than a generic office; describe concrete archive shelves, safe door, surveillance camera, file boxes, oppressive symmetry, and a single distant indicator light.',
      outputRule(input.locale),
    ])
    : joinLines([
      '你是电影美术指导和故事导向的选景设计师。请把场景来源输入转换成一条最终图片生成提示词。',
      ...sharedContext(input),
      styleBibleContext(input),
      '策略：选择最能承载故事冲突、揭示、反转、反复戏剧压力或情绪转折的地点。最终 prompt 要通过造景本身体现这个选择，不要写解释文字。',
      '使用电影场面调度和造景思维：建筑结构、负空间、物件摆放、灯光动机、色彩对比、材质新旧和空气氛围都要暗示故事张力。',
      '泛化示例，只学习方式不要复制题材：如果故事是财阀继承人发现伪造事故记录，应选择地下档案库而不是普通办公室；prompt 里要写清金属档案架、保险柜门、旧监控、档案箱、压迫性对称和深处唯一指示灯。',
      outputRule(input.locale),
    ])
  return {
    id: 'narrative_core_set',
    label: input.locale === 'en' ? 'Narrative core set' : '叙事核心造景',
    aspectRatio: '4:3',
    draftInstruction,
  }
}

function buildProductionTexture(input: {
  readonly description: string
  readonly locale: Locale
  readonly styleBible: EditScriptStyleBible | null
}): LocationCandidateStrategy {
  const draftInstruction = input.locale === 'en'
    ? joinLines([
      'You are a senior film art director specializing in set detail, texture, atmosphere, and production-design quality. Convert the scene source input into one final image-generation prompt.',
      ...sharedContext(input),
      styleBibleContext(input),
      'Strategy: prioritize concrete visible set dressing and art-directed texture. Infer era, genre, class texture, emotional temperature, and visual subtext, then translate them into layout, furniture, props, surface materials, use traces, practical light sources, palette, haze, reflections, and shadow design.',
      'The prompt must be detailed enough that every important set element has a purpose. It should feel designed like a film set, not a generic location description.',
      'General example of the expected art-direction density, do not copy the subject: for a clean near-future spacecraft, describe white composite panels, seamless glowing ceiling, polished pale-gray floor, built-in seats, rounded cabin doors, thin blue-white status lights, hidden vents, almost no clutter, and one small abnormal object.',
      outputRule(input.locale),
    ])
    : joinLines([
      '你是擅长景物细节、质感、氛围和美术完成度的资深电影美术指导。请把场景来源输入转换成一条最终图片生成提示词。',
      ...sharedContext(input),
      styleBibleContext(input),
      '策略：优先追求具体可见的陈设和电影美术质感。根据输入推断年代、类型、阶层质感、情绪温度和视觉潜台词，再转译成空间布局、家具道具、表面材质、使用痕迹、实景光源、色彩、雾气/反光和阴影设计。',
      'prompt 必须细到每个重要景物都有作用，像经过电影美术设计的专属场景，而不是泛泛的地点描述。',
      '泛化示例，只学习美术密度不要复制题材：如果是洁净近未来飞船，应写白色复合墙板、无缝发光天花、抛光浅灰地面、内嵌座椅、圆角舱门、细蓝白状态灯、隐藏通风缝、几乎无杂物，以及一个制造异常感的小物件。',
      outputRule(input.locale),
    ])
  return {
    id: 'production_texture_set',
    label: input.locale === 'en' ? 'Production texture set' : '电影美术质感造景',
    aspectRatio: '4:3',
    draftInstruction,
  }
}

export function buildLocationCandidateStrategies(input: {
  readonly description: string
  readonly locale: Locale
  readonly styleBible: EditScriptStyleBible | null
}): LocationCandidateStrategy[] {
  return [
    buildCurrentBaseline(input),
    buildNarrativeCore(input),
    buildProductionTexture(input),
  ]
}

export function appendLocationCompleteSceneRule(input: {
  readonly prompt: string
  readonly locale: Locale
}): string {
  const rule = input.locale === 'en'
    ? '4:3 landscape aspect ratio, centered composition, complete full-scene establishing view, reusable empty scene asset reference, clear foreground/midground/background and usable open floor or open space.'
    : '4:3 横版画幅，居中构图，展示完整全景，可复用空场景资产参考图，清楚呈现前景/中景/背景和可供人物落位的空地或空间。'
  return joinLines([input.prompt, rule])
}

export function parseLocationCandidatePrompt(parsed: Record<string, unknown>): string {
  const prompt = parsed.prompt
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('LOCATION_CANDIDATE_PROMPT_INVALID')
  }
  return prompt.trim()
}
