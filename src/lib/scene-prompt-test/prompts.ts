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
      'The final image must use centered composition and a full wide scene view, like a reusable scene asset reference, not a storyboard frame or narrative beat.',
      'No named main characters, dialogue, readable text, subtitles, labels, arrows, watermark, or logo.',
    ].join('\n')
    : [
      '只输出 JSON：{"prompt":"最终图片生成提示词"}。',
      'prompt 字段必须只包含最终图片提示词，不得包含分析说明、策略名称、隐藏推理、完整原始输入或“选择场景”这类任务指令。',
      'prompt 必须直接描述一张空场景资产图：可见空间、美术造景、灯光、色彩、材质、空气感、构图、稳定锚点和可落位区域。',
      '最终图片必须是居中构图、展示全景的场景资产参考图，不要像分镜截图或叙事瞬间。',
      '不要出现有名主角、对白、可读文字、字幕、标签、箭头、水印或 Logo。',
    ].join('\n')
}

export function appendScenePromptTestCompositionRule(input: {
  readonly prompt: string
  readonly locale: Locale
}): string {
  const rule = input.locale === 'en'
    ? 'Centered composition, full wide establishing view, reusable empty scene asset reference, not a storyboard frame or narrative moment.'
    : '居中构图，展示全景，可复用空场景资产参考图，不要像分镜截图或叙事瞬间。'
  return joinLines([input.prompt.trim(), rule])
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

function zhStoryCoreExample(): string[] {
  return [
    '示例只用于学习侧重点，不要复制示例题材。',
    '示例输入：财阀继承人在家族公司地下档案库发现父亲伪造事故记录，所有灯突然熄灭，只剩保险柜指示灯在闪。',
    '示例最终 prompt：一张空场景资产图，地点选择为家族公司地下档案库而不是普通办公室；居中全景构图，冷色混凝土地下空间，两侧高耸金属档案架形成压迫性对称透视，中央尽头是一扇厚重保险柜门和微弱红色指示灯，地面有整齐档案箱、散落但不可读的文件边角、旧监控摄像头、低矮管线和窄长顶灯；整体通过封闭结构、深处唯一光点、负空间和秩序化档案墙暗示家族秘密与权力压迫；无人物、无文字、无剧情动作。',
  ]
}

function enStoryCoreExample(): string[] {
  return [
    'Example for emphasis only; do not copy its subject matter.',
    'Example input: The heir of a wealthy family finds forged accident records in the family company basement archive; all lights cut out except a blinking safe indicator.',
    'Example final prompt: Empty reusable scene asset image, choose the family-company basement archive rather than a generic office; centered full-scene composition, cold concrete underground space, towering metal archive shelves on both sides creating oppressive symmetrical perspective, a heavy safe door at the far center with one weak red indicator light, ordered archive boxes on the floor, scattered unreadable file edges, old surveillance camera, low utility pipes and narrow ceiling strip lights; the closed architecture, single distant light point, negative space, and disciplined archive walls imply family secrets and institutional pressure; no people, no readable text, no story action.',
  ]
}

function zhProductionTextureExample(): string[] {
  return [
    '示例只用于学习侧重点，不要复制示例题材。',
    '示例输入：近未来宇航员在长途航行中醒来，发现飞船公共舱没有任何乘客，广播仍在播放欢迎语。',
    '示例最终 prompt：一张空场景资产图，近未来飞船公共舱，居中全景构图，高度洁白、极度对称、干净到不安的空间美术；弧形白色墙板、无缝发光天花、抛光浅灰地面、内嵌式座椅、圆角舱门、细窄蓝白状态灯、透明扶手、隐藏式通风缝、整齐排列的休眠舱入口；材质以白色复合材料、磨砂玻璃、冷金属边框和微弱反光为主，几乎没有杂物，只有一只倾倒的透明水杯和未归位的安全带制造异常；冷白均匀顶光，低饱和蓝灰阴影，空气清澈但情绪孤立，强调高级科幻、洁净秩序和失踪后的空洞感；无人物、无可读文字、无 Logo。',
  ]
}

function enProductionTextureExample(): string[] {
  return [
    'Example for emphasis only; do not copy its subject matter.',
    'Example input: A near-future astronaut wakes during a long voyage and finds the spacecraft common cabin empty, while the welcome announcement keeps playing.',
    'Example final prompt: Empty reusable scene asset image, near-future spacecraft common cabin, centered full-scene composition, intensely white, highly symmetrical, unsettlingly clean production design; curved white wall panels, seamless glowing ceiling, polished pale-gray floor, built-in seats, rounded cabin doors, thin blue-white status lights, transparent handrails, hidden ventilation slits, evenly spaced hibernation-pod entrances; materials are white composite panels, frosted glass, cold metal trim, and subtle reflections, almost no clutter except one overturned transparent cup and one unfastened safety belt creating the anomaly; even cold white overhead light, desaturated blue-gray shadows, clear air but isolated mood, emphasizing premium science fiction, sterile order, and the hollow feeling after disappearance; no people, no readable text, no logo.',
  ]
}

function zhBlockingWideExample(): string[] {
  return [
    '示例只用于学习侧重点，不要复制示例题材。',
    '示例输入：两个多年不见的兄弟在废弃码头摊牌，远处警笛声越来越近，弟弟准备从仓库侧门逃走。',
    '示例最终 prompt：21:9 空场景资产图，居中全景构图，废弃码头仓库外侧与装卸平台连成一个可调度空间；左前景是锈蚀栏杆和低矮货箱，可作为近景遮挡；中央中景保留大面积无遮挡湿地面，能容纳两人对峙站位；右侧是半开的仓库侧门和暗红安全灯，形成逃离出口；背景有远处集装箱、码头吊臂、港口雾气和冷蓝警灯反射；画面明确前景/中景/背景、入口/出口、反打方向和肩后空间，4-6 个稳定锚点分别为栏杆、货箱、侧门、安全灯、吊臂、积水反光；物件不堆满，不阻挡角色落位；无人物、无文字、无剧情动作。',
  ]
}

function enBlockingWideExample(): string[] {
  return [
    'Example for emphasis only; do not copy its subject matter.',
    'Example input: Two brothers who have not met for years confront each other at an abandoned pier, police sirens getting closer while the younger brother prepares to escape through a warehouse side door.',
    'Example final prompt: 21:9 empty reusable scene asset image, centered full-scene composition, abandoned pier warehouse exterior connected to a loading platform as one blocking-ready space; left foreground has rusted railings and low cargo crates for foreground occlusion; central midground keeps a broad unobstructed wet floor for two-person confrontation blocking; right side has a half-open warehouse side door with dim red safety light as the escape exit; background includes distant containers, dock crane, harbor mist, and cold-blue police-light reflections; clear foreground/midground/background, entrance/exit, reverse-shot direction, and shoulder-space; 4-6 stable anchors are railing, crates, side door, safety light, crane, wet reflections; objects do not clutter or block character placement; no people, no readable text, no story action.',
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
      ...enStoryCoreExample(),
      outputRule(input.locale),
    ])
    : joinLines([
      '你是电影美术指导和故事导向的选景设计师。请把用户输入转换成一条最终图片生成提示词。',
      ...zhSharedContext(input.sceneInput),
      '策略：选择最能承载故事冲突、揭示、反转或反复戏剧压力的单一地点。最终 prompt 要通过造景本身体现这个选择，不要写解释文字。',
      '使用电影场面调度和造景思维：建筑结构、负空间、物件摆放、灯光动机、色彩对比、材质新旧和空气氛围都要暗示故事张力。',
      ...zhStoryCoreExample(),
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
      'The final prompt must be more detailed than the baseline: name the key objects, layout, decoration, surface materials, traces of use, lighting fixtures, and finish quality. The result should feel art-directed and story-specific, not a generic location description.',
      ...enProductionTextureExample(),
      outputRule(input.locale),
    ])
    : joinLines([
      '你是擅长质感、氛围和美术造景的资深电影美术指导。请把用户输入转换成一条最终图片生成提示词。',
      ...zhSharedContext(input.sceneInput),
      '策略：优先追求氛围和美术质感。根据输入推断类型、年代、阶层质感、情绪温度和视觉潜台词，再转译成具体陈设、表面材质、使用痕迹、实景光源、色彩、雾气/反光和阴影设计。',
      '最终 prompt 必须比基准更细：明确写出关键物品、空间布局、装修形态、表面材质、使用痕迹、灯具来源和完成度质感，像经过电影美术设计的专属场景，而不是泛泛的地点描述。',
      ...zhProductionTextureExample(),
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
      ...enBlockingWideExample(),
      outputRule(input.locale),
    ])
    : joinLines([
      '你是为分镜调度搭建可复用场景资产的摄影指导和电影美术指导。请把用户输入转换成一条最终图片生成提示词。',
      ...zhSharedContext(input.sceneInput),
      '策略：设计一张 21:9 宽幅空场景，便于后续人物落位、入场、离场、对峙角度、肩后空间、反打镜头和重新构图；同时必须保持有故事内涵和美术质感。',
      '最终 prompt 必须包含清晰前景/中景/背景、4-6 个可复用锚点、有动机的灯光、可读的空置站位区，并避免物件堆满导致角色无法进入。',
      ...zhBlockingWideExample(),
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
