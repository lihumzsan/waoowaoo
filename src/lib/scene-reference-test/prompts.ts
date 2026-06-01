import type { Locale } from '@/i18n/routing'

export const SCENE_REFERENCE_TEST_PROJECT_ID = 'system'
export const SCENE_REFERENCE_TEST_ASPECT_RATIO = '16:9'
export const SCENE_REFERENCE_TEST_TARGET_ID = 'scene-reference-test'
export const SCENE_REFERENCE_COMPARISON_TARGET_ID = 'scene-reference-comparison-test'

export const SCENE_REFERENCE_LAYOUTS = [
  'three_view',
  'four_view_board',
  'wide_reverse_side_detail',
  'overhead_spatial_board',
] as const

export type SceneReferenceLayout = (typeof SCENE_REFERENCE_LAYOUTS)[number]

export type SceneReferenceVariant = {
  readonly id: SceneReferenceLayout
  readonly label: string
  readonly prompt: string
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeSceneReferenceLayouts(value: unknown): SceneReferenceLayout[] {
  if (!Array.isArray(value)) return [...SCENE_REFERENCE_LAYOUTS]
  const selected = value.filter((item): item is SceneReferenceLayout =>
    typeof item === 'string' && SCENE_REFERENCE_LAYOUTS.includes(item as SceneReferenceLayout),
  )
  return selected.length > 0 ? Array.from(new Set(selected)) : [...SCENE_REFERENCE_LAYOUTS]
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
      label: '三视图场景板',
      spec: '必须清楚分成 3 个并列视角区域：主视角、反向视角、侧向视角。三个区域共享同一空间、同一光源逻辑和同一材质系统。',
    },
    four_view_board: {
      label: '四宫格场景板',
      spec: '必须清楚分成 2x2 四个区域：主全景、反向视角、侧向视角、关键锚点/材质细节。四个区域必须像同一个场景的参考板。',
    },
    wide_reverse_side_detail: {
      label: '宽幅主视角+反侧细节',
      spec: '必须清楚分成 4 个区域：主视角占画面约一半，其余区域分别展示反向视角、侧向通道、材质/光源细节，适合测试分镜空间继承。',
    },
    overhead_spatial_board: {
      label: '空间关系场景板',
      spec: '必须清楚分成 4 个区域：电影主视角、自然俯视空间关系、入口/出口方向、关键锚点细节。俯视区域必须自然美术化，不要画成蓝图或标注图。',
    },
  }
  const en: Record<SceneReferenceLayout, { label: string; spec: string }> = {
    three_view: {
      label: 'Three-view scene board',
      spec: 'It must be clearly divided into 3 side-by-side view regions: main view, reverse view, and side view. The three areas share the same space, lighting logic, and material system.',
    },
    four_view_board: {
      label: 'Four-panel scene board',
      spec: 'It must be clearly divided into a 2x2 board: main wide view, reverse view, side view, and key anchor/material detail. The four areas must read as one scene reference board.',
    },
    wide_reverse_side_detail: {
      label: 'Wide main view with reverse/side details',
      spec: 'It must be clearly divided into 4 regions: the main view takes about half of the image; the remaining areas show reverse view, side passage, and material/light-source details for spatial continuity testing.',
    },
    overhead_spatial_board: {
      label: 'Spatial relationship scene board',
      spec: 'It must be clearly divided into 4 regions: cinematic main view, natural overhead spatial relationship view, entrance/exit direction, and key anchor detail. The overhead area must be art-directed, not a blueprint or labeled diagram.',
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
      'The output must be one complete image containing visibly different view regions. This must not be a single full-frame scene view repeated or cropped.',
      'Use clean visual gutters or panel boundaries if needed, but do not include text labels, numbers, arrows, UI marks, blueprint graphics, watermarks, or logo.',
      'Do not include characters. Make fixed anchors, lighting direction, materials, usable floor areas, entrances, exits, and depth relationships easy to inherit in later storyboard images.',
    ].join('\n')
    : [
      '生成一张用于后续分镜 A/B 测试的多角度空场景参考板。',
      `场景描述：${scene}`,
      styleLine(input.styleRequest, input.locale),
      `版式：${label}。${spec}`,
      '输出必须是单张完整图片，并且必须能一眼看出多个不同视角区域。禁止生成单个全画幅场景视角，也禁止把同一视角简单重复或裁切。',
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
