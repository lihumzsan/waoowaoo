import type { Locale } from '@/i18n/routing'

export const SCENE_PROMPT_TEST_PROJECT_ID = 'system'
export const SCENE_PROMPT_TEST_TARGET_ID = 'scene-prompt-test'

export type ScenePromptVariantId =
  | 'current_baseline'
  | 'story_core_single'
  | 'spatial_wide'
  | 'multi_view_board'

export type ScenePromptVariant = {
  readonly id: ScenePromptVariantId
  readonly label: string
  readonly aspectRatio: string
  readonly prompt: string
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function joinLines(lines: ReadonlyArray<string | null>): string {
  return lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).join('\n')
}

function zhSharedContext(sceneInput: string): string[] {
  return [
    `用户唯一输入：${normalize(sceneInput)}`,
    '必须只从用户唯一输入中分析：场景身份、故事阶段、潜在风格、情绪走向、后续分镜用途和可复用空间需求。不要假设存在额外 Style Bible、项目风格或外部剧情。',
  ]
}

function enSharedContext(sceneInput: string): string[] {
  return [
    `Only user input: ${normalize(sceneInput)}`,
    'Analyze scene identity, story phase, implied style, emotional direction, later storyboard usage, and reusable spatial needs only from this single input. Do not assume an external Style Bible, project style, or hidden story context.',
  ]
}

function buildCurrentBaselinePrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptVariant {
  const label = input.locale === 'en' ? 'Current baseline' : '当前基准'
  const prompt = input.locale === 'en'
    ? joinLines([
      'Generate one empty scene asset image using the current broad environment-reference style.',
      ...enSharedContext(input.sceneInput),
      'Select one concrete location that appears in the story. Prioritize a wide establishing view of the location itself.',
      'Do not perform deep story-aware scene selection. Treat implied style as secondary; focus on visible layout, foreground, midground, background, spatial boundaries, anchor objects, material details, lighting direction, and open standing areas.',
      'No named main characters. No story action. No text labels, numbers, UI marks, watermark, or logo.',
    ])
    : joinLines([
      '使用当前宽广环境参考图逻辑，生成一张空场景资产图。',
      ...zhSharedContext(input.sceneInput),
      '从故事中选择一个具体出现过的地点，优先生成该地点的广角建立视角。',
      '不要做深度故事导向选景，隐含风格只作为次要参考；重点展示可见布局、前景/中景/背景、空间边界、关键锚点、材质细节、光线方向和可落人空地。',
      '不要出现有名主角，不要表现剧情动作，不要文字标签、编号、UI 标记、水印或 Logo。',
    ])
  return { id: 'current_baseline', label, aspectRatio: '16:9', prompt }
}

function buildStoryCoreSinglePrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptVariant {
  const label = input.locale === 'en' ? 'Story-core scene' : '故事核心单视图'
  const prompt = input.locale === 'en'
    ? joinLines([
      'Generate one reusable cinematic scene asset image by first choosing the single most useful scene for later storyboard generation.',
      ...enSharedContext(input.sceneInput),
      'Internal decision rule: infer the location that best supports the protagonist conflict, the central turning point, repeated future shots, and the input-implied style. Do not choose a random mentioned place.',
      'Translate story era, genre, emotional direction, and implied style into direct visual traits: architecture, material aging, color palette, lighting source, image filter, atmosphere, and stable negative constraints.',
      'The image must be one coherent empty environment, not a collage. Show a readable main viewpoint with clear entry/exit points, 3-5 stable anchors, foreground/midground/background depth, and unblocked floor areas for one or more characters.',
      'Do not include named main characters, temporary plot action, subtitles, labels, arrows, watermark, or logo.',
    ])
    : joinLines([
      '生成一张可复用的电影化场景资产图，必须先从故事中选择最适合后续分镜继承的单一场景。',
      ...zhSharedContext(input.sceneInput),
      '内部选择规则：推断最能承载主角冲突、核心转折、后续反复出镜和输入隐含风格的地点，不能随便挑一个被提到的地点。',
      '把故事时代、类型、情绪走向和隐含风格转译成直接可见的视觉属性：建筑结构、材质新旧、色彩方案、灯光来源、画面滤镜、空气氛围和稳定禁用项。',
      '画面必须是一张连贯空场景，不要拼贴。使用清晰主视角，展示入口/出口、3-5 个稳定锚点、前景/中景/背景纵深，以及可供一个或多个角色落位的无遮挡地面。',
      '不要出现有名主角、临时剧情动作、字幕、标签、箭头、水印或 Logo。',
    ])
  return { id: 'story_core_single', label, aspectRatio: '16:9', prompt }
}

function buildSpatialWidePrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptVariant {
  const label = input.locale === 'en' ? 'Spatial staging wide' : '空间调度宽幅'
  const prompt = input.locale === 'en'
    ? joinLines([
      'Generate one wide cinematic environment asset optimized for character blocking and repeated storyboard staging.',
      ...enSharedContext(input.sceneInput),
      'First infer the best reusable location from the story arc, then design a wide horizontal view that can support entrances, exits, confrontations, pauses, and shot/reverse-shot continuity.',
      'Make the scene style concrete: lighting strategy, palette, filter, material texture, weather/air quality, and production-design era must come from the single input.',
      'Use a 21:9 wide composition. Keep the camera far enough to reveal the full usable space. Clearly reserve empty standing zones near meaningful anchors such as doorway edge, table side, wall recess, steps, railing, window light, altar front, machine console, or courtyard center.',
      'Do not fill every area with objects. Do not include named main characters, action beats, text, labels, arrows, watermark, or logo.',
    ])
    : joinLines([
      '生成一张适合人物调度和反复分镜使用的宽幅电影化环境资产图。',
      ...zhSharedContext(input.sceneInput),
      '先根据故事走向推断最值得复用的地点，再设计一个能支持入场、离场、对峙、停顿和正反打连续性的横向宽视角。',
      '场景风格必须具体：灯光策略、色彩、滤镜、材质质感、天气/空气感和美术年代感都要来自用户唯一输入。',
      '使用 21:9 宽幅构图。镜头要足够远，能看到完整可用空间。必须在有意义的锚点附近保留空地，例如门边、桌侧、墙龛、台阶、栏杆、窗光下、祭坛前、机器控制台、庭院中央。',
      '不要把所有区域都塞满物体。不要出现有名主角、剧情动作、文字、标签、箭头、水印或 Logo。',
    ])
  return { id: 'spatial_wide', label, aspectRatio: '21:9', prompt }
}

function buildMultiViewBoardPrompt(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptVariant {
  const label = input.locale === 'en' ? 'Story-aware multi-view board' : '三视图造景板'
  const prompt = input.locale === 'en'
    ? joinLines([
      'Generate one story-aware multi-view scene design board for later storyboard reference.',
      ...enSharedContext(input.sceneInput),
      'First select the one location that best serves the inferred story arc and input-implied style. Then show the same selected location in a single image with three coordinated view regions: main cinematic front view, reverse/back view from the opposite side, and art-directed top-down view.',
      'All regions must depict the same location, same architecture, same materials, same lighting logic, and same color/filter treatment. The top-down view must reveal entrances, exits, anchor objects, and clear standing zones; it must not look like an engineering blueprint.',
      'Use subtle panel boundaries if needed, but no text labels, numbers, arrows, UI marks, watermark, or logo. No named main characters and no temporary plot action.',
    ])
    : joinLines([
      '生成一张用于后续分镜参考的故事导向多视图场景设定板。',
      ...zhSharedContext(input.sceneInput),
      '先选择最能服务推断出的故事走向和输入隐含风格的单一地点，再在同一张图里展示同一场景的三个协调区域：电影化正面主视图、对侧反面视图、美术化顶面视图。',
      '三个区域必须是同一地点、同一建筑结构、同一材质、同一灯光逻辑、同一色彩与滤镜处理。顶面视图必须展示入口出口、关键锚点和清晰可站区域，但不要像工程蓝图。',
      '必要时可以有轻微分区边界，但不要文字标签、编号、箭头、UI 标记、水印或 Logo。不要出现有名主角，不要表现临时剧情动作。',
    ])
  return { id: 'multi_view_board', label, aspectRatio: '16:9', prompt }
}

export function buildScenePromptTestVariants(input: {
  readonly sceneInput: string
  readonly locale: Locale
}): ScenePromptVariant[] {
  return [
    buildCurrentBaselinePrompt(input),
    buildStoryCoreSinglePrompt(input),
    buildSpatialWidePrompt(input),
    buildMultiViewBoardPrompt(input),
  ]
}
