import type { Locale } from '@/i18n/routing'

export {
  DEFAULT_PROMPT_LENGTH_TEST_SOURCE_TEXT,
  DEFAULT_PROMPT_LENGTH_TEST_STORYBOARD_JSON,
  DEFAULT_PROMPT_LENGTH_TEST_STYLE_BIBLE_TEXT,
  DEFAULT_PROMPT_LENGTH_TEST_STYLE_TEXT,
} from './defaults'

export type PromptSuffixVariantId =
  | 'current_full'
  | 'medium_structured'
  | 'short_structured'
  | 'json_direct'
  | 'json_minimal'

export interface PromptLengthVariant {
  readonly id: PromptSuffixVariantId
  readonly title: Record<Locale, string>
  readonly description: Record<Locale, string>
}

export interface PromptLengthInput {
  readonly aspectRatio: string
  readonly storyboardJson: string
  readonly sourceText: string
  readonly styleText: string
  readonly styleBibleText: string
}

export const PROMPT_SUFFIX_TEST_VARIANTS: readonly PromptLengthVariant[] = [
  {
    id: 'current_full',
    title: {
      zh: '当前完整版本',
      en: 'Current Full Version',
    },
    description: {
      zh: '接近当前分镜生图发送格式，规则最完整，文本最长。',
      en: 'Close to the current storyboard image prompt format. Most complete and longest.',
    },
  },
  {
    id: 'medium_structured',
    title: {
      zh: '中等压缩版本',
      en: 'Medium Structured Version',
    },
    description: {
      zh: '保留完整 JSON 和关键优先级，合并参考图、摄影和风格规则。',
      en: 'Keeps full JSON and key priorities, while merging reference, camera, and style rules.',
    },
  },
  {
    id: 'short_structured',
    title: {
      zh: '短规则版本',
      en: 'Short Rules Version',
    },
    description: {
      zh: '完整 JSON 不变，只保留单张图、无文字、blocking、空间档案、风格四类规则。',
      en: 'Keeps the full JSON, with only single-frame, no-text, blocking, spatial-profile, and style rules.',
    },
  },
  {
    id: 'json_direct',
    title: {
      zh: 'JSON 直给版本',
      en: 'JSON Direct Version',
    },
    description: {
      zh: '把 JSON 作为主要指令，只在前后加极短执行规则。',
      en: 'Uses JSON as the main instruction, with very short execution rules before and after it.',
    },
  },
  {
    id: 'json_minimal',
    title: {
      zh: '最短 JSON 版本',
      en: 'Minimal JSON Version',
    },
    description: {
      zh: '只发送任务、画幅、完整 JSON 和必要禁用项，用作极限对照。',
      en: 'Only sends task, aspect ratio, full JSON, and required bans as an extreme control.',
    },
  },
]

function compactLines(lines: ReadonlyArray<string | null | undefined>): string {
  return lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function renderCurrentFull(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      'You are a professional storyboard image artist. Generate exactly one high-quality image for one panel.',
      'Absolute constraints: no text, no subtitles, no labels, no numbers, no watermark, no logo, no collage, no multi-frame output.',
      `Aspect ratio: ${input.aspectRatio}.`,
      'Reference image rules: character references lock identity, face, hairstyle, outfit, and body type; location references guide spatial layout, anchors, entrances/exits, and object relations; do not copy old composition or style; repaint the background for the current shot angle and scale.',
      'If panel.shot_blocking exists, follow character positions, relative relations, eyelines, camera placement, and composition first. If context.location_reference.spatial_profile exists, treat it as factual scene-space evidence.',
      'Photography rules: obey text blocking, character placement, relative positions, screen positions, camera placement, composition, depth of field, and color tone in photography_rules.',
      'Storyboard content: design the frame from the panel data, keep screen direction consistent, avoid axis jumps, and keep characters in correct positions. Unless explicitly requested, characters must not stare directly at the camera.',
      'Source priority: when storyboard data conflicts with source text, follow source text for spatial relations, character positions, and action order.',
      `Storyboard panel data:\n${input.storyboardJson}`,
      `Source text:\n${input.sourceText}`,
      `Style requirement:\nImage style: ${input.styleText}\nFollow the current project visual style. Character references are for identity and primary appearance. Location references are for spatial layout and anchors. Do not import old reference-image style.`,
      input.styleBibleText,
    ])
  }
  return compactLines([
    '你是一位专业的分镜画师。请根据以下分镜数据生成单张高质量的镜头图片。',
    '【绝对禁止 - 图像中不得出现任何文字 - 最高优先级】\n生成的图像中绝对禁止出现任何文字：禁止镜头类型标签、镜头运动文字、数字、画面编号、中文或英文文字、水印、注释或符号。每个图片只能有一张镜头，禁止拼图，禁止多张图。',
    `【画面比例】\n本次生成的画面比例为：${input.aspectRatio}`,
    '【参考图使用规则】\n角色参考图用于锁定角色身份、脸型、发型、服装、体型；场景参考图用于参考空间布局、关键锚点、入口出口、家具/物体相对位置。不要直接照搬参考图构图或旧画风。不要把图号、资产名、编号画进画面。背景必须根据当前镜头角度和景别重新绘制。',
    '如果分镜数据包含 panel.shot_blocking，必须优先执行其中的人物位置、相对关系、视线、机位和构图。如果场景数据包含 context.location_reference.spatial_profile，必须作为场景空间事实依据。',
    '【摄影规则】\n如果分镜数据中包含 photography_rules，必须严格遵守文字 blocking、人物站位、相对位置、画面位置、机位、构图、景深和色调。',
    '【分镜内容要求】\n根据分镜数据设计画面，确保镜头方向一致，不跳轴，角色位置正确。除非明确要求，角色不要直视镜头。',
    '【原文优先原则】\n当分镜与原文冲突时，按原文的空间关系、角色位置、动作顺序。',
    `【分镜数据】\n${input.storyboardJson}`,
    `【镜头原文】\n${input.sourceText}`,
    `【风格要求】\n画面风格：${input.styleText}\n- 必须严格遵循项目当前视觉风格\n- 角色参考图只用于身份和主要外观一致\n- 场景参考图只用于空间布局和关键锚点一致\n- 禁止把参考图中的旧画风带入最终画面`,
    input.styleBibleText,
  ])
}

function renderMediumStructured(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      `Generate one cinematic storyboard image, aspect ratio ${input.aspectRatio}. No text, subtitles, labels, numbers, watermark, logo, collage, or multi-frame output.`,
      'Use the JSON as the binding instruction. Prioritize panel.shot_blocking for character placement, relative position, eyeline, camera placement, and composition. Use context.location_reference.spatial_profile as factual spatial evidence. Use reference images only for identity, appearance, layout, anchors, and object form.',
      `Storyboard JSON:\n${input.storyboardJson}`,
      `Source text priority:\n${input.sourceText}`,
      `Style:\n${input.styleText}`,
      input.styleBibleText,
    ])
  }
  return compactLines([
    `生成一张电影分镜图，画幅 ${input.aspectRatio}。禁止文字、字幕、标签、编号、水印、logo、拼图和多格图。`,
    '以下 JSON 是约束性指令。优先执行 panel.shot_blocking 中的人物位置、相对关系、视线、机位和构图；context.location_reference.spatial_profile 是场景空间事实依据。参考图只用于身份、外观、空间布局、锚点和物体形态。',
    `分镜 JSON：\n${input.storyboardJson}`,
    `镜头原文优先：\n${input.sourceText}`,
    `风格：\n${input.styleText}`,
    input.styleBibleText,
  ])
}

function renderShortStructured(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      `One storyboard image only, ${input.aspectRatio}. No text/subtitles/numbers/watermark/logo.`,
      'Follow the full JSON. Execute shot_blocking first. Use spatial_profile anchors/depth/lighting for scene space. Keep source text action order. Apply style without adding new people, props, buildings, weather, costumes, or plot.',
      input.storyboardJson,
      `Source: ${input.sourceText}`,
      `Style: ${input.styleText}`,
      input.styleBibleText,
    ])
  }
  return compactLines([
    `只生成一张分镜图，${input.aspectRatio}。禁止文字、字幕、编号、水印、logo。`,
    '严格按完整 JSON 执行。优先执行 shot_blocking；用 spatial_profile 的锚点、纵深、光线控制场景空间；动作顺序以原文为准；风格只改变画面表现，不能新增人物、道具、建筑、天气、服装或剧情。',
    input.storyboardJson,
    `原文：${input.sourceText}`,
    `风格：${input.styleText}`,
    input.styleBibleText,
  ])
}

function renderJsonDirect(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      `Create exactly one image at ${input.aspectRatio}. The JSON below is the full storyboard instruction; obey shot_blocking, photography_rules, spatial_profile, references, source text, and style inside it.`,
      input.storyboardJson,
      `No text, subtitles, numbers, watermark, logo, collage, or multi-frame output. Style: ${input.styleText}. Source: ${input.sourceText}.`,
      input.styleBibleText,
    ])
  }
  return compactLines([
    `按 ${input.aspectRatio} 生成单张图片。下面 JSON 是完整分镜指令；必须执行其中的 shot_blocking、photography_rules、spatial_profile、参考图、原文和风格。`,
    input.storyboardJson,
    `禁止文字、字幕、编号、水印、logo、拼图、多格图。风格：${input.styleText}。原文：${input.sourceText}。`,
    input.styleBibleText,
  ])
}

function renderJsonMinimal(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      `One ${input.aspectRatio} storyboard image. Obey this JSON completely.`,
      input.storyboardJson,
      `No text/subtitles/numbers/watermark/logo. Style: ${input.styleText}. Source: ${input.sourceText}.`,
    ])
  }
  return compactLines([
    `生成一张 ${input.aspectRatio} 分镜图，完整遵守以下 JSON。`,
    input.storyboardJson,
    `禁止文字、字幕、编号、水印、logo。风格：${input.styleText}。原文：${input.sourceText}。`,
  ])
}

export function getPromptSuffixVariant(id: string): PromptLengthVariant | null {
  return PROMPT_SUFFIX_TEST_VARIANTS.find((variant) => variant.id === id) ?? null
}

export function buildPromptLengthTestPrompt(input: {
  readonly variantId: PromptSuffixVariantId
  readonly locale: Locale
  readonly promptInput: PromptLengthInput
}): string {
  const promptInput = {
    ...input.promptInput,
    aspectRatio: input.promptInput.aspectRatio.trim(),
    storyboardJson: input.promptInput.storyboardJson.trim(),
    sourceText: input.promptInput.sourceText.trim(),
    styleText: input.promptInput.styleText.trim(),
    styleBibleText: input.promptInput.styleBibleText.trim(),
  }
  if (!promptInput.storyboardJson) throw new Error('PROMPT_SUFFIX_TEST_STORYBOARD_JSON_REQUIRED')
  if (input.variantId === 'current_full') return renderCurrentFull(promptInput, input.locale)
  if (input.variantId === 'medium_structured') return renderMediumStructured(promptInput, input.locale)
  if (input.variantId === 'short_structured') return renderShortStructured(promptInput, input.locale)
  if (input.variantId === 'json_direct') return renderJsonDirect(promptInput, input.locale)
  if (input.variantId === 'json_minimal') return renderJsonMinimal(promptInput, input.locale)
  throw new Error(`PROMPT_SUFFIX_TEST_VARIANT_UNKNOWN:${input.variantId}`)
}
