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
  uploadImageSourceToCos,
} from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
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

const MULTI_CHARACTER_COORDINATION_THRESHOLD = 3
const COMFYUI_QWEN_STORYBOARD_MODEL = 'comfyui::baseimage/图片分镜/Qwen剧情分镜制作'
const COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL = `comfyui::${COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID}`
const COMFYUI_QWEN_SINGLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen单图编辑'
const COMFYUI_QWEN_DOUBLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen双图编辑'
const COMFYUI_QWEN_TRIPLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen三图编辑'
const COMFYUI_FLUX_MULTI_EDIT_MODEL = 'comfyui::baseimage/图片编辑/Flux2多图编辑'

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
      source_text: params.panel.srtSegment || '',
      photography_rules: parseJsonUnknown(params.panel.photographyRules),
      acting_notes: parseJsonUnknown(params.panel.actingNotes),
    },
    context: {
      character_appearances: characterContexts,
      location_reference: locationContext,
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

type PanelReferenceBundle = {
  sketchRef: string | null
  locationRef: string | null
  characterRefs: Array<{
    name: string
    appearance: string | null
    url: string
  }>
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
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
    '如果参考图内容与当前分镜文字冲突，必须以当前分镜文字为准，重新组织镜头、人物位置、动作和景别。',
    '禁止直接复刻上一张画面，禁止输出角色设定三视图、白底展示图、拼贴图或多角度角色表。',
  ].join('\n')
}

function buildQwenEditStoryboardPrompt(prompt: string): string {
  return [
    prompt,
    '',
    '参考图使用规则：第一张参考图优先作为场景/构图参考，后续参考图作为角色外貌、服装和身份参考。',
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

async function resolvePreviousPanelImageRef(params: {
  storyboardId: string
  panelIndex: number
}): Promise<string | null> {
  if (!params.storyboardId || params.panelIndex <= 0) return null

  const previousPanel = await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId: params.storyboardId,
      panelIndex: { lt: params.panelIndex },
      imageUrl: { not: null },
    },
    orderBy: { panelIndex: 'desc' },
    select: { imageUrl: true, linkedToNextPanel: true },
  })

  if (!previousPanel?.linkedToNextPanel) return null
  return toSignedUrlIfCos(previousPanel?.imageUrl, 3600)
}

async function buildQwenStoryboardSceneReferenceImages(params: {
  panel: {
    storyboardId: string
    panelIndex: number
  }
  referenceBundle: PanelReferenceBundle
}): Promise<string[]> {
  const previousPanelRef = await resolvePreviousPanelImageRef({
    storyboardId: params.panel.storyboardId,
    panelIndex: params.panel.panelIndex,
  })

  return uniqueStrings([
    params.referenceBundle.sketchRef,
    params.referenceBundle.locationRef,
    previousPanelRef,
  ])
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
      panel: {
        storyboardId: params.panel.storyboardId,
        panelIndex: params.panel.panelIndex,
      },
      referenceBundle: params.referenceBundle,
    })

    return sceneRefs
  }

  return await collectPanelReferenceImages(params.projectData, params.panel)
}

function buildDefinitionAwareQwenStoryboardPlan(params: {
  requestedModelKey: string
  referenceBundle: PanelReferenceBundle
}): { modelKey: string; referenceImages: string[] | null; reason: string | null } {
  if (!isQwenStoryboardReferenceWorkflow(params.requestedModelKey)) {
    return { modelKey: params.requestedModelKey, referenceImages: null, reason: null }
  }

  const sceneRef = params.referenceBundle.sketchRef || params.referenceBundle.locationRef
  const characterRefs = params.referenceBundle.characterRefs.map((item) => item.url)

  if (characterRefs.length >= MULTI_CHARACTER_COORDINATION_THRESHOLD) {
    return {
      modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
      referenceImages: [],
      reason: 'qwen_storyboard_multi_character_base',
    }
  }

  if (characterRefs.length === 2) {
    return {
      modelKey: sceneRef ? COMFYUI_QWEN_TRIPLE_EDIT_MODEL : COMFYUI_QWEN_DOUBLE_EDIT_MODEL,
      referenceImages: uniqueStrings(sceneRef ? [sceneRef, ...characterRefs] : characterRefs),
      reason: sceneRef ? 'qwen_storyboard_scene_two_characters' : 'qwen_storyboard_two_characters',
    }
  }

  if (characterRefs.length === 1) {
    return {
      modelKey: sceneRef ? COMFYUI_QWEN_DOUBLE_EDIT_MODEL : COMFYUI_QWEN_SINGLE_EDIT_MODEL,
      referenceImages: uniqueStrings(sceneRef ? [sceneRef, characterRefs[0]] : [characterRefs[0]]),
      reason: sceneRef ? 'qwen_storyboard_scene_one_character' : 'qwen_storyboard_one_character',
    }
  }

  return {
    modelKey: COMFYUI_FLUX_TEXT_TO_IMAGE_MODEL,
    referenceImages: [],
    reason: 'qwen_storyboard_text_only_scene',
  }
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
  const normalizedRefs = await normalizeReferenceImagesForGeneration(refs)
  const enabledImageModels = await getEnabledUserModels(job.data.userId)
  const enabledImageModelKeys = new Set(
    enabledImageModels
      .filter((model) => model.type === 'image')
      .map((model) => model.modelKey),
  )
  const coordinatedEditModelKey = selectCoordinatedEditModel({
    enabledImageModelKeys,
    defaultEditModel: modelConfig.editModel,
    requiredSlots: 1 + Math.max(0, referenceBundle.characterRefs.length - 1),
  })
  const coordinatedMultiCharacterMode = referenceBundle.characterRefs.length >= MULTI_CHARACTER_COORDINATION_THRESHOLD
    && typeof modelConfig.editModel === 'string'
    && modelConfig.editModel.trim().length > 0
    && typeof coordinatedEditModelKey === 'string'
    && coordinatedEditModelKey.trim().length > 0
  const isQwenStoryboardModel = isQwenStoryboardReferenceWorkflow(modelKey)

  const logger = createScopedLogger({
    module: 'worker.panel-image',
    action: 'panel_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'panel image generation started',
    details: {
      panelId,
      requestedModelKey,
      modelKey,
      modelRoutingReason: definitionAwarePlan.reason,
      candidateCount,
      coordinatedMultiCharacterMode,
      coordinatedEditModelKey,
      isQwenStoryboardModel,
      referenceImagesRawCount: refs.length,
      referenceImagesNormalizedCount: normalizedRefs.length,
      rawUrls: refs.map((u) => u.substring(0, 100)),
      normalizedUrls: normalizedRefs.map((u) => u.substring(0, 100)),
      panelCharacters: panel.characters,
      panelLocation: panel.location,
      artStyle: modelConfig.artStyle,
    },
  })

  const artStyle = getArtStylePrompt(modelConfig.artStyle, job.data.locale)
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio
  const promptContext = buildPanelPromptContext({
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
  })
  const contextJson = JSON.stringify(promptContext, null, 2)
  const prompt = buildPanelPrompt({
    locale: job.data.locale,
    aspectRatio,
    styleText: artStyle || '与参考图风格一致',
    sourceText: panel.srtSegment || panel.description || '',
    contextJson,
  })
  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
    },
  })

  const candidates: string[] = []

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
        prompt,
        aspectRatio,
        referenceBundle,
        candidateCount,
      })
    } else {
      const generationPrompt = isQwenStoryboardModel
        ? buildQwenStoryboardScenePrompt(prompt)
        : isQwenDefinitionAwareEditModel(modelKey)
          ? buildQwenEditStoryboardPrompt(prompt)
          : prompt
      source = await resolveImageSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId: modelKey,
        prompt: generationPrompt,
        options: {
          referenceImages: normalizedRefs,
          aspectRatio,
        },
      // 单个任务内会串行生成多候选，若允许按 task.externalId 续接会复用上一候选外部任务结果。
        allowTaskExternalIdResume: candidateCount === 1,
        pollProgress: { start: 30, end: 90 },
      })
    }

    const cosKey = await uploadImageSourceToCos(source, 'panel-candidate', `${panel.id}-${i}`)
    candidates.push(cosKey)
  }

  const isFirstGeneration = !panel.imageUrl

  await assertTaskActive(job, 'persist_panel_image')
  if (isFirstGeneration) {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        imageUrl: candidates[0] || null,
        candidateImages: candidateCount > 1 ? JSON.stringify(candidates) : null,
      },
    })
  } else {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        previousImageUrl: panel.imageUrl,
        candidateImages: JSON.stringify(candidates),
      },
    })
  }

  return {
    panelId: panel.id,
    candidateCount: candidates.length,
    imageUrl: isFirstGeneration ? candidates[0] || null : null,
  }
}
