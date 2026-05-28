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
      zh: '裁掉 video_prompt 和大段 photography_rules，只保留图片生成需要的主要分镜、blocking、空间和参考信息。',
      en: 'Removes video_prompt and large photography_rules blocks, keeping only core image, blocking, spatial, and reference data.',
    },
  },
  {
    id: 'short_structured',
    title: {
      zh: '短规则版本',
      en: 'Short Rules Version',
    },
    description: {
      zh: '进一步裁剪 JSON，只保留最终图片提示词、镜头定位、场景空间档案和角色外观。',
      en: 'Further trims JSON to final image prompt, shot blocking, spatial profile, and character appearance.',
    },
  },
  {
    id: 'json_direct',
    title: {
      zh: 'JSON 直给版本',
      en: 'JSON Direct Version',
    },
    description: {
      zh: '极短 JSON，只保留最终图片提示词和本镜头定位数据。',
      en: 'Very short JSON with only the final image prompt and this shot blocking data.',
    },
  },
  {
    id: 'json_minimal',
    title: {
      zh: '最短 JSON 版本',
      en: 'Minimal JSON Version',
    },
    description: {
      zh: '只发送 panel.image_prompt，也就是图片模型实际最需要执行的最终提示词。',
      en: 'Sends only panel.image_prompt, the final prompt the image model most directly needs.',
    },
  },
]

function compactLines(lines: ReadonlyArray<string | null | undefined>): string {
  return lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStoryboardJson(value: string): JsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`PROMPT_SUFFIX_TEST_STORYBOARD_JSON_INVALID:${message}`)
  }
  if (!isJsonObject(parsed)) throw new Error('PROMPT_SUFFIX_TEST_STORYBOARD_JSON_OBJECT_REQUIRED')
  return parsed
}

function readObject(source: JsonObject, key: string): JsonObject | null {
  const value = source[key]
  return isJsonObject(value) ? value : null
}

function readString(source: JsonObject, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readArray(source: JsonObject, key: string): readonly unknown[] | null {
  const value = source[key]
  return Array.isArray(value) ? value : null
}

function copyString(target: JsonObject, source: JsonObject, key: string): void {
  const value = readString(source, key)
  if (value) target[key] = value
}

function copyArray(target: JsonObject, source: JsonObject, key: string): void {
  const value = readArray(source, key)
  if (value) target[key] = value
}

function copyObject(target: JsonObject, source: JsonObject, key: string): void {
  const value = readObject(source, key)
  if (value) target[key] = value
}

function readPanel(parsed: JsonObject): JsonObject {
  const panel = readObject(parsed, 'panel')
  if (!panel) throw new Error('PROMPT_SUFFIX_TEST_PANEL_REQUIRED')
  return panel
}

function readContext(parsed: JsonObject): JsonObject | null {
  return readObject(parsed, 'context')
}

function readFinalImagePrompt(parsed: JsonObject): string {
  const imagePrompt = readString(readPanel(parsed), 'image_prompt')
  if (!imagePrompt) throw new Error('PROMPT_SUFFIX_TEST_IMAGE_PROMPT_REQUIRED')
  return imagePrompt
}

function stringifyPromptJson(value: JsonObject): string {
  return JSON.stringify(value, null, 2)
}

function buildMediumStoryboardJson(rawJson: string): string {
  const parsed = parseStoryboardJson(rawJson)
  const panel = readPanel(parsed)
  const context = readContext(parsed)
  const reducedPanel: JsonObject = {}
  copyString(reducedPanel, panel, 'panel_id')
  copyString(reducedPanel, panel, 'shot_type')
  copyString(reducedPanel, panel, 'camera_move')
  copyString(reducedPanel, panel, 'description')
  copyString(reducedPanel, panel, 'image_prompt')
  copyString(reducedPanel, panel, 'location')
  copyArray(reducedPanel, panel, 'characters')
  copyString(reducedPanel, panel, 'source_text')
  copyObject(reducedPanel, panel, 'shot_blocking')

  const reduced: JsonObject = { panel: reducedPanel }
  if (context) {
    const reducedContext: JsonObject = {}
    copyArray(reducedContext, context, 'character_appearances')
    copyObject(reducedContext, context, 'location_reference')
    copyArray(reducedContext, context, 'reference_images')
    reduced.context = reducedContext
  }
  return stringifyPromptJson(reduced)
}

function buildShortStoryboardJson(rawJson: string): string {
  const parsed = parseStoryboardJson(rawJson)
  const panel = readPanel(parsed)
  const context = readContext(parsed)
  const reducedPanel: JsonObject = {}
  copyString(reducedPanel, panel, 'image_prompt')
  copyObject(reducedPanel, panel, 'shot_blocking')

  const reduced: JsonObject = { panel: reducedPanel }
  if (context) {
    const reducedContext: JsonObject = {}
    copyArray(reducedContext, context, 'character_appearances')
    const locationReference = readObject(context, 'location_reference')
    if (locationReference) {
      const reducedLocation: JsonObject = {}
      copyString(reducedLocation, locationReference, 'name')
      copyObject(reducedLocation, locationReference, 'spatial_profile')
      reducedContext.location_reference = reducedLocation
    }
    reduced.context = reducedContext
  }
  return stringifyPromptJson(reduced)
}

function buildDirectStoryboardJson(rawJson: string): string {
  const parsed = parseStoryboardJson(rawJson)
  const panel = readPanel(parsed)
  const reducedPanel: JsonObject = {
    image_prompt: readFinalImagePrompt(parsed),
  }
  copyObject(reducedPanel, panel, 'shot_blocking')
  return stringifyPromptJson({ panel: reducedPanel })
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
      'Use this reduced JSON as the binding instruction. Prioritize image_prompt and shot_blocking. Use spatial_profile only as factual scene-space evidence.',
      `Reduced storyboard JSON:\n${buildMediumStoryboardJson(input.storyboardJson)}`,
      `Source text priority:\n${input.sourceText}`,
      `Style:\n${input.styleText}`,
      input.styleBibleText,
    ])
  }
  return compactLines([
    `生成一张电影分镜图，画幅 ${input.aspectRatio}。禁止文字、字幕、标签、编号、水印、logo、拼图和多格图。`,
    '以下是裁剪后的约束性 JSON。优先执行 image_prompt 和 shot_blocking；spatial_profile 只作为场景空间事实依据。',
    `裁剪分镜 JSON：\n${buildMediumStoryboardJson(input.storyboardJson)}`,
    `镜头原文优先：\n${input.sourceText}`,
    `风格：\n${input.styleText}`,
    input.styleBibleText,
  ])
}

function renderShortStructured(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      `One storyboard image only, ${input.aspectRatio}. No text/subtitles/numbers/watermark/logo.`,
      'Follow this trimmed JSON. Execute image_prompt and shot_blocking first. Use spatial_profile for scene space only. Do not add new people, props, buildings, weather, costumes, or plot.',
      buildShortStoryboardJson(input.storyboardJson),
      `Source: ${input.sourceText}`,
      `Style: ${input.styleText}`,
      input.styleBibleText,
    ])
  }
  return compactLines([
    `只生成一张分镜图，${input.aspectRatio}。禁止文字、字幕、编号、水印、logo。`,
    '严格按裁剪 JSON 执行。优先执行 image_prompt 和 shot_blocking；spatial_profile 只用于场景空间；风格只改变画面表现，不能新增人物、道具、建筑、天气、服装或剧情。',
    buildShortStoryboardJson(input.storyboardJson),
    `原文：${input.sourceText}`,
    `风格：${input.styleText}`,
    input.styleBibleText,
  ])
}

function renderJsonDirect(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      `Create exactly one image at ${input.aspectRatio}. Obey this minimal JSON only.`,
      buildDirectStoryboardJson(input.storyboardJson),
      'No text, subtitles, numbers, watermark, logo, collage, or multi-frame output.',
    ])
  }
  return compactLines([
    `按 ${input.aspectRatio} 生成单张图片。只执行下面这个极简 JSON。`,
    buildDirectStoryboardJson(input.storyboardJson),
    '禁止文字、字幕、编号、水印、logo、拼图、多格图。',
  ])
}

function renderJsonMinimal(input: PromptLengthInput, locale: Locale): string {
  if (locale === 'en') {
    return compactLines([
      readFinalImagePrompt(parseStoryboardJson(input.storyboardJson)),
    ])
  }
  return compactLines([
    readFinalImagePrompt(parseStoryboardJson(input.storyboardJson)),
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
