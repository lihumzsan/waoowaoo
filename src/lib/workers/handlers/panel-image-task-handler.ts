import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getArtStylePrompt } from '@/lib/constants'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { getUserModels as getEnabledUserModels } from '@/lib/api-config'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCosWithMetadata,
} from '../utils'
import { normalizeReferenceImagesForGeneration, normalizeToOriginalMediaUrl } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey, resolveMediaRef } from '@/lib/media/service'
import {
  AnyObj,
  clampCount,
  collectPanelReferenceImages,
  findCharacterByNameLoose,
  parseImageUrls,
  parsePanelCharacterReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  parseLocationAvailableSlots,
} from '@/lib/location-available-slots'
import { COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID } from '@/lib/providers/comfyui/workflow-registry'
import { buildPanelContinuityPacket } from '@/lib/novel-promotion/panel-continuity'
import {
  auditGeneratedPanelImage,
  type PanelImageAuditResult,
  type PanelImageGenerationPacket,
} from '@/lib/novel-promotion/panel-image-audit'

const MULTI_CHARACTER_COORDINATION_THRESHOLD = 3
const ENABLE_COORDINATED_MULTI_CHARACTER_GENERATION = process.env.ENABLE_COORDINATED_MULTI_CHARACTER_GENERATION === '1'
const COMFYUI_QWEN_STORYBOARD_MODEL = 'comfyui::baseimage/图片分镜/Qwen剧情分镜制作'
const COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL = `comfyui::${COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID}`
const COMFYUI_QWEN_SINGLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen单图编辑'
const COMFYUI_QWEN_DOUBLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen双图编辑'
const COMFYUI_QWEN_TRIPLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen三图编辑'
const COMFYUI_FLUX_MULTI_EDIT_MODEL = 'comfyui::baseimage/图片编辑/Flux2多图编辑'

type QwenStoryboardIdentityEditPlan = {
  sceneRef: string | null
  sceneContinuityRef: string | null
  sceneContinuityPanelId: string | null
  sceneContinuityPanelIndex: number | null
  characterRefs: string[]
  requiredSlots: number
  reason: string
}

type DefinitionAwareQwenStoryboardPlan = {
  modelKey: string
  referenceImages: string[] | null
  reason: string | null
  identityEdit: QwenStoryboardIdentityEditPlan | null
}

function buildProjectStyleAuthorityPrompt(styleText: string): string {
  const normalized = styleText.trim()
  if (!normalized) return ''

  return [
    `项目风格定义：${normalized}`,
    '风格优先级：必须以项目风格定义作为最终画面风格的最高依据。',
    '媒介与渲染方式也属于项目风格：线条、上色、材质、光影、镜头质感、画面完成度必须跟随项目风格定义。',
    '参考图只提供人物身份、服装、体型、场景布局和氛围线索；参考图不能覆盖项目风格的媒介、渲染方式或成片质感。',
    '当参考图质感与项目风格冲突时，以项目风格定义为准；如果项目风格要求某种质感，也只能从项目风格定义中继承。',
  ].join('\n')
}

function appendProjectStyleAuthorityPrompt(prompt: string, styleAuthorityPrompt: string): string {
  if (!styleAuthorityPrompt.trim()) return prompt
  return [prompt, '', styleAuthorityPrompt].join('\n')
}

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseDescriptionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizePanelTextForVisibleCharacters(params: {
  text: string | null | undefined
  visibleCharacters: ReturnType<typeof parsePanelCharacterReferences>
  projectCharacters: Array<{ name?: string | null }>
}): string {
  const original = typeof params.text === 'string' ? params.text.trim() : ''
  if (!original) return ''

  const visibleNames = new Set(params.visibleCharacters.map((item) => item.name.trim()).filter(Boolean))
  let next = original

  for (const character of params.projectCharacters) {
    const name = typeof character.name === 'string' ? character.name.trim() : ''
    if (!name || visibleNames.has(name)) continue
    next = next.replace(new RegExp(escapeRegExp(name), 'g'), '画外对象（不可见，不得绘制）')
  }

  if (visibleNames.size === 1) {
    next = next
      .replace(/前方对面(?:的)?/g, '镜头外')
      .replace(/对面(?:的)?(?:少年|少女|青年|男人|女人|医生|护士|病人|老人|孩子|小孩|人物|男子|女子)/g, '镜头外对象')

    const [onlyCharacter] = Array.from(visibleNames)
    if (next !== original && !next.includes('画面只显示')) {
      next = `${next}\n视觉约束：画面只显示${onlyCharacter}，其他人物均在镜头外，不得出现在画面中。`
    }
  }

  return next
}

function sanitizePromptContextForVisibleCharacters(
  promptContext: ReturnType<typeof buildPanelPromptContext>,
  sanitizeText: (value: string | null | undefined) => string,
): ReturnType<typeof buildPanelPromptContext> {
  promptContext.panel.description = sanitizeText(promptContext.panel.description)
  promptContext.panel.image_prompt = sanitizeText(promptContext.panel.image_prompt)
  promptContext.panel.video_prompt = sanitizeText(promptContext.panel.video_prompt)
  promptContext.panel.source_text = sanitizeText(promptContext.panel.source_text)
  promptContext.context.continuity.sourceText = sanitizeText(promptContext.context.continuity.sourceText)
  promptContext.context.continuity.currentAction = sanitizeText(promptContext.context.continuity.currentAction)
  promptContext.context.continuity.allowedActions = promptContext.context.continuity.allowedActions
    .map((value) => sanitizeText(value))
    .filter((value) => value.length > 0)
  return promptContext
}

function buildSingleCharacterReverseShotRule(visibleCharacterName: string | null | undefined): string {
  const subject = typeof visibleCharacterName === 'string' && visibleCharacterName.trim()
    ? visibleCharacterName.trim()
    : 'the mapped character'

  return [
    `Single-character reverse-shot rule: ${subject} is the only visible person. POV, subjective, reverse-shot, over-the-shoulder, eyeline, or facing an off-screen person describes camera direction only.`,
    'Do not include over-the-shoulder foreground shoulder, back of head, partial body, hand, white coat, reflection, silhouette, blurred human, or any foreground obstruction representing the off-screen person.',
    'Keep every unlisted dialogue partner fully outside the frame; the frame may show empty foreground/background space, furniture, windows, walls, or props, but no human fragment.',
  ].join('\n')
}

function pickAppearanceDescription(appearance: {
  descriptions?: string | null
  description?: string | null
  selectedIndex?: number | null
}): string {
  const descriptions = parseDescriptionList(appearance.descriptions || null)
  if (descriptions.length > 0) {
    const selectedIndex = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
    const selected = descriptions[selectedIndex] || descriptions[0]
    if (selected && selected.trim()) return selected.trim()
  }
  if (typeof appearance.description === 'string' && appearance.description.trim()) {
    return appearance.description.trim()
  }
  return '无描述'
}

function buildPanelPromptContext(params: {
  panel: {
    id: string
    shotType: string | null
    cameraMove: string | null
    description: string | null
    imagePrompt: string | null
    videoPrompt: string | null
    location: string | null
    characters: string | null
    srtSegment: string | null
    photographyRules: string | null
    actingNotes: string | null
  }
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
}) {
  const panelCharacters = parsePanelCharacterReferences(params.panel.characters)
  const characterContexts = panelCharacters.map((reference) => {
    const character = findCharacterByNameLoose(params.projectData.characters || [], reference.name)
    if (!character) {
      return {
        name: reference.name,
        appearance: reference.appearance || null,
        description: '无角色外貌数据',
      }
    }

    const appearances = character.appearances || []
    const matchedAppearance =
      (reference.appearance
        ? appearances.find((appearance) => (appearance.changeReason || '').toLowerCase() === reference.appearance!.toLowerCase())
        : null) || appearances[0] || null

    return {
      name: character.name,
      appearance: matchedAppearance?.changeReason || null,
      description: matchedAppearance ? pickAppearanceDescription(matchedAppearance) : '无角色外貌数据',
      slot: reference.slot || null,
    }
  })

  const locationContext = (() => {
    if (!params.panel.location) return null
    const matchedLocation = (params.projectData.locations || []).find(
      (item) => item.name.toLowerCase() === params.panel.location!.toLowerCase(),
    )
    if (!matchedLocation) return null
    const selectedImage = (matchedLocation.images || []).find((item) => item.isSelected) || matchedLocation.images?.[0]
    return {
      name: matchedLocation.name,
      description: selectedImage?.description || null,
      available_slots: parseLocationAvailableSlots(selectedImage?.availableSlots),
    }
  })()

  return {
    panel: {
      panel_id: params.panel.id,
      shot_type: params.panel.shotType || '',
      camera_move: params.panel.cameraMove || '',
      description: params.panel.description || '',
      image_prompt: params.panel.imagePrompt || '',
      video_prompt: params.panel.videoPrompt || '',
      location: params.panel.location || '',
      characters: panelCharacters,
      source_text: params.panel.srtSegment || params.panel.description || params.panel.imagePrompt || '',
      photography_rules: parseJsonUnknown(params.panel.photographyRules),
      acting_notes: parseJsonUnknown(params.panel.actingNotes),
    },
    context: {
      character_appearances: characterContexts,
      location_reference: locationContext,
      continuity: buildPanelContinuityPacket({ panel: params.panel }),
    },
  }
}

function buildPanelPrompt(params: {
  locale: TaskJobData['locale']
  aspectRatio: string
  styleText: string
  sourceText: string
  contextJson: string
}) {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    locale: params.locale,
    variables: {
      aspect_ratio: params.aspectRatio,
      storyboard_text_json_input: params.contextJson,
      source_text: params.sourceText || '无',
      style: params.styleText,
    },
  })
}

function buildPanelDefinitionAuthorityPrompt(prompt: string, panelCharacters: ReturnType<typeof parsePanelCharacterReferences>): string {
  const characterNames = panelCharacters.map((item) => item.name).filter(Boolean)
  const slotRules = panelCharacters
    .map((item, index) => {
      const slot = typeof item.slot === 'string' && item.slot.trim().length > 0 ? item.slot.trim() : null
      return slot ? `${item.name || `角色${index + 1}`} 当前空间位置/slot：${slot}` : null
    })
    .filter((value): value is string => !!value)
  const slotAuthority = slotRules.length > 0
    ? [
        '角色 slot 是空间和反打关系的硬约束，不能当作普通描述忽略。',
        ...slotRules,
        '镜头背景必须根据当前可见角色的 slot、视线方向和 shot_type 重新判断相机面对哪一面墙、门窗、柜子和桌椅关系。',
        '不同角色 slot、对谈桌两侧、正反打或主观/反打镜头不得复用完全相同的背景板；只有明确传入分镜连续性参考时才允许保持同一背景几何。',
      ].join('\n')
    : null
  const characterRule = characterNames.length > 0
    ? `本镜头只允许出现 ${characterNames.length} 个明确角色：${characterNames.join('、')}。不得新增未列入 panel.characters 的人物。`
    : '本镜头 panel.characters 为空数组，画面中不得出现任何人物、医生、护士、病人或路人。'
  const singleCharacterOffscreenLock = characterNames.length === 1
    ? [
        `单人镜头硬约束：画面只显示${characterNames[0]}一个人。`,
        '其他角色、对话对象、画外对象只允许决定视线方向和情绪，不得以坐在桌边的人、背影、模糊人影、白大褂、剪影、反射或背景人物形式出现在画面里。',
        '如果场景里有第二个人，必须重新构图、裁掉或移除，最终成片中不得可见。',
      ].join('\n')
    : null
  const visibleCharacterLock = characterNames.length > 0
    ? [
        `Visible character count lock: exactly ${characterNames.length} named character(s) may appear: ${characterNames.join(', ')}.`,
        characterNames.length === 1
          ? `This is a one-person shot. Show only ${characterNames[0]}; do not create a second copy, twin, reflection clone, assistant, patient, passerby, or stand-in.`
          : 'Do not add extra people, duplicate any listed character, merge faces, or replace one listed character with another person.',
        'If reference images, prior panels, or source text imply additional people outside panel.characters, ignore them for this image.',
      ].join('\n')
    : 'Visible character count lock: exactly 0 people may appear. Do not add doctors, nurses, patients, passersby, silhouettes, or background humans.'

  return [
    prompt,
    '',
    '执行优先级修正：当前分镜结构化字段高于原文片段。',
    '必须优先服从 panel.description、panel.image_prompt、panel.characters、panel.location、panel.shot_type、panel.camera_move。',
    characterRule,
    visibleCharacterLock,
    singleCharacterOffscreenLock,
    characterNames.length === 1 ? buildSingleCharacterReverseShotRule(characterNames[0]) : null,
    slotAuthority,
    '原文片段只作为剧情背景参考，不得引入未列入当前分镜字段的人物、动作或构图。',
  ].filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n')
}

type PanelReferenceBundle = {
  sketchRef: string | null
  locationRef: string | null
  characterRefs: Array<{
    name: string
    appearance: string | null
    slot: string | null
    url: string
  }>
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function parseAspectRatioParts(aspectRatio: string | null | undefined): { width: number; height: number } | null {
  const match = /^(\d+)\s*:\s*(\d+)$/.exec((aspectRatio || '').trim())
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function supportsDefinitionAwareQwenEditRouting(aspectRatio: string | null | undefined): boolean {
  const parsed = parseAspectRatioParts(aspectRatio)
  if (!parsed) return true
  return parsed.width > 0 && parsed.height > 0
}

function inferImageReferenceSlotCount(modelKey: string | null | undefined): number {
  const normalized = (modelKey || '').trim()
  if (!normalized) return 0
  if (normalized === COMFYUI_FLUX_MULTI_EDIT_MODEL) return 5
  if (normalized === COMFYUI_QWEN_TRIPLE_EDIT_MODEL) return 3
  if (normalized === COMFYUI_QWEN_DOUBLE_EDIT_MODEL) return 2
  return 1
}

function buildMultiCharacterBasePrompt(params: {
  prompt: string
  characterNames: string[]
  shotType: string | null
  cameraMove: string | null
}): string {
  return [
    params.prompt,
    '',
    '补充要求：这是多人复杂分镜的第一阶段底图生成。',
    `必须明确表现 ${params.characterNames.length} 个人物同框：${params.characterNames.join('、')}。`,
    `镜头类型：${params.shotType || '未指定'}；镜头运动：${params.cameraMove || '未指定'}。`,
    '这一阶段优先保证人数正确、站位关系正确、景别正确、构图稳定、场景氛围正确。',
    '人物脸部和服装细节可以适度留给后续编辑阶段修正，但绝不能少人、多人、错位或主体关系错误。',
  ].join('\n')
}

function buildMultiCharacterCoordinationPrompt(params: {
  prompt: string
  primaryCharacterName: string
  remainingCharacterNames: string[]
}): string {
  return [
    params.prompt,
    '',
    '补充要求：这是多人复杂分镜的第二阶段角色补全与纠偏。',
    `保留当前画面的主体构图和主角 ${params.primaryCharacterName} 的位置关系。`,
    `根据附加参考图补全并修正这些人物：${params.remainingCharacterNames.join('、')}。`,
    '重点修正：人数完整、每个人物身份清晰、服装和轮廓接近参考、人物之间不要互相融合、不要多余四肢和重复人脸。',
    '保持原镜头景别和叙事方向，不要把当前构图改成完全不同的场景。',
  ].join('\n')
}

function buildMultiCharacterFinalPolishPrompt(params: {
  prompt: string
  characterNames: string[]
}): string {
  return [
    params.prompt,
    '',
    '补充要求：这是多人复杂分镜的最终精修阶段。',
    `最终画面必须稳定呈现 ${params.characterNames.length} 个人物同框：${params.characterNames.join('、')}。`,
    '统一修正人物面部一致性、手部、肢体边缘、遮挡关系、服装细节和整体光影风格。',
    '保持镜头构图和叙事动作不变，不要新增人物，不要删除人物。',
  ].join('\n')
}

function buildQwenStoryboardScenePrompt(prompt: string): string {
  return [
    prompt,
    '',
    '参考图只用于辅助当前分镜的场景、空间、光影或连续性判断，不是要复制的成片。',
    '参考图的媒介质感、渲染方式、成片类型和制作工艺不能被继承；最终画面媒介风格必须由项目风格定义决定。',
    '如果参考图内容与当前分镜文字冲突，必须以当前分镜文字为准，重新组织镜头、人物位置、动作和景别。',
    '禁止直接复刻上一张画面，禁止输出角色设定三视图、白底展示图、拼贴图或多角度角色表。',
  ].join('\n')
}

function buildQwenEditStoryboardPrompt(prompt: string): string {
  return [
    prompt,
    '',
    '参考图使用规则：人物镜头中，角色参考图优先用于确定画面主体；场景/草图参考只用于辅助空间、构图和氛围。',
    '如果参考图同时包含角色和场景，必须先满足当前分镜的人物、动作、景别和情绪，再融合场景布局。',
    '参考图只传递内容线索，不传递媒介质感、渲染方式、成片类型或制作工艺；最终画面媒介风格必须由项目风格定义决定。',
    '如果参考图是角色三视图或资产图，只提取人物特征，不要把三视图、白底、拼贴布局画进成片。',
    '最终只输出一张当前分镜镜头：必须服从分镜文字中的人物、地点、景别、动作和情绪。',
    '禁止直接复制任何参考图，禁止新增与分镜无关的人物。',
  ].join('\n')
}

function isQwenDefinitionAwareEditModel(modelKey: string | null | undefined): boolean {
  const normalized = (modelKey || '').trim()
  return normalized === COMFYUI_QWEN_SINGLE_EDIT_MODEL
    || normalized === COMFYUI_QWEN_DOUBLE_EDIT_MODEL
    || normalized === COMFYUI_QWEN_TRIPLE_EDIT_MODEL
}

function selectCoordinatedEditModel(params: {
  enabledImageModelKeys: Set<string>
  defaultEditModel: string | null
  requiredSlots: number
}): string | null {
  if (
    params.requiredSlots >= MULTI_CHARACTER_COORDINATION_THRESHOLD
    && params.enabledImageModelKeys.has(COMFYUI_FLUX_MULTI_EDIT_MODEL)
  ) {
    return COMFYUI_FLUX_MULTI_EDIT_MODEL
  }

  const candidates = [
    COMFYUI_QWEN_DOUBLE_EDIT_MODEL,
    COMFYUI_QWEN_TRIPLE_EDIT_MODEL,
    COMFYUI_FLUX_MULTI_EDIT_MODEL,
    params.defaultEditModel,
  ].filter((value, index, arr): value is string => typeof value === 'string' && value.trim().length > 0 && arr.indexOf(value) === index)

  const enabledCandidates = candidates.filter((modelKey) => params.enabledImageModelKeys.has(modelKey))
  const exactFit = enabledCandidates
    .filter((modelKey) => inferImageReferenceSlotCount(modelKey) >= params.requiredSlots)
    .sort((a, b) => inferImageReferenceSlotCount(a) - inferImageReferenceSlotCount(b))[0]

  if (exactFit) return exactFit

  const defaultEditModel = params.defaultEditModel?.trim() || ''
  if (
    defaultEditModel
    && params.enabledImageModelKeys.has(defaultEditModel)
    && inferImageReferenceSlotCount(defaultEditModel) >= params.requiredSlots
  ) {
    return defaultEditModel
  }

  return enabledCandidates.find((modelKey) => inferImageReferenceSlotCount(modelKey) >= params.requiredSlots) || null
}

function selectQwenStoryboardIdentityEditModel(params: {
  enabledImageModelKeys: Set<string>
  defaultEditModel: string | null
  requiredSlots: number
  preferMultiImageEdit?: boolean
}): string | null {
  const candidates = (
    params.preferMultiImageEdit
      ? [
          COMFYUI_FLUX_MULTI_EDIT_MODEL,
          COMFYUI_QWEN_TRIPLE_EDIT_MODEL,
          COMFYUI_QWEN_DOUBLE_EDIT_MODEL,
          params.defaultEditModel,
        ]
      : [
          COMFYUI_QWEN_DOUBLE_EDIT_MODEL,
          COMFYUI_QWEN_TRIPLE_EDIT_MODEL,
          COMFYUI_FLUX_MULTI_EDIT_MODEL,
          params.defaultEditModel,
        ]
  ).filter((value, index, arr): value is string => typeof value === 'string' && value.trim().length > 0 && arr.indexOf(value) === index)

  const availableCandidates = candidates
    .filter((modelKey) => params.enabledImageModelKeys.has(modelKey))
    .filter((modelKey) => inferImageReferenceSlotCount(modelKey) >= params.requiredSlots)
  if (params.preferMultiImageEdit) return availableCandidates[0] || null
  return availableCandidates.sort((a, b) => inferImageReferenceSlotCount(a) - inferImageReferenceSlotCount(b))[0] || null
}

type IdentityPromptAlias = {
  name: string
  alias: string
}

function buildIdentityPromptAliases(characterNames: string[]): IdentityPromptAlias[] {
  return uniqueStrings(characterNames.map((name) => name.trim())).map((name, index) => ({
    name,
    alias: index < 26 ? `角色${String.fromCharCode(65 + index)}` : `角色${index + 1}`,
  }))
}

function maskIdentityPromptCharacterNames(prompt: string, aliases: IdentityPromptAlias[]): string {
  return aliases
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .reduce((next, item) => {
      if (!item.name) return next
      return next.replace(new RegExp(escapeRegExp(item.name), 'g'), item.alias)
    }, prompt)
}

function buildIdentitySlotPromptLines(aliases: IdentityPromptAlias[], characterSlots: Array<string | null | undefined>): string[] {
  const slotLines = aliases
    .map((item, index) => {
      const slot = typeof characterSlots[index] === 'string' && characterSlots[index]!.trim().length > 0
        ? characterSlots[index]!.trim()
        : null
      return slot ? `${item.alias} 的当前空间位置/slot：${slot}` : null
    })
    .filter((line): line is string => !!line)

  if (slotLines.length === 0) return []
  return [
    '角色 slot 是决定背景反打面的硬约束。',
    ...slotLines,
    '必须根据当前可见角色的 slot、视线方向和 shot_type 选择相机面对的墙面、门窗、柜子、桌椅关系。',
    '不同角色 slot、对谈桌两侧、正反打或主观/反打镜头不得复用完全相同的背景板；只有明确的分镜连续性参考可以覆盖这条规则。',
  ]
}

function buildQwenStoryboardIdentityEditPrompt(params: {
  prompt: string
  characterNames: string[]
  characterSlots?: Array<string | null | undefined>
  hasSceneReference?: boolean
  baseIsSceneReference?: boolean
  baseIsPanelContinuityReference?: boolean
  sceneReferenceIsPanelContinuity?: boolean
}): string {
  const aliases = buildIdentityPromptAliases(params.characterNames)
  const aliasNames = aliases.map((item) => item.alias)
  const slotPromptLines = buildIdentitySlotPromptLines(aliases, params.characterSlots || [])
  const visibleCharacterCount = aliases.length
  const characterReferenceStartIndex = 2
  const sceneReferenceIndex = characterReferenceStartIndex + aliases.length
  const characterReferenceRange = aliases.length <= 1
    ? `第 ${characterReferenceStartIndex} 张参考图`
    : `第 ${characterReferenceStartIndex} 到第 ${sceneReferenceIndex - 1} 张参考图`
  const sceneReferenceRule = params.hasSceneReference
    ? params.sceneReferenceIsPanelContinuity
      ? `Reference image ${sceneReferenceIndex} is a confirmed previous panel from the same location. Use it only for background continuity: room geometry, wall/window/door/furniture relationships, lighting direction, and visible props. Do not copy people from it unless they are listed in the current panel character references.`
      : params.baseIsPanelContinuityReference
        ? `The scene asset at reference image ${sceneReferenceIndex} is secondary location proof only. Reference image 1 is the continuity authority for exact background geometry, door/window/furniture positions, lighting direction, and visible props.`
      : `Reference image ${sceneReferenceIndex} is the project location identity reference. It is not a fixed background plate. Keep the same office identity, props, lighting family, and production design, but recompose the camera-facing background for the current character slot, eyeline, shot type, and reverse-angle direction.`
    : null
  const referenceMapping = aliases.map((item, index) => (
    `第 ${index + characterReferenceStartIndex} 张角色资产图对应${item.alias}，${item.alias}的年龄感、脸型、五官、发型、眼镜和服装结构以该资产图为准。`
  ))

  return [
    buildQwenEditStoryboardPrompt(maskIdentityPromptCharacterNames(params.prompt, aliases)),
    '',
    params.hasSceneReference
      ? params.baseIsSceneReference
        ? params.sceneReferenceIsPanelContinuity
          ? `Identity and continuity requirements: reference image 1 is the current project location base plate, ${characterReferenceRange} contains the only character assets allowed in this panel, and reference image ${sceneReferenceIndex} is a previous confirmed panel used only for background continuity.`
          : `身份修正要求：第一张参考图是当前项目地点的场景资产基础图，${characterReferenceRange}是本镜头必须保持一致的角色资产，第 ${sceneReferenceIndex} 张参考图再次提供同一地点的场景资产。`
        : `身份修正要求：第一张参考图是当前分镜的基础构图，${characterReferenceRange}是本镜头必须保持一致的角色资产，第 ${sceneReferenceIndex} 张参考图是同一地点的场景资产。`
      : '身份修正要求：第一张参考图是当前分镜的基础构图，后续参考图是本镜头必须保持一致的角色资产。',
    sceneReferenceRule,
    ...referenceMapping,
    ...slotPromptLines,
    visibleCharacterCount === 1
      ? 'Single-character image rule: only the mapped character may be visible. Remove every other human form from the background, including seated people, doctors, patients, silhouettes, reflections, backs, partial bodies, and blurred figures.'
      : null,
    visibleCharacterCount === 1 ? buildSingleCharacterReverseShotRule(aliasNames[0]) : null,
    params.baseIsPanelContinuityReference
      ? 'Scene continuity lock: reference image 1 is a confirmed neighboring panel from the same storyboard and same location. Keep the same office geometry, wall/window/door/furniture relationship, lighting direction, and background continuity; only change crop, push-in, camera angle, pose, or mouth state required by the current panel.'
      : null,
    params.baseIsSceneReference
      ? 'Scene lock: reference image 1 and the scene reference image are the same project location; keep the shot inside this location and only crop, push in, or adjust camera angle for the current panel.'
      : null,
    `本镜头只能出现 ${visibleCharacterCount} 个可见人物：${aliasNames.join('、')}。不得添加患者、旁人、护士、其他医生、背影人物或任何未列入角色资产映射的人。`,
    '如果第一张基础构图里多出了未列出的其他人物，必须删除或裁掉，不得保留。',
    '台词里的“你、他、她、对方、陈迹”等对象只有在本镜头角色资产映射中列出时才可以画出来；未列出时必须视为镜头外对象。',
    'Slot-aware background rule: use panel.characters.slot and the current shot text to decide which side of the location faces the camera. Different character slots, opposite sides of a desk, or reverse shots must show a different camera-facing wall/furniture arrangement instead of the same background plate.',
    params.hasSceneReference
      ? params.baseIsPanelContinuityReference
        ? 'Continuity priority: if reference image 1 and the location asset differ, preserve reference image 1 for background geometry and use the location asset only to confirm the same place. Do not import new doors, windows, cabinets, water dispensers, chairs, wall openings, or props unless they are visible in reference image 1 or explicitly required by the current panel text.'
        : params.sceneReferenceIsPanelContinuity
          ? `Continuity priority: reference image ${sceneReferenceIndex} controls background continuity, but current panel.characters controls visible people. Remove or crop out any person from reference image ${sceneReferenceIndex} who is not one of the mapped character assets for this panel.`
        : 'Location asset priority: preserve the same location identity and major prop vocabulary, but the current panel text controls shot angle, character seat, eyeline direction, crop, and visible background arrangement. Do not make different character slots share an identical background composition unless a panel continuity reference is supplied.'
      : null,
    '角色资产图优先决定年龄感、脸型、五官、发型、眼镜和服装结构；分镜文字只决定动作、景别、场景和叙事目标。',
    '不得因为分镜文字中的泛化年龄或职业称呼，把角色资产图中的人物明显变老、变年轻、换脸或换发型。',
    '不得新增参考图中不存在的深皱纹、眼袋、明显法令纹或额外白发；如果基础构图已经出现这些漂移，必须按角色资产图回调。',
    'Identity correction priority: if the base composition face conflicts with a character asset, repaint the visible face to match the asset rather than preserving the base face.',
    `必须保持这些角色的身份、脸型、发型、服装结构和主要辨识特征：${aliasNames.join('、')}。`,
    '保留第一张基础构图的景别、机位、场景和人物站位，不要改成角色设定图、白底图或拼贴图。',
    '如果基础构图中的人物与角色资产不一致，以角色资产为准修正人物身份。',
  ].filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n')
}

function buildQwenStoryboardIdentityBasePrompt(params: {
  prompt: string
  characterNames: string[]
  characterSlots?: Array<string | null | undefined>
}): string {
  const aliases = buildIdentityPromptAliases(params.characterNames)
  const aliasNames = aliases.map((item) => item.alias)
  const slotPromptLines = buildIdentitySlotPromptLines(aliases, params.characterSlots || [])
  const mapping = aliases.length > 0
    ? `身份占位映射：${aliases.map((item, index) => `${item.alias}对应后续第 ${index + 2} 张角色资产图`).join('；')}。这些标签只用于保持人数、动作和站位，外貌不要从原角色名推断。`
    : null

  return [
    maskIdentityPromptCharacterNames(params.prompt, aliases),
    '',
    '补充要求：这是角色身份修正前的基础构图生成阶段。',
    mapping,
    ...slotPromptLines,
    `本阶段必须先稳定呈现当前分镜的场景、景别、机位、人物数量和站位：${aliasNames.join('、')}。`,
    aliases.length === 1
      ? '单人底图规则：画面只允许一个可见人物；不要在桌边、门口、背景、反射或模糊区域生成第二个人。'
      : null,
    aliases.length === 1 ? buildSingleCharacterReverseShotRule(aliasNames[0]) : null,
    `画面中只能有 ${aliases.length} 个可见人物，不得根据台词里的“你、他、她、对方”新增未列出的镜头外人物。`,
    'Composition slot rule: choose the background from the current character slot and reverse-angle direction; do not reuse the same wall/furniture arrangement for opposite seats or different visible character slots.',
    '基础构图阶段不要根据角色名或职业称呼自行推断年龄细节，不要主动添加深皱纹、眼袋、明显法令纹或额外白发。',
    'Identity handoff: generate only a composition plate. Keep visible faces low-detail and neutral; do not lock in wrinkles, eye bags, age lines, or a different face from the later character asset images.',
    'Leave facial identity, exact age cues, hairstyle, glasses shape, and clothing structure for the identity edit stage; preserve pose, shot size, camera angle, scene, lighting, and 16:9 layout.',
    '人物脸部和服装细节会在后续身份修正阶段按角色资产图校准；本阶段不得少人、多人、错位或改变当前分镜主体关系。',
  ].filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n')
}

function buildPanelReferenceBundle(params: {
  panel: {
    sketchImageUrl?: string | null
    characters?: string | null
    location?: string | null
  }
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
}): PanelReferenceBundle {
  const sketchRef = toSignedUrlIfCos(params.panel.sketchImageUrl, 3600)
  const panelCharacters = parsePanelCharacterReferences(params.panel.characters)
  const characterRefs = panelCharacters.flatMap((reference) => {
    const character = findCharacterByNameLoose(params.projectData.characters || [], reference.name)
    if (!character) return []

    const appearances = character.appearances || []
    const appearance =
      (reference.appearance
        ? appearances.find((item) => (item.changeReason || '').toLowerCase() === reference.appearance!.toLowerCase())
        : null) || appearances[0]
    if (!appearance) return []

    const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
    const selectedIndex = appearance.selectedIndex
    const selectedUrl = selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
    const key = selectedUrl || imageUrls[0] || appearance.imageUrl
    const signedUrl = toSignedUrlIfCos(key, 3600)
    if (!signedUrl) return []

    return [{
      name: character.name,
      appearance: appearance.changeReason || null,
      slot: reference.slot || null,
      url: signedUrl,
    }]
  })

  const locationRef = (() => {
    if (!params.panel.location) return null
    const location = (params.projectData.locations || []).find(
      (item) => item.name.toLowerCase() === params.panel.location!.toLowerCase(),
    )
    if (!location) return null
    const selectedImage = (location.images || []).find((item) => item.isSelected) || location.images?.[0]
    return toSignedUrlIfCos(selectedImage?.imageUrl, 3600)
  })()

  return {
    sketchRef,
    locationRef,
    characterRefs,
  }
}

function isQwenStoryboardReferenceWorkflow(modelKey: string | null | undefined): boolean {
  return (modelKey || '').trim() === COMFYUI_QWEN_STORYBOARD_MODEL
}

function isTightSingleCharacterShot(shotType: string | null | undefined, description: string | null | undefined): boolean {
  const text = `${shotType || ''} ${description || ''}`.toLowerCase()
  return /特写|近景|close[-\s]?up|medium close|tight shot|portrait|面部|脸部|嘴部|鼻梁/.test(text)
}

type PanelSceneContinuityReference = {
  url: string
  panelId: string
  panelIndex: number | null
  visibleCharacterCount: number
}

function buildPanelCharacterContinuitySignature(characters: string | null | undefined): string {
  const refs = parsePanelCharacterReferences(characters)
    .map((item) => ({
      name: item.name.trim(),
      slot: (item.slot || '').trim(),
    }))
    .filter((item) => item.name.length > 0)
    .sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name)
      if (nameCompare !== 0) return nameCompare
      return a.slot.localeCompare(b.slot)
    })

  return refs.map((item) => `${item.name}\u0002${item.slot}`).join('\u0001')
}

function isEstablishingSceneShot(shotType: string | null | undefined, description: string | null | undefined): boolean {
  const text = `${shotType || ''} ${description || ''}`.toLowerCase()
  return /wide|long shot|establishing|master shot|\u8fdc\u666f|\u5168\u666f|\u4fef\u62cd/.test(text)
}

function normalizePanelContinuitySourceText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

async function findPanelSceneContinuityReference(params: {
  panel: {
    id: string
    storyboardId: string
    panelIndex: number
    location?: string | null
    characters?: string | null
    srtSegment?: string | null
  }
}): Promise<PanelSceneContinuityReference | null> {
  const location = params.panel.location?.trim()
  if (!location || params.panel.panelIndex <= 0) return null
  const currentCharacterSignature = buildPanelCharacterContinuitySignature(params.panel.characters)
  if (!currentCharacterSignature) return null
  const currentSourceText = normalizePanelContinuitySourceText(params.panel.srtSegment)
  if (!currentSourceText) return null

  const previousPanels = await prisma.novelPromotionPanel.findMany({
    where: {
      storyboardId: params.panel.storyboardId,
      panelIndex: { lt: params.panel.panelIndex },
      location,
      imageUrl: { not: null },
      NOT: { id: params.panel.id },
    },
    orderBy: { panelIndex: 'desc' },
    take: 8,
    select: {
      id: true,
      panelIndex: true,
      shotType: true,
      description: true,
      srtSegment: true,
      characters: true,
      imageUrl: true,
    },
  })

  const candidates = previousPanels.flatMap((candidate) => {
    const url = toSignedUrlIfCos(candidate.imageUrl, 3600)
    if (!url) return []
    const characterSignature = buildPanelCharacterContinuitySignature(candidate.characters)
    if (characterSignature !== currentCharacterSignature) return []
    if (normalizePanelContinuitySourceText(candidate.srtSegment) !== currentSourceText) return []
    return [{
      url,
      panelId: candidate.id,
      panelIndex: typeof candidate.panelIndex === 'number' ? candidate.panelIndex : null,
      visibleCharacterCount: parsePanelCharacterReferences(candidate.characters).length,
      shotType: candidate.shotType,
      description: candidate.description,
    }]
  })
  if (candidates.length === 0) return null

  const establishing = candidates.length > 1
    ? candidates.find((candidate) => isEstablishingSceneShot(candidate.shotType, candidate.description))
    : null
  const selected = establishing || candidates[0]
  return {
    url: selected.url,
    panelId: selected.panelId,
    panelIndex: selected.panelIndex,
    visibleCharacterCount: selected.visibleCharacterCount,
  }
}

async function createSceneContinuityBackgroundReference(referenceImage: string): Promise<string | null> {
  try {
    const originalUrl = await normalizeToOriginalMediaUrl(referenceImage)
    const [{ default: sharp }, storage] = await Promise.all([
      import('sharp'),
      import('@/lib/storage'),
    ])
    const response = await fetch(storage.toFetchableUrl(originalUrl))
    if (!response.ok) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width || 0
    const height = metadata.height || 0
    if (width < 320 || height < 180) return null

    const coverTop = Math.max(1, Math.min(height - 1, Math.floor(height * 0.25)))
    const coverHeight = height - coverTop
    const cover = await sharp({
      create: {
        width,
        height: coverHeight,
        channels: 4,
        background: { r: 232, g: 235, b: 232, alpha: 1 },
      },
    }).png().toBuffer()
    const sanitized = await sharp(buffer)
      .composite([{ input: cover, left: 0, top: coverTop }])
      .resize({ width: 1280, height: 720, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()

    const key = storage.generateUniqueKey('panel-scene-continuity-background', 'jpg')
    await storage.uploadObject(sanitized, key, 1, 'image/jpeg')
    return key
  } catch {
    return null
  }
}

async function createTightCharacterReferenceCrop(referenceImage: string): Promise<string | null> {
  try {
    const originalUrl = await normalizeToOriginalMediaUrl(referenceImage)
    const [{ default: sharp }, storage] = await Promise.all([
      import('sharp'),
      import('@/lib/storage'),
    ])
    const response = await fetch(storage.toFetchableUrl(originalUrl))
    if (!response.ok) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width || 0
    const height = metadata.height || 0
    if (width < 320 || height < 320) return null

    const top = Math.min(Math.floor(height * 0.09), Math.floor(height / 4))
    const cropWidth = Math.max(1, Math.min(width, Math.floor(width * 0.44)))
    const cropHeight = Math.max(1, height - top)
    const cropped = await sharp(buffer)
      .extract({ left: 0, top, width: cropWidth, height: cropHeight })
      .resize({ width: 768, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()

    const key = storage.generateUniqueKey('panel-character-reference-crop', 'jpg')
    await storage.uploadObject(cropped, key, 1, 'image/jpeg')
    return key
  } catch {
    return null
  }
}

async function preparePanelReferenceImages(params: {
  refs: string[]
  modelRoutingReason: string | null
}): Promise<{ refs: string[]; croppedReferenceCount: number }> {
  const reason = params.modelRoutingReason || ''
  const shouldCropTightSingleCharacterReference = reason.includes('qwen_storyboard_tight')
    && reason.includes('one_character')
    && params.refs.length > 0
  if (!shouldCropTightSingleCharacterReference) {
    return { refs: params.refs, croppedReferenceCount: 0 }
  }

  const cropped = await createTightCharacterReferenceCrop(params.refs[0])
  if (!cropped) return { refs: params.refs, croppedReferenceCount: 0 }
  return {
    refs: [cropped, ...params.refs.slice(1)],
    croppedReferenceCount: 1,
  }
}

async function buildQwenStoryboardSceneReferenceImages(params: {
  referenceBundle: PanelReferenceBundle
}): Promise<string[]> {
  if (params.referenceBundle.sketchRef) {
    return [params.referenceBundle.sketchRef]
  }

  return []
}

async function buildSinglePanelReferenceImages(params: {
  panel: {
    storyboardId: string
    panelIndex: number
    sketchImageUrl?: string | null
    characters?: string | null
    location?: string | null
  }
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
  modelKey: string
  referenceBundle: PanelReferenceBundle
}): Promise<string[]> {
  if (isQwenStoryboardReferenceWorkflow(params.modelKey)) {
    const sceneRefs = await buildQwenStoryboardSceneReferenceImages({
      referenceBundle: params.referenceBundle,
    })

    return sceneRefs
  }

  return await collectPanelReferenceImages(params.projectData, params.panel)
}

function buildDefinitionAwareQwenStoryboardPlan(params: {
  requestedModelKey: string
  referenceBundle: PanelReferenceBundle
  aspectRatio: string | null | undefined
  shotType: string | null | undefined
  description: string | null | undefined
}): DefinitionAwareQwenStoryboardPlan {
  if (!isQwenStoryboardReferenceWorkflow(params.requestedModelKey)) {
    return {
      modelKey: params.requestedModelKey,
      referenceImages: null,
      reason: null,
      identityEdit: null,
    }
  }

  if (!supportsDefinitionAwareQwenEditRouting(params.aspectRatio)) {
    return {
      modelKey: params.requestedModelKey,
      referenceImages: null,
      reason: 'qwen_storyboard_preserve_project_aspect',
      identityEdit: null,
    }
  }

  if (params.referenceBundle.sketchRef) {
    return {
      modelKey: params.requestedModelKey,
      referenceImages: [params.referenceBundle.sketchRef],
      reason: 'qwen_storyboard_sketch_reference_controlled',
      identityEdit: null,
    }
  }

  const sceneRef = params.referenceBundle.locationRef
  const characterRefs = params.referenceBundle.characterRefs.map((item) => item.url)

  if (characterRefs.length >= MULTI_CHARACTER_COORDINATION_THRESHOLD) {
    return {
      modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
      referenceImages: [],
      reason: 'qwen_storyboard_multi_character_base',
      identityEdit: null,
    }
  }

  if (characterRefs.length === 2) {
    const reason = sceneRef
      ? 'qwen_storyboard_scene_two_character_identity_edit'
      : 'qwen_storyboard_two_character_identity_edit'
    return {
      modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
      referenceImages: [],
      reason,
      identityEdit: {
        sceneRef,
        sceneContinuityRef: null,
        sceneContinuityPanelId: null,
        sceneContinuityPanelIndex: null,
        characterRefs,
        requiredSlots: 1 + characterRefs.length + (sceneRef ? 1 : 0),
        reason,
      },
    }
  }

  if (characterRefs.length === 1) {
    const tight = isTightSingleCharacterShot(params.shotType, params.description)
    const reason = sceneRef
      ? (
          tight
            ? 'qwen_storyboard_tight_scene_one_character_identity_edit'
            : 'qwen_storyboard_scene_one_character_identity_edit'
        )
      : (
          tight
            ? 'qwen_storyboard_tight_one_character_identity_edit'
            : 'qwen_storyboard_one_character_identity_edit'
        )
    return {
      modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
      referenceImages: [],
      reason,
      identityEdit: {
        sceneRef,
        sceneContinuityRef: null,
        sceneContinuityPanelId: null,
        sceneContinuityPanelIndex: null,
        characterRefs,
        requiredSlots: 1 + characterRefs.length + (sceneRef ? 1 : 0),
        reason,
      },
    }
  }

  if (params.referenceBundle.locationRef) {
    return {
      modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
      referenceImages: [],
      reason: 'qwen_storyboard_location_only_text_to_image_aspect_locked',
      identityEdit: null,
    }
  }

  return {
    modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
    referenceImages: [],
    reason: 'qwen_storyboard_text_only_scene',
    identityEdit: null,
  }
}

function buildPanelImageGenerationPacket(params: {
  panel: {
    id: string
    shotType: string | null
    cameraMove: string | null
    description: string | null
    imagePrompt: string | null
    location: string | null
    characters: string | null
    srtSegment: string | null
  }
  prompt: string
  aspectRatio: string
  requestedModelKey: string
  resolvedModelKey: string
  modelRoutingReason: string | null
  referenceImages: string[]
}): PanelImageGenerationPacket {
  const characters = parsePanelCharacterReferences(params.panel.characters)

  const summarizeReference = (url: string): string => {
    const trimmed = url.trim()
    const dataUrlMatch = /^data:([^;,]+)?;base64,(.*)$/i.exec(trimmed)
    if (dataUrlMatch) {
      const mimeType = dataUrlMatch[1] || 'application/octet-stream'
      const base64Length = dataUrlMatch[2]?.length || 0
      const approxBytes = Math.floor(base64Length * 0.75)
      return `data:${mimeType};base64,<${approxBytes} bytes>`
    }
    if (trimmed.length <= 320) return trimmed
    return `${trimmed.slice(0, 220)}...${trimmed.slice(-48)}`
  }

  return {
    panelId: params.panel.id,
    sourceText: params.panel.srtSegment || null,
    description: params.panel.description || null,
    imagePrompt: params.panel.imagePrompt || null,
    shotType: params.panel.shotType || null,
    cameraMove: params.panel.cameraMove || null,
    location: params.panel.location || null,
    characters: characters.map((character) => ({
      name: character.name,
      appearance: character.appearance ?? null,
      slot: character.slot ?? null,
    })),
    allowedActions: [
      params.panel.description,
      params.panel.imagePrompt,
      params.panel.cameraMove,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim()),
    forbiddenContent: [
      'Do not add people not listed in panel.characters.',
      'Do not change the current panel scene.',
      'Do not introduce unrelated romance, poses, or plot events.',
      'Do not use old candidate images as story facts.',
    ],
    aspectRatio: params.aspectRatio,
    requestedModelKey: params.requestedModelKey,
    resolvedModelKey: params.resolvedModelKey,
    modelRoutingReason: params.modelRoutingReason,
    references: params.referenceImages.map((url, index) => ({ index, url: summarizeReference(url) })),
  }
}

async function recordPanelImageAuditFailure(params: {
  taskId: string
  packet: PanelImageGenerationPacket
  audit: PanelImageAuditResult
}) {
  try {
    await prisma.task.update({
      where: { id: params.taskId },
      data: {
        result: {
          panelImageGenerationPacket: params.packet,
          panelImageAudit: params.audit,
        },
      },
    })
  } catch {
    // Task failure handling will still persist the thrown error.
  }
}

const NON_BLOCKING_PANEL_IMAGE_AUDIT_CODES = new Set([
  'PANEL_IMAGE_AUDIT_VISION_MODEL_MISSING',
  'PANEL_IMAGE_AUDIT_VISION_RUNTIME_FAILED',
  'PANEL_IMAGE_AUDIT_CONTENT_MISMATCH',
])

function isNonBlockingPanelImageAuditFailure(audit: PanelImageAuditResult): boolean {
  return typeof audit.code === 'string' && NON_BLOCKING_PANEL_IMAGE_AUDIT_CODES.has(audit.code)
}

async function runCoordinatedMultiCharacterGeneration(params: {
  job: Job<TaskJobData>
  panel: {
    shotType: string | null
    cameraMove: string | null
  }
  userId: string
  baseModelKey: string
  defaultEditModel: string | null
  coordinationModelKey: string
  prompt: string
  aspectRatio: string
  referenceBundle: PanelReferenceBundle
  candidateCount: number
}): Promise<string> {
  const primaryCharacter = params.referenceBundle.characterRefs[0]
  if (!primaryCharacter || params.referenceBundle.characterRefs.length < MULTI_CHARACTER_COORDINATION_THRESHOLD || !params.defaultEditModel) {
    throw new Error('MULTI_CHARACTER_COORDINATION_INVALID')
  }

  const characterNames = params.referenceBundle.characterRefs.map((item) => item.name)
  const baseReferenceImages = await normalizeReferenceImagesForGeneration(
    uniqueStrings([
      params.referenceBundle.sketchRef,
      params.referenceBundle.locationRef,
      primaryCharacter.url,
    ]),
  )

  const baseSource = await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.baseModelKey,
    prompt: buildMultiCharacterBasePrompt({
      prompt: params.prompt,
      characterNames,
      shotType: params.panel.shotType,
      cameraMove: params.panel.cameraMove,
    }),
    options: {
      referenceImages: baseReferenceImages,
      aspectRatio: params.aspectRatio,
    },
    allowTaskExternalIdResume: params.candidateCount === 1,
    pollProgress: { start: 30, end: 58 },
  })

  const remainingCharacters = params.referenceBundle.characterRefs.slice(1)
  const coordinationExtraSlots = Math.max(0, inferImageReferenceSlotCount(params.coordinationModelKey) - 1)
  const preferredCoordinationInputs = params.coordinationModelKey === COMFYUI_FLUX_MULTI_EDIT_MODEL
    ? [
        baseSource,
        params.referenceBundle.locationRef,
        primaryCharacter.url,
        ...remainingCharacters.map((item) => item.url),
      ]
    : [
        baseSource,
        ...remainingCharacters.map((item) => item.url),
      ]
  const coordinationReferenceImages = await normalizeReferenceImagesForGeneration(
    preferredCoordinationInputs
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 1 + coordinationExtraSlots),
  )

  const coordinatedSource = await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.coordinationModelKey,
    prompt: buildMultiCharacterCoordinationPrompt({
      prompt: params.prompt,
      primaryCharacterName: primaryCharacter.name,
      remainingCharacterNames: remainingCharacters.map((item) => item.name),
    }),
    options: {
      referenceImages: coordinationReferenceImages,
      aspectRatio: params.aspectRatio,
    },
    allowTaskExternalIdResume: false,
    pollProgress: { start: 58, end: 82 },
  })

  const finalPolishSlotCount = inferImageReferenceSlotCount(params.defaultEditModel)
  if (finalPolishSlotCount <= 1) {
    return coordinatedSource
  }

  const finalPolishReferenceImages = await normalizeReferenceImagesForGeneration(
    [
      coordinatedSource,
      params.referenceBundle.locationRef,
      ...params.referenceBundle.characterRefs.map((item) => item.url),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, finalPolishSlotCount),
  )
  return await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.defaultEditModel,
    prompt: buildMultiCharacterFinalPolishPrompt({
      prompt: params.prompt,
      characterNames,
    }),
    options: {
      referenceImages: finalPolishReferenceImages,
      aspectRatio: params.aspectRatio,
    },
    allowTaskExternalIdResume: false,
    pollProgress: { start: 82, end: 92 },
  })
}

async function runQwenStoryboardIdentityEditGeneration(params: {
  job: Job<TaskJobData>
  userId: string
  baseModelKey: string
  editModelKey: string
  prompt: string
  aspectRatio: string
  baseReferenceImages: string[]
  directBaseReferenceImage?: string | null
  baseReferenceKind?: 'scene_asset' | 'panel_continuity' | null
  sceneReferenceImages: string[]
  sceneReferenceKind?: 'scene_asset' | 'panel_continuity' | null
  identityReferenceImages: string[]
  characterNames: string[]
  characterSlots?: Array<string | null | undefined>
}): Promise<string> {
  const directBaseReferenceImage = typeof params.directBaseReferenceImage === 'string'
    && params.directBaseReferenceImage.trim().length > 0
    ? params.directBaseReferenceImage
    : null
  const baseSource = directBaseReferenceImage || await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.baseModelKey,
    prompt: buildQwenStoryboardIdentityBasePrompt({
      prompt: params.prompt,
      characterNames: params.characterNames,
      characterSlots: params.characterSlots,
    }),
    options: {
      referenceImages: params.baseReferenceImages,
      aspectRatio: params.aspectRatio,
    },
    allowTaskExternalIdResume: false,
    pollProgress: { start: 30, end: 62 },
  })

  const editSlotCount = inferImageReferenceSlotCount(params.editModelKey)
  const editReferenceImages = await normalizeReferenceImagesForGeneration(
    [
      baseSource,
      ...params.identityReferenceImages,
      ...params.sceneReferenceImages,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, editSlotCount),
  )

  return await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.editModelKey,
    prompt: buildQwenStoryboardIdentityEditPrompt({
      prompt: params.prompt,
      characterNames: params.characterNames,
      characterSlots: params.characterSlots,
      hasSceneReference: params.sceneReferenceImages.length > 0,
      baseIsSceneReference: params.baseReferenceKind === 'scene_asset',
      baseIsPanelContinuityReference: params.baseReferenceKind === 'panel_continuity',
      sceneReferenceIsPanelContinuity: params.sceneReferenceKind === 'panel_continuity',
    }),
    options: {
      referenceImages: editReferenceImages,
      aspectRatio: params.aspectRatio,
    },
    allowTaskExternalIdResume: false,
    pollProgress: directBaseReferenceImage ? { start: 30, end: 90 } : { start: 62, end: 90 },
  })
}

export async function handlePanelImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('panelId missing')

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
  })

  if (!panel) throw new Error('Panel not found')

  const projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const requestedModelKey = pickFirstString(payload.imageModel, modelConfig.storyboardModel)
  if (!requestedModelKey) throw new Error('Storyboard model not configured')

  const candidateCount = clampCount(payload.candidateCount ?? payload.count, 1, 4, 1)
  const referenceBundle = buildPanelReferenceBundle({
    panel: {
      sketchImageUrl: panel.sketchImageUrl,
      characters: panel.characters,
      location: panel.location,
    },
    projectData,
  })
  const definitionAwarePlan = buildDefinitionAwareQwenStoryboardPlan({
    requestedModelKey,
    referenceBundle,
    aspectRatio: projectData.videoRatio,
    shotType: panel.shotType,
    description: panel.description,
  })
  const modelKey = definitionAwarePlan.modelKey
  const refs = definitionAwarePlan.referenceImages ?? await buildSinglePanelReferenceImages({
    panel: {
      storyboardId: panel.storyboardId,
      panelIndex: panel.panelIndex,
      sketchImageUrl: panel.sketchImageUrl,
      characters: panel.characters,
      location: panel.location,
    },
    projectData,
    modelKey,
    referenceBundle,
  })
  const preparedRefs = await preparePanelReferenceImages({
    refs,
    modelRoutingReason: definitionAwarePlan.reason,
  })
  const normalizedRefs = await normalizeReferenceImagesForGeneration(preparedRefs.refs)
  const baseIdentityEditPlan = definitionAwarePlan.identityEdit
  const identitySceneContinuityReference = baseIdentityEditPlan
    ? await findPanelSceneContinuityReference({
        panel: {
          id: panel.id,
          storyboardId: panel.storyboardId,
          panelIndex: panel.panelIndex,
          location: panel.location,
          characters: panel.characters,
          srtSegment: panel.srtSegment,
        },
      })
    : null
  const sanitizedSceneContinuityRef = identitySceneContinuityReference
    && referenceBundle.characterRefs.length < identitySceneContinuityReference.visibleCharacterCount
    ? await createSceneContinuityBackgroundReference(identitySceneContinuityReference.url)
    : null
  const identityEditPlan = baseIdentityEditPlan
    ? {
        ...baseIdentityEditPlan,
        sceneContinuityRef: sanitizedSceneContinuityRef || identitySceneContinuityReference?.url || null,
        sceneContinuityPanelId: identitySceneContinuityReference?.panelId || null,
        sceneContinuityPanelIndex: identitySceneContinuityReference?.panelIndex ?? null,
        reason: identitySceneContinuityReference
          ? `${baseIdentityEditPlan.reason}_with_panel_continuity`
          : baseIdentityEditPlan.reason,
      }
    : null
  const preparedIdentityRefs = identityEditPlan
    ? await preparePanelReferenceImages({
        refs: identityEditPlan.characterRefs,
        modelRoutingReason: identityEditPlan.reason,
      })
    : { refs: [] as string[], croppedReferenceCount: 0 }
  const useIdentitySceneRef = !!identityEditPlan?.sceneRef
    && (
      !!identityEditPlan.sceneContinuityRef
      || identityEditPlan.reason !== 'qwen_storyboard_tight_scene_one_character_identity_edit'
    )
  const identitySceneRefs = useIdentitySceneRef && identityEditPlan?.sceneRef ? [identityEditPlan.sceneRef] : []
  const identitySceneContinuityRefs = identityEditPlan?.sceneContinuityRef ? [identityEditPlan.sceneContinuityRef] : []
  const normalizedIdentityControlRefs = identityEditPlan
    ? await normalizeReferenceImagesForGeneration(uniqueStrings([
        ...preparedIdentityRefs.refs,
        ...identitySceneContinuityRefs,
        ...identitySceneRefs,
      ]))
    : []
  const shouldLoadEnabledImageModels = ENABLE_COORDINATED_MULTI_CHARACTER_GENERATION || !!identityEditPlan
  const enabledImageModelKeys = shouldLoadEnabledImageModels
    ? new Set(
        (await getEnabledUserModels(job.data.userId))
          .filter((model) => model.type === 'image')
          .map((model) => model.modelKey),
      )
    : new Set<string>()
  const coordinatedEditModelKey = ENABLE_COORDINATED_MULTI_CHARACTER_GENERATION
    ? selectCoordinatedEditModel({
        enabledImageModelKeys,
        defaultEditModel: modelConfig.editModel,
        requiredSlots: 1 + Math.max(0, referenceBundle.characterRefs.length - 1),
      })
    : null
  const coordinatedMultiCharacterMode = ENABLE_COORDINATED_MULTI_CHARACTER_GENERATION
    && referenceBundle.characterRefs.length >= MULTI_CHARACTER_COORDINATION_THRESHOLD
    && typeof modelConfig.editModel === 'string'
    && modelConfig.editModel.trim().length > 0
    && typeof coordinatedEditModelKey === 'string'
    && coordinatedEditModelKey.trim().length > 0
  const identityEditModelKey = identityEditPlan
    ? selectQwenStoryboardIdentityEditModel({
        enabledImageModelKeys,
        defaultEditModel: modelConfig.editModel,
        requiredSlots: identityEditPlan.requiredSlots,
        preferMultiImageEdit: !!identityEditPlan.sceneRef || !!identityEditPlan.sceneContinuityRef,
      })
    : null
  const qwenStoryboardIdentityEditMode = !!identityEditPlan
    && typeof identityEditModelKey === 'string'
    && identityEditModelKey.trim().length > 0
    && normalizedIdentityControlRefs.length > 0
  const effectiveModelKey = qwenStoryboardIdentityEditMode ? identityEditModelKey! : modelKey
  const effectiveRoutingReason = qwenStoryboardIdentityEditMode
    ? identityEditPlan!.reason
    : identityEditPlan
      ? `${identityEditPlan.reason}_fallback_text_to_image_no_edit_model`
      : definitionAwarePlan.reason
  const packetReferenceImages = qwenStoryboardIdentityEditMode ? normalizedIdentityControlRefs : normalizedRefs
  const isQwenStoryboardModel = isQwenStoryboardReferenceWorkflow(modelKey)

  const logger = createScopedLogger({
    module: 'worker.panel-image',
    action: 'panel_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  if (identityEditPlan && !qwenStoryboardIdentityEditMode) {
    logger.warn({
      message: 'qwen storyboard identity edit unavailable; falling back to text-to-image without character references',
      details: {
        panelId,
        requestedModelKey,
        baseModelKey: modelKey,
        requiredSlots: identityEditPlan.requiredSlots,
        identityEditModelKey,
        normalizedIdentityReferenceCount: normalizedIdentityControlRefs.length,
        modelRoutingReason: effectiveRoutingReason,
      },
    })
  }
  logger.info({
    message: 'panel image generation started',
    details: {
      panelId,
      requestedModelKey,
      modelKey,
      effectiveModelKey,
      modelRoutingReason: effectiveRoutingReason,
      candidateCount,
      coordinatedMultiCharacterMode,
      coordinatedEditModelKey,
      qwenStoryboardIdentityEditMode,
      identityEditModelKey,
      isQwenStoryboardModel,
      referenceImagesRawCount: refs.length,
      referenceImagesPreparedCount: preparedRefs.refs.length,
      croppedReferenceCount: preparedRefs.croppedReferenceCount,
      referenceImagesNormalizedCount: normalizedRefs.length,
      identitySceneReferenceCount: identitySceneRefs.length,
      identitySceneContinuityReferenceCount: identitySceneContinuityRefs.length,
      identitySceneContinuityPanelId: identityEditPlan?.sceneContinuityPanelId || null,
      identitySceneContinuityPanelIndex: identityEditPlan?.sceneContinuityPanelIndex ?? null,
      identitySceneContinuitySanitized: !!sanitizedSceneContinuityRef,
      identityReferenceImagesPreparedCount: preparedIdentityRefs.refs.length,
      identityCroppedReferenceCount: preparedIdentityRefs.croppedReferenceCount,
      identityReferenceImagesNormalizedCount: normalizedIdentityControlRefs.length,
      rawUrls: refs.map((u) => u.substring(0, 100)),
      preparedUrls: preparedRefs.refs.map((u) => u.substring(0, 100)),
      normalizedUrls: normalizedRefs.map((u) => u.substring(0, 100)),
      identitySceneUrls: identitySceneRefs.map((u) => u.substring(0, 100)),
      identitySceneContinuityUrls: identitySceneContinuityRefs.map((u) => u.substring(0, 100)),
      identityPreparedUrls: preparedIdentityRefs.refs.map((u) => u.substring(0, 100)),
      identityNormalizedUrls: normalizedIdentityControlRefs.map((u) => u.substring(0, 100)),
      panelCharacters: panel.characters,
      panelLocation: panel.location,
      artStyle: modelConfig.artStyle,
      artStylePrompt: getArtStylePrompt(modelConfig.artStyle, job.data.locale),
    },
  })

  const artStyle = getArtStylePrompt(modelConfig.artStyle, job.data.locale)
  const projectStyleAuthorityPrompt = buildProjectStyleAuthorityPrompt(artStyle)
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  const sanitizeForPrompt = (value: string | null | undefined) => sanitizePanelTextForVisibleCharacters({
    text: value,
    visibleCharacters: panelCharacters,
    projectCharacters: projectData.characters || [],
  })
  const promptContext = sanitizePromptContextForVisibleCharacters(buildPanelPromptContext({
    panel: {
      id: panel.id,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      imagePrompt: panel.imagePrompt,
      videoPrompt: panel.videoPrompt,
      location: panel.location,
      characters: panel.characters,
      srtSegment: panel.srtSegment,
      photographyRules: panel.photographyRules,
      actingNotes: panel.actingNotes,
    },
    projectData,
  }), sanitizeForPrompt)
  const contextJson = JSON.stringify(promptContext, null, 2)
  const promptSourceText = sanitizeForPrompt(panel.srtSegment || panel.imagePrompt || panel.description || '')
  const basePrompt = buildPanelPrompt({
    locale: job.data.locale,
    aspectRatio,
    styleText: artStyle || '与参考图风格一致',
    sourceText: promptSourceText,
    contextJson,
  })
  const prompt = buildPanelDefinitionAuthorityPrompt(basePrompt, panelCharacters)
  const imageGenerationPacket = buildPanelImageGenerationPacket({
    panel: {
      id: panel.id,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      imagePrompt: panel.imagePrompt,
      location: panel.location,
      characters: panel.characters,
      srtSegment: panel.srtSegment,
    },
    prompt,
    aspectRatio,
    requestedModelKey,
    resolvedModelKey: effectiveModelKey,
    modelRoutingReason: effectiveRoutingReason,
    referenceImages: packetReferenceImages,
  })
  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
    },
  })

  const candidates: string[] = []
  const candidateMediaIds: string[] = []
  const auditReports: PanelImageAuditResult[] = []

  for (let i = 0; i < candidateCount; i++) {
    await reportTaskProgress(job, 18 + Math.floor((i / Math.max(candidateCount, 1)) * 58), {
      stage: 'generate_panel_candidate',
      candidateIndex: i,
    })

    let source: string
    if (coordinatedMultiCharacterMode) {
      source = await runCoordinatedMultiCharacterGeneration({
        job,
        panel: {
          shotType: panel.shotType,
          cameraMove: panel.cameraMove,
        },
        userId: job.data.userId,
        baseModelKey: modelKey,
        defaultEditModel: modelConfig.editModel,
        coordinationModelKey: coordinatedEditModelKey!,
        prompt: appendProjectStyleAuthorityPrompt(prompt, projectStyleAuthorityPrompt),
        aspectRatio,
        referenceBundle,
        candidateCount,
      })
    } else if (qwenStoryboardIdentityEditMode && identityEditPlan && identityEditModelKey) {
      const directBaseReferenceImage = identityEditPlan.sceneContinuityRef
      const sceneReferenceImagesForEdit = identitySceneRefs
      source = await runQwenStoryboardIdentityEditGeneration({
        job,
        userId: job.data.userId,
        baseModelKey: modelKey,
        editModelKey: identityEditModelKey,
        prompt: appendProjectStyleAuthorityPrompt(prompt, projectStyleAuthorityPrompt),
        aspectRatio,
        baseReferenceImages: normalizedRefs,
        directBaseReferenceImage,
        baseReferenceKind: identityEditPlan.sceneContinuityRef
          ? 'panel_continuity'
          : null,
        sceneReferenceImages: sceneReferenceImagesForEdit,
        sceneReferenceKind: identityEditPlan.sceneRef
          ? 'scene_asset'
          : null,
        identityReferenceImages: preparedIdentityRefs.refs,
        characterNames: referenceBundle.characterRefs.map((item) => item.name),
        characterSlots: referenceBundle.characterRefs.map((item) => item.slot),
      })
    } else {
      const generationPrompt = isQwenStoryboardModel
          ? buildQwenStoryboardScenePrompt(prompt)
          : isQwenDefinitionAwareEditModel(modelKey)
            ? buildQwenEditStoryboardPrompt(prompt)
            : prompt
      const styledGenerationPrompt = appendProjectStyleAuthorityPrompt(generationPrompt, projectStyleAuthorityPrompt)
      source = await resolveImageSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId: modelKey,
        prompt: styledGenerationPrompt,
        options: {
          referenceImages: normalizedRefs,
          aspectRatio,
        },
      // 单个任务内会串行生成多候选，若允许按 task.externalId 续接会复用上一候选外部任务结果。
        allowTaskExternalIdResume: candidateCount === 1,
        pollProgress: { start: 30, end: 90 },
      })
    }

    const uploaded = await uploadImageSourceToCosWithMetadata(source, 'panel-candidate', `${panel.id}-${i}`)
    const cosKey = uploaded.key
    const audit = await auditGeneratedPanelImage({
      userId: job.data.userId,
      projectId: job.data.projectId,
      imageUrl: toSignedUrlIfCos(cosKey, 3600) || cosKey,
      expectedAspectRatio: aspectRatio,
      metadata: uploaded.metadata,
      packet: imageGenerationPacket,
      visionModel: modelConfig.analysisModel,
    })
    auditReports.push(audit)
    await reportTaskProgress(job, 90 + Math.floor((i / Math.max(candidateCount, 1)) * 4), {
      stage: 'audit_panel_candidate',
      candidateIndex: i,
      audit,
      panelImageGenerationPacket: imageGenerationPacket,
    })
    if (!audit.ok) {
      if (isNonBlockingPanelImageAuditFailure(audit)) {
        logger.warn({
          message: 'panel image audit failed; accepting generated candidate with audit report',
          details: {
            panelId,
            candidateIndex: i,
            auditCode: audit.code,
            auditMessage: audit.message,
            auditIssues: audit.issues,
            requestedModelKey,
            modelKey,
          },
        })
      } else {
        await recordPanelImageAuditFailure({
          taskId: job.data.taskId,
          packet: imageGenerationPacket,
          audit,
        })
        throw new Error(`${audit.code || 'PANEL_IMAGE_AUDIT_FAILED'}: ${audit.message || 'Generated image failed audit'}`)
      }
    }
    const media = await ensureMediaObjectFromStorageKey(cosKey, uploaded.metadata)
    candidates.push(cosKey)
    candidateMediaIds.push(media.id)
  }

  const isFirstGeneration = !panel.imageUrl
  const previousImageMedia = isFirstGeneration ? null : await resolveMediaRef(panel.imageMediaId, panel.imageUrl)

  await assertTaskActive(job, 'persist_panel_image')
  if (isFirstGeneration) {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        imageUrl: candidates[0] || null,
        imageMediaId: candidateMediaIds[0] || null,
        candidateImages: candidateCount > 1 ? JSON.stringify(candidates) : null,
      },
    })
  } else {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        previousImageUrl: panel.imageUrl,
        previousImageMediaId: previousImageMedia?.id || panel.imageMediaId || null,
        candidateImages: JSON.stringify(candidates),
      },
    })
  }

  return {
    panelId: panel.id,
    candidateCount: candidates.length,
    imageUrl: isFirstGeneration ? candidates[0] || null : null,
    panelImageGenerationPacket: imageGenerationPacket,
    panelImageAuditReports: auditReports,
  }
}
