import type { Locale } from '@/i18n/routing'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

export const SCENE_PROMPT_TEST_PROJECT_ID = 'system'
export const SCENE_PROMPT_TEST_TARGET_ID = 'scene-prompt-test'

export type ScenePromptVariantId =
  | 'current_baseline'
  | 'story_core_single'
  | 'spatial_wide'
  | 'multi_view_board'

export type ScenePromptStrategy = {
  readonly id: ScenePromptVariantId
  readonly label: string
  readonly aspectRatio: string
  readonly draftInstruction: string
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function joinLines(lines: ReadonlyArray<string>): string {
  return lines.filter((line) => line.trim().length > 0).join('\n')
}

function outputRule(locale: Locale): string {
  return locale === 'en'
    ? [
      'Output JSON only: {"prompt":"final image-generation prompt"}.',
      'The prompt value must be the final image prompt only. It must not include analysis notes, strategy names, hidden reasoning, the original full input, or instructions to choose a scene.',
      'The prompt must describe one empty reusable scene asset image directly: visible space, production design, lighting, color, material, atmosphere, composition, anchors, and usable standing areas.',
      'No named main characters, dialogue, readable text, subtitles, labels, arrows, watermark, or logo.',
    ].join('\n')
    : [
      '只输出 JSON：{"prompt":"最终图片生成提示词"}。',
      'prompt 字段必须只包含最终图片提示词，不得包含分析说明、策略名称、隐藏推理、完整原始输入或“选择场景”这类任务指令。',
      'prompt 必须直接描述一张空场景资产图：可见空间、美术造景、灯光、色彩、材质、空气感、构图、稳定锚点和可落位区域。',
      '不要出现有名主角、对白、可读文字、字幕、标签、箭头、水印或 Logo。',
    ].join('\n')
}

function zhSharedContext(sceneInput: string): string[] {
  return [
    `用户输入：${normalize(sceneInput)}`,
    '只能从用户输入中推断场景身份、故事阶段、隐含风格、情绪走向、后续分镜用途和可复用空间需求。不要假设额外 Style Bible、项目风格或外部剧情。',
  ]
}

function enSharedContext(sceneInput: string): string[] {
  return [
    `User input: ${normalize(sceneInput)}`,
    'Infer scene identity, story phase, implied style, emotional direction, later storyboard usage, and reusable spatial needs only from this input. Do not assume an external Style Bible, project style, or hidden story context.',
  ]
}

function buildCurrentBaselinePrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptStrategy {
  const label = input.locale === 'en' ? 'Current baseline' : '当前基准'
  const draftInstruction = buildAiPrompt({
    promptId: AI_PROMPT_IDS.LOCATION_CREATE,
    locale: input.locale,
    variables: {
      user_input: input.sceneInput,
    },
  })
  return { id: 'current_baseline', label, aspectRatio: '16:9', draftInstruction }
}

function buildStoryCoreSinglePrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptStrategy {
  const label = input.locale === 'en' ? 'Narrative core set' : '叙事核心造景'
  const draftInstruction = input.locale === 'en'
    ? joinLines([
      'You are a film production designer and story-aware location designer. Convert the user input into one final image-generation prompt.',
      ...enSharedContext(input.sceneInput),
      'Strategy: choose the single location that best carries the story conflict, reveal, reversal, or recurring dramatic pressure. The final prompt must make that choice visible through set design, not through explanatory text.',
      'Use cinematic mise-en-scene: architecture, negative space, object placement, lighting motivation, color contrast, material aging, and atmosphere should imply the story tension.',
      outputRule(input.locale),
    ])
    : joinLines([
      '你是电影美术指导和故事导向的选景设计师。请把用户输入转换成一条最终图片生成提示词。',
      ...zhSharedContext(input.sceneInput),
      '策略：选择最能承载故事冲突、揭示、反转或反复戏剧压力的单一地点。最终 prompt 要通过造景本身体现这个选择，不要写解释文字。',
      '使用电影场面调度和造景思维：建筑结构、负空间、物件摆放、灯光动机、色彩对比、材质新旧和空气氛围都要暗示故事张力。',
      outputRule(input.locale),
    ])
  return { id: 'story_core_single', label, aspectRatio: '16:9', draftInstruction }
}

function buildSpatialWidePrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptStrategy {
  const label = input.locale === 'en' ? 'Production texture set' : '电影美术质感造景'
  const draftInstruction = input.locale === 'en'
    ? joinLines([
      'You are a senior film art director specializing in texture, atmosphere, and production design. Convert the user input into one final image-generation prompt.',
      ...enSharedContext(input.sceneInput),
      'Strategy: prioritize atmosphere and set-detail quality. Infer the genre, era, class texture, emotional temperature, and visual subtext from the input, then turn them into concrete set dressing, surfaces, decay/use traces, practical light sources, palette, haze, reflections, and shadow design.',
      'The final prompt should feel art-directed and story-specific, not a generic location description.',
      outputRule(input.locale),
    ])
    : joinLines([
      '你是擅长质感、氛围和美术造景的资深电影美术指导。请把用户输入转换成一条最终图片生成提示词。',
      ...zhSharedContext(input.sceneInput),
      '策略：优先追求氛围和美术质感。根据输入推断类型、年代、阶层质感、情绪温度和视觉潜台词，再转译成具体陈设、表面材质、使用痕迹、实景光源、色彩、雾气/反光和阴影设计。',
      '最终 prompt 必须像经过电影美术设计的专属场景，而不是泛泛的地点描述。',
      outputRule(input.locale),
    ])
  return { id: 'spatial_wide', label, aspectRatio: '16:9', draftInstruction }
}

function buildMultiViewBoardPrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptStrategy {
  const label = input.locale === 'en' ? 'Blocking-ready wide set' : '分镜调度宽幅造景'
  const draftInstruction = input.locale === 'en'
    ? joinLines([
      'You are a cinematographer and production designer building a reusable scene asset for storyboard blocking. Convert the user input into one final image-generation prompt.',
      ...enSharedContext(input.sceneInput),
      'Strategy: design a 21:9 wide empty set that can support later character placement, entrances, exits, confrontation angles, shoulder-space, reverse shots, and camera reframing. The image must still be visually rich and story-specific.',
      'Final prompt must include clear foreground/midground/background, 4-6 reusable anchors, motivated lighting, readable open standing zones, and no object clutter that blocks characters.',
      outputRule(input.locale),
    ])
    : joinLines([
      '你是为分镜调度搭建可复用场景资产的摄影指导和电影美术指导。请把用户输入转换成一条最终图片生成提示词。',
      ...zhSharedContext(input.sceneInput),
      '策略：设计一张 21:9 宽幅空场景，便于后续人物落位、入场、离场、对峙角度、肩后空间、反打镜头和重新构图；同时必须保持有故事内涵和美术质感。',
      '最终 prompt 必须包含清晰前景/中景/背景、4-6 个可复用锚点、有动机的灯光、可读的空置站位区，并避免物件堆满导致角色无法进入。',
      outputRule(input.locale),
    ])
  return { id: 'multi_view_board', label, aspectRatio: '21:9', draftInstruction }
}

export function buildScenePromptTestStrategies(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptStrategy[] {
  return [
    buildCurrentBaselinePrompt(input),
    buildStoryCoreSinglePrompt(input),
    buildSpatialWidePrompt(input),
    buildMultiViewBoardPrompt(input),
  ]
}
