import type { Locale } from '@/i18n/routing'

export const SCENE_REFERENCE_TEST_PROJECT_ID = 'system'
export const SCENE_REFERENCE_TEST_ASPECT_RATIO = '16:9'
export const SCENE_REFERENCE_TEST_TARGET_ID = 'scene-reference-test'
export const SCENE_REFERENCE_COMPARISON_TARGET_ID = 'scene-reference-comparison-test'
export const STANDARD_SCENE_REFERENCE_LAYOUT = 'three_view'

export type SceneReferenceLayout = typeof STANDARD_SCENE_REFERENCE_LAYOUT

export type SceneReferenceVariant = {
  readonly id: SceneReferenceLayout
  readonly label: string
  readonly prompt: string
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function styleLine(styleRequest: string, locale: Locale): string {
  if (styleRequest.trim()) {
    return locale === 'en'
      ? `Style request: ${normalize(styleRequest)}`
      : `风格要求：${normalize(styleRequest)}`
  }
  return locale === 'en'
    ? 'Derive a clear cinematic scene style from the scene description. Do not use a plain asset-library white or gray background.'
    : '从场景描述中推导明确的电影化场景风格，不要使用资产库式白底或灰底。'
}

export function buildSingleSceneReferencePrompt(input: {
  readonly sceneDescription: string
  readonly styleRequest: string
  readonly locale: Locale
}): string {
  const scene = normalize(input.sceneDescription)
  return input.locale === 'en'
    ? [
      'Generate one single-view empty scene reference image for later storyboard A/B testing.',
      `Scene description: ${scene}`,
      styleLine(input.styleRequest, input.locale),
      'Show one complete cinematic environment view with clear foreground, midground, background, spatial boundaries, anchor objects, lighting direction, materials, and atmosphere.',
      'Do not include characters. Do not add labels, numbers, arrows, UI marks, blueprint lines, watermarks, or logo.',
    ].join('\n')
    : [
      '生成一张用于后续分镜 A/B 测试的单视图空场景参考图。',
      `场景描述：${scene}`,
      styleLine(input.styleRequest, input.locale),
      '画面必须是一张完整的电影化环境视角，清楚展示前景、中景、背景、空间边界、关键锚点、光线方向、材质和空气感。',
      '不要出现人物。不要添加文字标签、编号、箭头、UI 标记、蓝图线、水印或 Logo。',
    ].join('\n')
}

function layoutSpec(layout: SceneReferenceLayout, locale: Locale): { label: string; spec: string } {
  const zh: Record<SceneReferenceLayout, { label: string; spec: string }> = {
    three_view: {
      label: '标准三视图场景板',
      spec: '必须清楚分成 3 个区域：正面视图、反面视图、顶面视图。正面视图展示主空间和风格；反面视图从对侧看回同一空间，用于反打镜头；顶面视图是美术化俯视图，用于展示空间边界、入口出口、主要锚点和可站立区域，不要画成工程蓝图。',
    },
  }
  const en: Record<SceneReferenceLayout, { label: string; spec: string }> = {
    three_view: {
      label: 'Standard three-view scene board',
      spec: 'It must be clearly divided into 3 regions: front view, reverse/back view, and top-down view. The front view shows the main space and style; the reverse view looks back at the same space from the opposite side for shot/reverse-shot continuity; the top-down view is an art-directed overhead view showing spatial boundaries, entrances, exits, major anchors, and usable standing areas, not an engineering blueprint.',
    },
  }
  return locale === 'en' ? en[layout] : zh[layout]
}

export function buildMultiSceneReferencePrompt(input: {
  readonly sceneDescription: string
  readonly styleRequest: string
  readonly layout: SceneReferenceLayout
  readonly locale: Locale
}): SceneReferenceVariant {
  const scene = normalize(input.sceneDescription)
  const { label, spec } = layoutSpec(input.layout, input.locale)
  const prompt = input.locale === 'en'
    ? [
      'Generate one multi-angle empty scene reference board for later storyboard A/B testing.',
      `Scene description: ${scene}`,
      styleLine(input.styleRequest, input.locale),
      `Layout: ${label}. ${spec}`,
      'The output must be one complete image containing exactly these three visibly different view regions. This must not be a single full-frame scene view repeated or cropped.',
      'Use clean visual gutters or panel boundaries if needed, but do not include text labels, numbers, arrows, UI marks, blueprint graphics, watermarks, or logo.',
      'Do not include characters. Make fixed anchors, lighting direction, materials, usable floor areas, entrances, exits, and depth relationships easy to inherit in later storyboard images.',
    ].join('\n')
    : [
      '生成一张用于后续分镜 A/B 测试的多角度空场景参考板。',
      `场景描述：${scene}`,
      styleLine(input.styleRequest, input.locale),
      `版式：${label}。${spec}`,
      '输出必须是单张完整图片，并且必须能一眼看出这三个不同视角区域。禁止生成单个全画幅场景视角，也禁止把同一视角简单重复或裁切。',
      '必要时可以使用干净的视觉分隔线或分区边界，但不要出现文字标签、编号、箭头、UI 标记、蓝图图形、水印或 Logo。',
      '不要出现人物。必须让固定锚点、光线方向、材质、可站立地面、入口出口和空间纵深关系便于后续分镜继承。',
    ].join('\n')
  return { id: input.layout, label, prompt }
}

export function buildSceneComparisonPrompt(input: {
  readonly storyboardPrompt: string
  readonly aspectRatio: string
  readonly locale: Locale
}): string {
  const prompt = normalize(input.storyboardPrompt)
  return input.locale === 'en'
    ? [
      'Generate one cinematic storyboard image. Use the exact same generation instructions for A/B testing.',
      `Storyboard prompt: ${prompt}`,
      `Aspect ratio: ${input.aspectRatio}`,
      'Reference image 1 is the character asset: use it only for character identity, face, body proportions, costume, and accessories.',
      'Reference image 2 is the scene asset: use it only for scene layout, anchors, lighting, materials, palette, and spatial atmosphere.',
      'Do not copy a reference board layout, do not split the output, and do not make a collage. Output one coherent storyboard frame.',
      'No subtitles, text labels, numbers, arrows, watermark, or logo.',
    ].join('\n')
    : [
      '生成一张电影化分镜图。为了 A/B 测试，必须使用完全相同的生成指令。',
      `分镜提示词：${prompt}`,
      `画幅：${input.aspectRatio}`,
      '参考图 1 是人物资产：只用于人物身份、脸部、体型比例、服装和配饰。',
      '参考图 2 是场景资产：只用于场景空间、固定锚点、灯光、材质、色彩和环境氛围。',
      '不要复制参考板版式，不要分屏，不要拼贴。只输出一张连贯的分镜画面。',
      '不要出现字幕、文字标签、编号、箭头、水印或 Logo。',
    ].join('\n')
}
