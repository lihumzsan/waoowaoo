import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenProviderMessageContent } from '@/lib/ai-providers/shared/llm-support'
import { buildDefaultTaskBillingInfo, withTextBilling } from '@/lib/billing'
import { buildImageBillingPayloadFromUserConfig, getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { encodeImageUrls, decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { submitAssetGenerateTask } from '@/lib/assets/services/asset-actions'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import { getSignedUrl } from '@/lib/storage'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO } from '@/lib/edit-script/style-preview-image-constants'
import type { Locale } from '@/i18n/routing'
import {
  normalizeDirectorDecoupage,
  normalizeEditAssetRequirements,
  normalizeEditScriptStructure,
} from './normalize'
import type {
  EditCinematographyShotPlanPayload,
  EditDirectorDecoupagePayload,
  EditScriptAssetGenerationPayload,
  EditScriptAssetGenerationTask,
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
  EditScreenplayPayload,
  EditScriptVideoRatio,
  EditStylePreviewGenerationPayload,
  EditStylePreviewCanonicalKey,
  EditStylePreviewKey,
  EditStylePreviewOption,
  EditStylePreviewPayload,
  EditStylePreviewStatus,
  EditScriptPayload,
  EditScriptStyleBible,
  EditScriptShot,
} from './types'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'
import {
  editCinematographyShotPlanSchema,
  editStylePreviewKeySchema,
  editStylePreviewOptionsSchema,
  EDIT_STYLE_PREVIEW_KEYS,
  EDIT_STYLE_PREVIEW_MAX_COUNT,
  editScriptStyleBibleSchema,
} from './types'
import { designEditAssetRequirements } from './asset-design'
import { buildAssetSnapshots } from './storyboard-consistency/source-snapshot'
import {
  buildEditFirstDurationGuidance,
  buildEditFirstStructuredUserPrompt,
  requireEditFirstDurationSpecFromPrompt,
  resolveEditFirstDurationSpec,
  stripEditFirstStructuredParameters,
  type EditFirstDurationTier,
} from './duration-tier'

interface GenerateEditScriptInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly screenplayId?: string
  readonly videoRatio?: '9:16' | '16:9' | '21:9'
  readonly onGenerationStepPersisted?: (step: EditScriptGenerationStep) => Promise<void>
}

interface GenerateEditScreenplayInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly prompt: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
}

interface ReviseEditScreenplayInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly screenplayId?: string
  readonly revisionInstruction: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
}

interface GenerateEditStylePreviewsInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly screenplayId?: string
  readonly styleDirection?: string
  readonly count?: number
}

interface ConfirmEditStylePreviewInput {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly stylePreviewId: string
  readonly aspectRatio: '9:16' | '16:9' | '21:9'
}

interface GenerateEditDirectorDecoupageInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly screenplayId?: string
}

interface GenerateEditCinematographyShotPlanInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly editScriptId?: string
}

interface GenerateEditScriptAssetsInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly editScriptId?: string
  readonly requirementId?: string
}

interface UpdateEditScriptVideoBlockPromptInput {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly blockIndex: number
  readonly prompt: string
}

interface UpdateEditScriptAssetRequirementDescriptionInput {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly requirementId: string
  readonly description: string
}

type PromptStepId =
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_DIRECTOR_DECOUPAGE
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN

type EditScriptGenerationStage =
  | 'edit_script_prepare'
  | 'edit_script_style_bible'
  | 'edit_script_primary'
  | 'edit_script_asset_extract'
  | 'edit_script_video_prompt'

const EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS = 1024

interface EditScriptGenerationStep {
  readonly stage: EditScriptGenerationStage
  readonly stageLabel: string
  readonly progress: number
}

interface PartialVideoBlock {
  readonly kind: 'single' | 'group'
  readonly shotNumbers: readonly number[]
  readonly gridMode?: '2x2' | '3x3'
  readonly reason: string
}

interface PersistedEditScriptRequirement {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly shotIndexes: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScript {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly screenplayText: string | null
  readonly title: string
  readonly logline: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly shotsJson: Prisma.JsonValue
  readonly videoBlocksJson: Prisma.JsonValue | null
  readonly requirements: readonly PersistedEditScriptRequirement[]
}

interface PersistedEditStylePreview {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editScreenplayId: string
  readonly styleKey: string
  readonly aspectRatio: string
  readonly title: string
  readonly summary: string
  readonly styleBibleJson: Prisma.JsonValue
  readonly imagePrompt: string
  readonly imageKey: string | null
  readonly status: string
  readonly taskId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScreenplay {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly screenplayText: string
  readonly status: string
  readonly stylePreviews?: readonly PersistedEditStylePreview[]
}

interface PersistedEditDirectorDecoupage {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editScreenplayId: string
  readonly userPrompt: string
  readonly decoupageJson: Prisma.JsonValue
  readonly status: string
  readonly editScreenplay?: PersistedEditScreenplay
}

interface PersistedEditCinematographyShotPlan {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly shotPlanJson: Prisma.JsonValue
  readonly status: string
}

interface ExistingAssetRef {
  readonly id: string
  readonly previewImageUrl: string | null
  readonly hasOutput: boolean
  readonly taskTargetType: 'CharacterAppearance' | 'LocationImage'
  readonly taskTargetId: string
  readonly spatialProfileJson?: unknown | null
  readonly spatialProfileStatus?: LocationSpatialProfileStatus | null
  readonly spatialProfileError?: string | null
  readonly spatialProfileAnalyzedAt?: Date | null
  readonly spatialProfileModel?: string | null
}

const EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY = 'screenplay_ready'
const EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_GENERATING = 'style_preview_generating'
const EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_READY = 'style_preview_ready'
const EDIT_SCREENPLAY_STATUS_FAILED = 'failed'
const EDIT_SCRIPT_ASSET_REVIEW_PENDING = 'pending'
const EDIT_SCRIPT_ASSET_REVIEW_APPROVED = 'approved'

function resolveStylePreviewCount(value: number | undefined): number {
  if (value === undefined) return EDIT_STYLE_PREVIEW_MAX_COUNT
  if (!Number.isInteger(value) || value < 1 || value > EDIT_STYLE_PREVIEW_MAX_COUNT) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_STYLE_PREVIEW_COUNT_INVALID',
      message: `Style preview count must be an integer from 1 to ${String(EDIT_STYLE_PREVIEW_MAX_COUNT)}`,
    })
  }
  return value
}

function normalizeStylePreviewStatus(value: string): EditStylePreviewStatus {
  if (value === 'generating' || value === 'completed' || value === 'confirmed' || value === 'failed') return value
  return 'pending'
}

function normalizeAssetReviewStatus(value: string): 'pending' | 'approved' {
  return value === EDIT_SCRIPT_ASSET_REVIEW_APPROVED ? 'approved' : 'pending'
}

function normalizeStylePreviewKey(value: string): EditStylePreviewKey {
  const parsed = editStylePreviewKeySchema.safeParse(value)
  if (!parsed.success) throw new Error(`EDIT_STYLE_PREVIEW_KEY_INVALID:${value}`)
  return parsed.data as EditStylePreviewKey
}

function normalizeStylePreviewAspectRatio(value: string): EditScriptVideoRatio {
  if (value === '9:16' || value === '16:9' || value === '21:9') return value
  throw new Error(`EDIT_STYLE_PREVIEW_ASPECT_RATIO_INVALID:${value}`)
}

function stylePreviewKeyGeneration(value: string): number | null {
  const parsed = editStylePreviewKeySchema.safeParse(value)
  if (!parsed.success) return null
  const parts = parsed.data.split('_')
  if (parts.length === 2) return 1
  const generation = Number(parts[2])
  return Number.isInteger(generation) && generation > 1 ? generation : null
}

function resolveNextStylePreviewGeneration(existingKeys: readonly string[]): number {
  const generations = existingKeys.flatMap((key) => {
    const generation = stylePreviewKeyGeneration(key)
    return generation === null ? [] : [generation]
  })
  return generations.length > 0 ? Math.max(...generations) + 1 : 1
}

function buildStylePreviewPersistenceKey(
  canonicalKey: EditStylePreviewCanonicalKey,
  generation: number,
): EditStylePreviewKey {
  if (generation === 1) return canonicalKey
  return `${canonicalKey}_${generation}` as EditStylePreviewKey
}

function resolveStylePreviewImageModel(config: Awaited<ReturnType<typeof getProjectModelConfig>>): string {
  if (config.storyboardModel) return config.storyboardModel
  throw new ApiError('INVALID_PARAMS', {
    code: 'PROJECT_STORYBOARD_MODEL_REQUIRED',
    message: 'Project storyboard image model is required before edit style preview generation',
  })
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function parseOptionalStyleBibleJson(value: Prisma.JsonValue | null): EditScriptStyleBible | null {
  if (value === null) return null
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) {
    throw new Error('EDIT_SCRIPT_STYLE_BIBLE_INVALID')
  }
  return parsed.data.styleBible
}

function parseRequiredStyleBibleJson(value: Prisma.JsonValue | null): EditScriptStyleBible {
  const styleBible = parseOptionalStyleBibleJson(value)
  if (!styleBible) throw new Error('EDIT_SCRIPT_STYLE_BIBLE_REQUIRED')
  return styleBible
}

function mapPersistedStylePreview(preview: PersistedEditStylePreview): EditStylePreviewPayload {
  return {
    id: preview.id,
    projectId: preview.projectId,
    episodeId: preview.episodeId,
    screenplayId: preview.editScreenplayId,
    styleKey: normalizeStylePreviewKey(preview.styleKey),
    aspectRatio: normalizeStylePreviewAspectRatio(preview.aspectRatio),
    title: preview.title,
    summary: preview.summary,
    styleBible: parseRequiredStyleBibleJson(preview.styleBibleJson),
    gridImagePrompt: preview.imagePrompt,
    imageKey: preview.imageKey,
    imageUrl: preview.imageKey ? getSignedUrl(preview.imageKey, 7 * 24 * 3600) : null,
    status: normalizeStylePreviewStatus(preview.status),
    taskId: preview.taskId,
    errorMessage: preview.errorMessage,
  }
}

function parseDirectorDecoupageJson(value: Prisma.JsonValue): ReturnType<typeof normalizeDirectorDecoupage> {
  return normalizeDirectorDecoupage(value)
}

function parseCinematographyShotPlanJson(value: Prisma.JsonValue): Omit<EditCinematographyShotPlanPayload, 'id' | 'projectId' | 'episodeId' | 'editScriptId' | 'status'> {
  const parsed = editCinematographyShotPlanSchema.parse(value)
  return {
    shots: parsed.shots.map((shot) => ({
      shotNumber: shot.shotNumber,
      shotScale: shot.shotScale.trim(),
      lens: shot.lens.trim(),
      depthOfField: shot.depthOfField.trim(),
      cameraPosition: shot.cameraPosition.trim(),
      cameraHeight: shot.cameraHeight.trim(),
      cameraAngle: shot.cameraAngle.trim(),
      movement: shot.movement.trim(),
      composition: shot.composition.trim(),
      lighting: shot.lighting.trim(),
      axisAndEyeline: shot.axisAndEyeline.trim(),
      continuityIn: shot.continuityIn.trim(),
      continuityOut: shot.continuityOut.trim(),
    })).sort((left, right) => left.shotNumber - right.shotNumber),
    hardBans: parsed.hardBans.map((item) => item.trim()),
  }
}

function styleBibleToJsonValue(styleBible: EditScriptStyleBible): Prisma.InputJsonValue {
  return styleBible as unknown as Prisma.InputJsonValue
}

function assertLocale(value: Locale): Locale {
  return value
}

function buildRevisedEditScreenplayUserPrompt(input: {
  readonly locale: Locale
  readonly originalPrompt: string
  readonly revisionInstruction: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
}): string {
  const normalizedOriginal = stripEditFirstStructuredParameters(input.originalPrompt)
  const normalizedInstruction = input.revisionInstruction.trim()
  const spec = resolveEditFirstDurationSpec(input.durationTier)
  if (input.locale === 'en') {
    return [
      normalizedOriginal,
      '',
      `Revision instruction: ${normalizedInstruction}`,
      `Structured edit-first parameters: duration tier ${spec.tier} (${spec.enLabel}, around ${String(spec.targetSeconds)} seconds); final aspect ratio ${input.aspectRatio}.`,
    ].join('\n')
  }
  return [
    normalizedOriginal,
    '',
    `剧本修改要求：${normalizedInstruction}`,
    `剪辑先行结构化参数：时长档位 ${spec.tier}（${spec.zhLabel}，约 ${String(spec.targetSeconds)} 秒）；最终画面比例 ${input.aspectRatio}。`,
  ].join('\n')
}

function resolveTextModel(config: Awaited<ReturnType<typeof getProjectModelConfig>>): string {
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit-first script generation',
    })
  }
  return config.analysisModel
}

async function runPromptStep(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly promptId: PromptStepId
  readonly variables: Record<string, string>
  readonly stepTitle: string
  readonly stepIndex: number
  readonly stepTotal: number
}): Promise<Record<string, unknown>> {
  const finalPromptContent = buildAiPromptContent({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
    cacheVariableKeys: Object.keys(input.variables),
    minCacheChars: EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS,
  })
  const finalPrompt = flattenProviderMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const action = input.promptId
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.4,
    projectId: input.projectId,
    action,
    meta: {
      stepId: action,
      stepTitle: input.stepTitle,
      stepIndex: input.stepIndex,
      stepTotal: input.stepTotal,
    },
  })

  const completion = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    { projectId: input.projectId, action, metadata: { promptId: input.promptId } },
    runCompletion,
  )
  if (!completion.text.trim()) {
    throw new Error(`EDIT_SCRIPT_PROMPT_EMPTY:${input.promptId}`)
  }
  return safeParseJsonObject(completion.text)
}

async function runPromptTextStep(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly promptId: PromptStepId
  readonly variables: Record<string, string>
  readonly stepTitle: string
  readonly stepIndex: number
  readonly stepTotal: number
}): Promise<string> {
  const finalPromptContent = buildAiPromptContent({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
    cacheVariableKeys: Object.keys(input.variables),
    minCacheChars: EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS,
  })
  const finalPrompt = flattenProviderMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const action = input.promptId
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.5,
    projectId: input.projectId,
    action,
    meta: {
      stepId: action,
      stepTitle: input.stepTitle,
      stepIndex: input.stepIndex,
      stepTotal: input.stepTotal,
    },
  })

  const completion = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    { projectId: input.projectId, action, metadata: { promptId: input.promptId } },
    runCompletion,
  )
  const text = completion.text.trim()
  if (!text) {
    throw new Error(`EDIT_SCRIPT_PROMPT_EMPTY:${input.promptId}`)
  }
  return text
}

async function generateEditStylePreviewOptions(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly userPrompt: string
  readonly screenplayText: string
  readonly durationGuidance: string
  readonly styleDirection: string
  readonly count: number
}): Promise<readonly EditStylePreviewOption[]> {
  const raw = await runPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model: input.model,
    locale: input.locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS,
    variables: {
      user_request: input.userPrompt,
      screenplay_text: input.screenplayText,
      duration_guidance: input.durationGuidance,
      style_direction: input.styleDirection,
      style_preview_count: String(input.count),
    },
    stepTitle: 'Edit style preview options',
    stepIndex: 2,
    stepTotal: 2,
  })
  const parsed = editStylePreviewOptionsSchema.parse(raw).stylePreviews
  if (parsed.length !== input.count) {
    throw new Error(`EDIT_STYLE_PREVIEW_COUNT_MISMATCH:expected=${String(input.count)}:actual=${String(parsed.length)}`)
  }
  const byKey = new Map(parsed.map((preview) => [preview.styleKey, preview]))
  return EDIT_STYLE_PREVIEW_KEYS.slice(0, input.count).map((key) => {
    const preview = byKey.get(key)
    if (!preview) throw new Error(`EDIT_STYLE_PREVIEW_OPTION_MISSING:${key}`)
    return preview
  })
}

function readShotNumbers(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' && Number.isInteger(item) ? item : null))
    .filter((item): item is number => item !== null && item > 0)
}

function isEditAssetKind(value: string): value is EditAssetKind {
  return value === 'character' || value === 'location'
}

function normalizeStoredStatus(value: string): EditAssetStatus {
  if (value === 'pending' || value === 'generating' || value === 'completed' || value === 'failed') {
    return value
  }
  return 'failed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseShotsJson(value: Prisma.JsonValue): EditScriptShot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): EditScriptShot[] => {
    if (!isRecord(item)) return []
    return [{
      shotNumber: Number(item.shotNumber),
      durationSec: Number(item.durationSec),
      dramaticPurpose: String(item.dramaticPurpose ?? ''),
      visibleAction: String(item.visibleAction ?? ''),
      audienceFocus: String(item.audienceFocus ?? ''),
      viewpoint: String(item.viewpoint ?? ''),
      revealPlan: String(item.revealPlan ?? ''),
      performanceBeat: String(item.performanceBeat ?? ''),
      continuityIn: String(item.continuityIn ?? ''),
      continuityOut: String(item.continuityOut ?? ''),
      charactersAndScene: String(item.charactersAndScene ?? ''),
      sound: String(item.sound ?? ''),
    }]
  })
}

function parseVideoBlocksJson(value: Prisma.JsonValue | null, shots: readonly EditScriptShot[]) {
  if (!Array.isArray(value) || value.length === 0) return []
  return normalizeVideoBlockPlanResponse({
    response: { items: value },
    allShotNumbers: shots.map((shot) => shot.shotNumber),
    shots,
    enforceSingleMinDuration: false,
  }).items
}

async function resolveCharacterAsset(projectId: string, targetId: string | null): Promise<ExistingAssetRef | null> {
  if (!targetId) return null
  const character = await prisma.projectCharacter.findFirst({
    where: { id: targetId, projectId },
    select: {
      id: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        take: 1,
        select: {
          id: true,
          imageUrl: true,
          imageMediaId: true,
          imageUrls: true,
        },
      },
    },
  })
  const appearance = character?.appearances[0]
  if (!character || !appearance) return null
  const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'editScript.character.imageUrls')
  const previewImageUrl = appearance.imageUrl || imageUrls[0] || null
  return {
    id: character.id,
    previewImageUrl,
    hasOutput: Boolean(appearance.imageMediaId || previewImageUrl),
    taskTargetType: 'CharacterAppearance',
    taskTargetId: appearance.id,
  }
}

async function resolveLocationAsset(projectId: string, targetId: string | null): Promise<ExistingAssetRef | null> {
  if (!targetId) return null
  const location = await prisma.projectLocation.findFirst({
    where: { id: targetId, projectId },
    select: {
      id: true,
      selectedImageId: true,
      images: {
        orderBy: { imageIndex: 'asc' },
        select: {
          id: true,
          imageUrl: true,
          imageMediaId: true,
          isSelected: true,
          spatialProfileJson: true,
          spatialProfileStatus: true,
          spatialProfileError: true,
          spatialProfileAnalyzedAt: true,
          spatialProfileModel: true,
        },
      },
    },
  })
  const image = location?.images.find((item) => item.id === location.selectedImageId)
    ?? location?.images.find((item) => item.isSelected)
    ?? location?.images.find((item) => Boolean(item.imageUrl))
    ?? location?.images[0]
    ?? null
  if (!location || !image) return null
  return {
    id: location.id,
    previewImageUrl: image.imageUrl || null,
    hasOutput: Boolean(image.imageMediaId || image.imageUrl),
    taskTargetType: 'LocationImage',
    taskTargetId: location.id,
    spatialProfileJson: image.spatialProfileJson ?? null,
    spatialProfileStatus: image.spatialProfileStatus as LocationSpatialProfileStatus | null,
    spatialProfileError: image.spatialProfileError ?? null,
    spatialProfileAnalyzedAt: image.spatialProfileAnalyzedAt ?? null,
    spatialProfileModel: image.spatialProfileModel ?? null,
  }
}

async function resolveRequirementAsset(projectId: string, requirement: PersistedEditScriptRequirement): Promise<ExistingAssetRef | null> {
  if (requirement.kind === 'character') return resolveCharacterAsset(projectId, requirement.targetId)
  if (requirement.kind === 'location') return resolveLocationAsset(projectId, requirement.targetId)
  return null
}

async function resolveAssetTaskFailure(input: {
  readonly projectId: string
  readonly taskTargetType: ExistingAssetRef['taskTargetType']
  readonly taskTargetId: string
}): Promise<string | null> {
  const task = await prisma.task.findFirst({
    where: {
      projectId: input.projectId,
      targetType: input.taskTargetType,
      targetId: input.taskTargetId,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      status: true,
      errorMessage: true,
      errorCode: true,
    },
  })
  if (task?.status !== 'failed') return null
  return task.errorMessage || task.errorCode || 'Asset generation failed'
}

async function mapPersistedEditScript(script: PersistedEditScript): Promise<EditScriptPayload> {
  const requirements = await Promise.all(script.requirements.map(async (requirement): Promise<EditAssetRequirement> => {
    const resolvedAsset = await resolveRequirementAsset(script.projectId, requirement)
    const storedStatus = normalizeStoredStatus(requirement.status)
    const taskFailure = resolvedAsset
      ? await resolveAssetTaskFailure({
        projectId: script.projectId,
        taskTargetType: resolvedAsset.taskTargetType,
        taskTargetId: resolvedAsset.taskTargetId,
      })
      : null
    const status = taskFailure ? 'failed' : resolvedAsset?.hasOutput ? 'completed' : storedStatus
    return {
      id: requirement.id,
      kind: isEditAssetKind(requirement.kind) ? requirement.kind : 'character',
      name: requirement.name,
      description: requirement.description,
      shotNumbers: readShotNumbers(requirement.shotIndexes),
      status,
      targetId: requirement.targetId,
      taskTargetType: resolvedAsset?.taskTargetType ?? null,
      taskTargetId: resolvedAsset?.taskTargetId ?? null,
      errorMessage: status === 'failed' ? taskFailure || requirement.errorMessage : null,
      previewImageUrl: resolvedAsset?.previewImageUrl ?? null,
      spatialProfileJson: resolvedAsset?.spatialProfileJson ?? null,
      spatialProfileStatus: resolvedAsset?.spatialProfileStatus ?? null,
      spatialProfileError: resolvedAsset?.spatialProfileError ?? null,
      spatialProfileAnalyzedAt: resolvedAsset?.spatialProfileAnalyzedAt ?? null,
      spatialProfileModel: resolvedAsset?.spatialProfileModel ?? null,
    }
  }))

  const shots = parseShotsJson(script.shotsJson)
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    userPrompt: script.userPrompt,
    styleBible: parseOptionalStyleBibleJson(script.styleBibleJson),
    screenplayText: script.screenplayText,
    title: script.title,
    logline: script.logline,
    durationSec: script.durationSec,
    shotCount: script.shotCount,
    status: script.status,
    assetReviewStatus: normalizeAssetReviewStatus(script.assetReviewStatus),
    shots,
    videoBlocks: parseVideoBlocksJson(script.videoBlocksJson, shots),
    requirements,
  }
}

function mapPersistedEditScreenplay(screenplay: PersistedEditScreenplay): EditScreenplayPayload {
  return {
    id: screenplay.id,
    projectId: screenplay.projectId,
    episodeId: screenplay.episodeId,
    userPrompt: screenplay.userPrompt,
    styleBible: parseOptionalStyleBibleJson(screenplay.styleBibleJson),
    stylePreviews: (screenplay.stylePreviews ?? []).map(mapPersistedStylePreview),
    screenplayText: screenplay.screenplayText,
    status: screenplay.status,
  }
}

function mapPersistedEditDirectorDecoupage(decoupage: PersistedEditDirectorDecoupage): EditDirectorDecoupagePayload {
  const parsed = parseDirectorDecoupageJson(decoupage.decoupageJson)
  const styleBible = decoupage.editScreenplay
    ? parseRequiredStyleBibleJson(decoupage.editScreenplay.styleBibleJson)
    : parseRequiredStyleBibleJson(null)
  return {
    id: decoupage.id,
    projectId: decoupage.projectId,
    episodeId: decoupage.episodeId,
    screenplayId: decoupage.editScreenplayId,
    userPrompt: decoupage.userPrompt,
    styleBible,
    screenplayText: decoupage.editScreenplay?.screenplayText ?? '',
    status: decoupage.status,
    shots: parsed.shots,
    hardBans: parsed.hardBans,
  }
}

function mapPersistedEditCinematographyShotPlan(plan: PersistedEditCinematographyShotPlan): EditCinematographyShotPlanPayload {
  const parsed = parseCinematographyShotPlanJson(plan.shotPlanJson)
  return {
    id: plan.id,
    projectId: plan.projectId,
    episodeId: plan.episodeId,
    editScriptId: plan.editScriptId,
    status: plan.status,
    shots: parsed.shots,
    hardBans: parsed.hardBans,
  }
}

async function getPersistedEditScript(projectId: string, episodeId: string, editScriptId?: string): Promise<PersistedEditScript | null> {
  return await prisma.projectEditScript.findFirst({
    where: {
      projectId,
      episodeId,
      ...(editScriptId ? { id: editScriptId } : {}),
    },
    include: {
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
  })
}

async function getPersistedEditScreenplay(projectId: string, episodeId: string, screenplayId?: string): Promise<PersistedEditScreenplay | null> {
  return await prisma.projectEditScreenplay.findFirst({
    where: {
      projectId,
      episodeId,
      ...(screenplayId ? { id: screenplayId } : {}),
    },
    include: {
      stylePreviews: {
        orderBy: [
          { createdAt: 'asc' },
          { styleKey: 'asc' },
        ],
      },
    },
  })
}

async function getPersistedEditDirectorDecoupage(projectId: string, episodeId: string): Promise<PersistedEditDirectorDecoupage | null> {
  return await prisma.projectEditDirectorDecoupage.findFirst({
    where: {
      projectId,
      episodeId,
    },
    include: {
      editScreenplay: true,
    },
  })
}

async function getPersistedEditCinematographyShotPlan(projectId: string, episodeId: string, editScriptId?: string): Promise<PersistedEditCinematographyShotPlan | null> {
  return await prisma.projectEditCinematographyShotPlan.findFirst({
    where: {
      projectId,
      episodeId,
      ...(editScriptId ? { editScriptId } : {}),
    },
  })
}

async function resolveReadyEditScreenplay(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly screenplayId?: string
}): Promise<PersistedEditScreenplay> {
  const screenplay = await getPersistedEditScreenplay(input.projectId, input.episodeId, input.screenplayId)
  if (!screenplay) throw new Error('EDIT_SCREENPLAY_REQUIRED')
  if (screenplay.status !== 'ready' || !screenplay.screenplayText.trim()) {
    throw new Error(`EDIT_SCREENPLAY_NOT_READY:${screenplay.id}`)
  }
  return screenplay
}

async function resolveReadyEditDirectorDecoupage(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<PersistedEditDirectorDecoupage> {
  const decoupage = await getPersistedEditDirectorDecoupage(input.projectId, input.episodeId)
  if (!decoupage) throw new Error('EDIT_DIRECTOR_DECOUPAGE_REQUIRED')
  if (decoupage.status !== 'ready') throw new Error(`EDIT_DIRECTOR_DECOUPAGE_NOT_READY:${decoupage.id}`)
  parseDirectorDecoupageJson(decoupage.decoupageJson)
  return decoupage
}

export async function resolveEditDirectorDecoupageTaskTarget(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly screenplayId?: string
}): Promise<{ readonly episodeId: string; readonly screenplayId: string }> {
  const screenplay = await resolveReadyEditScreenplay(input)
  return {
    episodeId: screenplay.episodeId,
    screenplayId: screenplay.id,
  }
}

export async function resolveEditCinematographyShotPlanTaskTarget(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId?: string
}): Promise<{ readonly episodeId: string; readonly editScriptId: string }> {
  const editScript = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!editScript) throw new ApiError('NOT_FOUND')
  if (editScript.status !== 'ready') {
    throw new Error(`EDIT_SCRIPT_NOT_READY:${editScript.id}`)
  }
  return {
    episodeId: editScript.episodeId,
    editScriptId: editScript.id,
  }
}

async function markEditScriptGenerating(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible
  readonly screenplayText: string
  readonly initialDurationSeconds: number
}): Promise<void> {
  await prisma.projectEditScript.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt: input.userPrompt,
      styleBibleJson: styleBibleToJsonValue(input.styleBible),
      screenplayText: input.screenplayText,
      title: 'Generating edit table',
      logline: null,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'generating',
      shotsJson: [] as unknown as Prisma.InputJsonValue,
      videoBlocksJson: [] as unknown as Prisma.InputJsonValue,
    },
    update: {
      userPrompt: input.userPrompt,
      styleBibleJson: styleBibleToJsonValue(input.styleBible),
      screenplayText: input.screenplayText,
      title: 'Generating edit table',
      logline: null,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'generating',
      shotsJson: [] as unknown as Prisma.InputJsonValue,
      videoBlocksJson: [] as unknown as Prisma.InputJsonValue,
    },
  })
}

async function persistEditScriptGenerationStep(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible
  readonly screenplayText: string
  readonly title: string
  readonly logline: string | null
  readonly durationSec: number
  readonly shots: readonly EditScriptShot[]
  readonly videoBlocks?: readonly PartialVideoBlock[]
}) {
  await prisma.projectEditScript.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt: input.userPrompt,
      styleBibleJson: styleBibleToJsonValue(input.styleBible),
      screenplayText: input.screenplayText,
      title: input.title,
      logline: input.logline,
      durationSec: input.durationSec,
      shotCount: input.shots.length,
      status: 'generating',
      shotsJson: input.shots as unknown as Prisma.InputJsonValue,
      videoBlocksJson: (input.videoBlocks ?? []) as unknown as Prisma.InputJsonValue,
    },
    update: {
      userPrompt: input.userPrompt,
      styleBibleJson: styleBibleToJsonValue(input.styleBible),
      screenplayText: input.screenplayText,
      title: input.title,
      logline: input.logline,
      durationSec: input.durationSec,
      shotCount: input.shots.length,
      status: 'generating',
      shotsJson: input.shots as unknown as Prisma.InputJsonValue,
      videoBlocksJson: (input.videoBlocks ?? []) as unknown as Prisma.InputJsonValue,
    },
  })
}

async function notifyGenerationStep(
  callback: GenerateEditScriptInput['onGenerationStepPersisted'],
  step: EditScriptGenerationStep,
) {
  if (!callback) return
  await callback(step)
}

async function markEditScriptFailed(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBible?: EditScriptStyleBible
  readonly initialDurationSeconds: number
  readonly message: string
}): Promise<void> {
  await prisma.projectEditScript.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt: input.userPrompt,
      ...(input.styleBible ? { styleBibleJson: styleBibleToJsonValue(input.styleBible) } : {}),
      screenplayText: null,
      title: 'Edit table generation failed',
      logline: input.message,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'failed',
      shotsJson: [] as unknown as Prisma.InputJsonValue,
      videoBlocksJson: [] as unknown as Prisma.InputJsonValue,
    },
    update: {
      userPrompt: input.userPrompt,
      ...(input.styleBible ? { styleBibleJson: styleBibleToJsonValue(input.styleBible) } : {}),
      title: 'Edit table generation failed',
      logline: input.message,
      status: 'failed',
    },
  })
}

async function markGeneratingEditScriptFailed(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly message: string
}): Promise<void> {
  await prisma.projectEditScript.updateMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      status: 'generating',
    },
    data: {
      title: 'Edit table generation failed',
      logline: input.message,
      status: 'failed',
    },
  })
}

export async function readProjectEditScript(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<EditScriptPayload | null> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId)
  return script ? mapPersistedEditScript(script) : null
}

export async function readProjectEditScreenplay(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<EditScreenplayPayload | null> {
  const screenplay = await getPersistedEditScreenplay(input.projectId, input.episodeId)
  return screenplay ? mapPersistedEditScreenplay(screenplay) : null
}

export async function approveProjectEditScriptAssets(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}): Promise<EditScriptPayload> {
  const script = await prisma.projectEditScript.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      project: {
        userId: input.userId,
      },
    },
    include: {
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
  })
  if (!script) throw new ApiError('NOT_FOUND')
  const mapped = await mapPersistedEditScript(script)
  const notReady = mapped.requirements.filter((requirement) => requirement.status !== 'completed')
  if (notReady.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSETS_NOT_READY',
      message: `Edit script assets are not ready: ${notReady.map((requirement) => requirement.name).join(', ')}`,
    })
  }
  const updated = await prisma.projectEditScript.update({
    where: { id: script.id },
    data: {
      assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_APPROVED,
    },
    include: {
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
  })
  return await mapPersistedEditScript(updated)
}

export async function confirmProjectEditStylePreview(input: ConfirmEditStylePreviewInput): Promise<EditScreenplayPayload> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')

  const selectedPreview = await prisma.projectEditStylePreview.findFirst({
    where: {
      id: input.stylePreviewId,
      projectId: input.projectId,
      episodeId: input.episodeId,
    },
    include: {
      editScreenplay: {
        include: {
          stylePreviews: true,
        },
      },
    },
  })
  if (!selectedPreview) throw new ApiError('NOT_FOUND')

  const screenplay = selectedPreview.editScreenplay
  if (screenplay.projectId !== input.projectId || screenplay.episodeId !== input.episodeId) {
    throw new ApiError('NOT_FOUND')
  }
  if (selectedPreview.status !== 'completed' && selectedPreview.status !== 'confirmed') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_STYLE_PREVIEW_NOT_READY',
      message: 'Selected edit style preview image is not ready',
    })
  }
  if (!selectedPreview.imageKey) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_STYLE_PREVIEW_IMAGE_REQUIRED',
      message: 'Selected edit style preview image is missing',
    })
  }

  const allPreviewsTerminal = screenplay.stylePreviews.length > 0
    && screenplay.stylePreviews.every((preview) => preview.status === 'completed' || preview.status === 'confirmed' || preview.status === 'failed')
  if (!allPreviewsTerminal) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_STYLE_PREVIEWS_NOT_READY',
      message: 'All edit style preview image tasks must finish before confirmation',
    })
  }

  const selectedStyleBible = parseRequiredStyleBibleJson(selectedPreview.styleBibleJson)
  const selectedAspectRatio = normalizeStylePreviewAspectRatio(input.aspectRatio)
  await prisma.$transaction([
    prisma.projectEditStylePreview.updateMany({
      where: {
        editScreenplayId: screenplay.id,
        status: 'confirmed',
      },
      data: {
        status: 'completed',
      },
    }),
    prisma.projectEditStylePreview.update({
      where: { id: selectedPreview.id },
      data: {
        status: 'confirmed',
        errorMessage: null,
      },
    }),
    prisma.projectEditScreenplay.update({
      where: { id: screenplay.id },
      data: {
        styleBibleJson: styleBibleToJsonValue(selectedStyleBible),
        status: 'ready',
      },
    }),
    prisma.project.update({
      where: { id: project.id },
      data: {
        videoRatio: selectedAspectRatio,
      },
    }),
  ])

  const next = await getPersistedEditScreenplay(input.projectId, input.episodeId, screenplay.id)
  if (!next) throw new ApiError('NOT_FOUND')
  return mapPersistedEditScreenplay(next)
}

export async function readProjectEditDirectorDecoupage(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<EditDirectorDecoupagePayload | null> {
  const decoupage = await getPersistedEditDirectorDecoupage(input.projectId, input.episodeId)
  return decoupage ? mapPersistedEditDirectorDecoupage(decoupage) : null
}

export async function readProjectEditCinematographyShotPlan(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<EditCinematographyShotPlanPayload | null> {
  const plan = await getPersistedEditCinematographyShotPlan(input.projectId, input.episodeId)
  return plan ? mapPersistedEditCinematographyShotPlan(plan) : null
}

export async function updateProjectEditScriptVideoBlockPrompt(
  input: UpdateEditScriptVideoBlockPromptInput,
): Promise<EditScriptPayload> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!script) throw new ApiError('NOT_FOUND')

  const shots = parseShotsJson(script.shotsJson)
  const blocks = parseVideoBlocksJson(script.videoBlocksJson, shots)
  const targetBlock = blocks[input.blockIndex]
  if (!targetBlock) throw new ApiError('INVALID_PARAMS')

  const prompt = input.prompt.trim()
  const nextBlocks = blocks.map((block, index) => (
    index === input.blockIndex
      ? { ...block, prompt }
      : block
  ))

  const updated = await prisma.projectEditScript.update({
    where: { id: script.id },
    data: {
      videoBlocksJson: nextBlocks as unknown as Prisma.InputJsonValue,
    },
    include: {
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
  })

  return await mapPersistedEditScript(updated)
}

export async function updateProjectEditScriptAssetRequirementDescription(
  input: UpdateEditScriptAssetRequirementDescriptionInput,
): Promise<EditScriptPayload> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!script) throw new ApiError('NOT_FOUND')

  const targetRequirement = script.requirements.find((requirement) => requirement.id === input.requirementId)
  if (!targetRequirement) throw new ApiError('NOT_FOUND')

  await prisma.projectEditAssetRequirement.update({
    where: { id: targetRequirement.id },
    data: {
      description: input.description.trim(),
      errorMessage: null,
    },
  })

  const updated = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!updated) throw new ApiError('NOT_FOUND')
  return await mapPersistedEditScript(updated)
}

async function submitEditStylePreviewImageTask(input: {
  readonly request: NextRequest
  readonly userId: string
  readonly projectId: string
  readonly episodeId: string
  readonly locale: Locale
  readonly stylePreviewId: string
  readonly styleKey: EditStylePreviewKey
  readonly imagePrompt: string
  readonly imageModel: string
}) {
  const basePayload = {
    stylePreviewId: input.stylePreviewId,
    styleKey: input.styleKey,
    prompt: input.imagePrompt,
    count: 1,
  }
  let billingPayload: Record<string, unknown>
  try {
    const userModelConfig = await getUserModelConfig(input.userId)
    billingPayload = buildImageBillingPayloadFromUserConfig({
      userModelConfig,
      imageModel: input.imageModel,
      basePayload,
      aspectRatio: EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }
  const payload = withTaskUiPayload(billingPayload, {
    intent: 'generate',
    hasOutputAtStart: false,
  })

  return await submitTask({
    requestId: input.request.headers.get('x-request-id'),
    userId: input.userId,
    locale: input.locale,
    projectId: input.projectId,
    episodeId: input.episodeId,
    type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    targetType: 'ProjectEditStylePreview',
    targetId: input.stylePreviewId,
    operationId: 'generate_edit_style_preview_image',
    operationSource: 'project-ui',
    operationConfirmed: true,
    payload,
    dedupeKey: `edit_style_preview_image:${input.projectId}:${input.episodeId}:${input.stylePreviewId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE, payload),
  })
}

async function markStylePreviewGenerationFailed(input: {
  readonly screenplayId: string
  readonly message: string
}) {
  await prisma.$transaction([
    prisma.projectEditScreenplay.update({
      where: { id: input.screenplayId },
      data: {
        status: EDIT_SCREENPLAY_STATUS_FAILED,
      },
    }),
    prisma.projectEditStylePreview.updateMany({
      where: {
        editScreenplayId: input.screenplayId,
        status: { in: ['pending', 'generating'] },
      },
      data: {
        status: 'failed',
        errorMessage: input.message,
      },
    }),
  ])
}

export async function generateProjectEditScreenplay(input: GenerateEditScreenplayInput): Promise<EditScreenplayPayload> {
  const locale = assertLocale(input.locale)
  const [episode, project, config] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')

  const model = resolveTextModel(config)
  const spec = resolveEditFirstDurationSpec(input.durationTier)
  const structuredUserPrompt = buildEditFirstStructuredUserPrompt({
    prompt: input.prompt,
    durationTier: input.durationTier,
    aspectRatio: input.aspectRatio,
    locale,
  })
  const screenplayText = await runPromptTextStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
    variables: {
      user_request: structuredUserPrompt,
      duration_guidance: buildEditFirstDurationGuidance(spec, locale),
      aspect_ratio: input.aspectRatio,
    },
    stepTitle: 'Edit screenplay',
    stepIndex: 1,
    stepTotal: 1,
  })
  const saved = await prisma.projectEditScreenplay.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt: structuredUserPrompt,
      styleBibleJson: Prisma.JsonNull,
      screenplayText,
      status: EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY,
    },
    update: {
      userPrompt: structuredUserPrompt,
      styleBibleJson: Prisma.JsonNull,
      screenplayText,
      status: EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY,
    },
  })

  await prisma.projectEditStylePreview.deleteMany({
    where: { editScreenplayId: saved.id },
  })

  const next = await getPersistedEditScreenplay(input.projectId, input.episodeId, saved.id)
  if (!next) throw new ApiError('NOT_FOUND')
  return mapPersistedEditScreenplay(next)
}

export async function reviseProjectEditScreenplay(input: ReviseEditScreenplayInput): Promise<EditScreenplayPayload> {
  const locale = assertLocale(input.locale)
  const [episode, project, config] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')

  const screenplay = await prisma.projectEditScreenplay.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      ...(input.screenplayId ? { id: input.screenplayId } : {}),
    },
    select: {
      id: true,
      userPrompt: true,
      screenplayText: true,
      status: true,
    },
  })
  if (!screenplay) throw new ApiError('NOT_FOUND')
  if (screenplay.status !== EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCREENPLAY_REVISION_NOT_ALLOWED',
      message: `Edit screenplay can only be revised during screenplay review; current status is ${screenplay.status}`,
    })
  }

  const model = resolveTextModel(config)
  const spec = resolveEditFirstDurationSpec(input.durationTier)
  const revisedScreenplayText = await runPromptTextStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
    variables: {
      original_user_request: screenplay.userPrompt,
      current_screenplay_text: screenplay.screenplayText,
      revision_instruction: input.revisionInstruction,
      duration_guidance: buildEditFirstDurationGuidance(spec, locale),
      aspect_ratio: input.aspectRatio,
    },
    stepTitle: 'Revise edit screenplay',
    stepIndex: 1,
    stepTotal: 1,
  })

  await prisma.projectEditScreenplay.update({
    where: { id: screenplay.id },
    data: {
      userPrompt: buildRevisedEditScreenplayUserPrompt({
        locale,
        originalPrompt: screenplay.userPrompt,
        revisionInstruction: input.revisionInstruction,
        durationTier: input.durationTier,
        aspectRatio: input.aspectRatio,
      }),
      styleBibleJson: Prisma.JsonNull,
      screenplayText: revisedScreenplayText,
      status: EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY,
    },
  })

  await prisma.projectEditStylePreview.deleteMany({
    where: { editScreenplayId: screenplay.id },
  })

  const next = await getPersistedEditScreenplay(input.projectId, input.episodeId, screenplay.id)
  if (!next) throw new ApiError('NOT_FOUND')
  return mapPersistedEditScreenplay(next)
}

export async function generateProjectEditStylePreviews(input: GenerateEditStylePreviewsInput): Promise<EditStylePreviewGenerationPayload> {
  const locale = assertLocale(input.locale)
  const [episode, project, config] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')

  const screenplay = await prisma.projectEditScreenplay.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      ...(input.screenplayId ? { id: input.screenplayId } : {}),
    },
    select: {
      id: true,
      userPrompt: true,
      screenplayText: true,
      status: true,
      stylePreviews: {
        select: {
          styleKey: true,
        },
      },
    },
  })
  if (!screenplay) throw new ApiError('NOT_FOUND')
  const count = resolveStylePreviewCount(input.count)
  if (
    screenplay.status !== EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY
    && screenplay.status !== EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_READY
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCREENPLAY_REVIEW_REQUIRED',
      message: `Edit screenplay must be ready for style preview generation or regeneration; current status is ${screenplay.status}`,
    })
  }

  const model = resolveTextModel(config)
  const imageModel = resolveStylePreviewImageModel(config)
  const durationSpec = requireEditFirstDurationSpecFromPrompt(screenplay.userPrompt)
  try {
    const styleOptions = await generateEditStylePreviewOptions({
      userId: input.userId,
      projectId: input.projectId,
      model,
      locale,
      userPrompt: screenplay.userPrompt,
      screenplayText: screenplay.screenplayText,
      durationGuidance: buildEditFirstDurationGuidance(durationSpec, locale),
      styleDirection: input.styleDirection?.trim() ?? '',
      count,
    })

    const nextGeneration = resolveNextStylePreviewGeneration(
      screenplay.stylePreviews.map((preview) => preview.styleKey),
    )
    const stylePreviews = await prisma.$transaction(async (tx) => {
      const created: PersistedEditStylePreview[] = []
      for (const option of styleOptions) {
        const styleKey = buildStylePreviewPersistenceKey(option.styleKey, nextGeneration)
        const preview = await tx.projectEditStylePreview.create({
          data: {
            projectId: input.projectId,
            episodeId: input.episodeId,
            editScreenplayId: screenplay.id,
            styleKey,
            aspectRatio: option.aspectRatio,
            title: option.title,
            summary: option.summary,
            styleBibleJson: styleBibleToJsonValue(option.styleBible),
            imagePrompt: option.gridImagePrompt,
            status: 'pending',
          },
        })
        created.push(preview)
      }
      return created
    })

    const submittedPreviews: Array<{
      readonly preview: PersistedEditStylePreview
      readonly taskId: string
    }> = []
    for (const preview of stylePreviews) {
      const result = await submitEditStylePreviewImageTask({
        request: input.request,
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        locale,
        stylePreviewId: preview.id,
        styleKey: normalizeStylePreviewKey(preview.styleKey),
        imagePrompt: preview.imagePrompt,
        imageModel,
      })
      await prisma.projectEditStylePreview.update({
        where: { id: preview.id },
        data: {
          taskId: result.taskId,
          status: 'generating',
          errorMessage: null,
        },
      })
      submittedPreviews.push({
        preview,
        taskId: result.taskId,
      })
    }

    await prisma.projectEditScreenplay.update({
      where: { id: screenplay.id },
      data: {
        status: EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_GENERATING,
      },
    })

    return {
      success: true,
      async: true,
      projectId: input.projectId,
      episodeId: input.episodeId,
      screenplayId: screenplay.id,
      status: 'queued',
      total: submittedPreviews.length,
      taskIds: submittedPreviews.map((item) => item.taskId),
      results: submittedPreviews.map((item) => ({
        refId: item.preview.id,
        taskId: item.taskId,
      })),
      stylePreviews: submittedPreviews.map((item) => ({
        id: item.preview.id,
        styleKey: normalizeStylePreviewKey(item.preview.styleKey),
        aspectRatio: normalizeStylePreviewAspectRatio(item.preview.aspectRatio),
        title: item.preview.title,
        summary: item.preview.summary,
        status: 'generating',
        taskId: item.taskId,
      })),
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await markStylePreviewGenerationFailed({
      screenplayId: screenplay.id,
      message,
    })
    throw caught
  }
}

export async function generateProjectEditDirectorDecoupage(input: GenerateEditDirectorDecoupageInput): Promise<EditDirectorDecoupagePayload> {
  const locale = assertLocale(input.locale)
  const [episode, project, config] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: { id: true, videoRatio: true },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')
  const screenplay = await resolveReadyEditScreenplay({
    projectId: input.projectId,
    episodeId: input.episodeId,
    screenplayId: input.screenplayId,
  })
  const styleBible = parseRequiredStyleBibleJson(screenplay.styleBibleJson)
  const model = resolveTextModel(config)
  const durationSpec = requireEditFirstDurationSpecFromPrompt(screenplay.userPrompt)
  const raw = await runPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_DIRECTOR_DECOUPAGE,
    variables: {
      user_request: screenplay.userPrompt,
      screenplay_text: screenplay.screenplayText,
      style_bible_json: stringifyForPrompt(styleBible),
      duration_guidance: buildEditFirstDurationGuidance(durationSpec, locale),
      aspect_ratio: project.videoRatio,
    },
    stepTitle: 'Edit director decoupage',
    stepIndex: 1,
    stepTotal: 1,
  })
  const decoupage = normalizeDirectorDecoupage(raw)
  const saved = await prisma.projectEditDirectorDecoupage.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      editScreenplayId: screenplay.id,
      userPrompt: screenplay.userPrompt,
      decoupageJson: decoupage as unknown as Prisma.InputJsonValue,
      status: 'ready',
    },
    update: {
      editScreenplayId: screenplay.id,
      userPrompt: screenplay.userPrompt,
      decoupageJson: decoupage as unknown as Prisma.InputJsonValue,
      status: 'ready',
    },
    include: {
      editScreenplay: true,
    },
  })
  return mapPersistedEditDirectorDecoupage(saved)
}

export async function generateProjectEditScript(input: GenerateEditScriptInput): Promise<EditScriptPayload> {
  try {
    return await generateProjectEditScriptInternal(input)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await markGeneratingEditScriptFailed({
      projectId: input.projectId,
      episodeId: input.episodeId,
      message,
    })
    throw caught
  }
}

async function generateProjectEditScriptInternal(input: GenerateEditScriptInput): Promise<EditScriptPayload> {
  const locale = assertLocale(input.locale)
  const [episode, project, config] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        videoRatio: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')
  const effectiveVideoRatio = input.videoRatio ?? project.videoRatio
  if (input.videoRatio && input.videoRatio !== project.videoRatio) {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        videoRatio: input.videoRatio,
      },
    })
  }
  const model = resolveTextModel(config)
  const screenplay = await resolveReadyEditScreenplay({
    projectId: input.projectId,
    episodeId: input.episodeId,
    screenplayId: input.screenplayId,
  })
  const userPrompt = screenplay.userPrompt
  const styleBible = parseRequiredStyleBibleJson(screenplay.styleBibleJson)
  const durationSpec = requireEditFirstDurationSpecFromPrompt(userPrompt)
  const screenplayText = screenplay.screenplayText
  const directorDecoupage = await resolveReadyEditDirectorDecoupage({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  const directorDecoupageJson = parseDirectorDecoupageJson(directorDecoupage.decoupageJson)
  await markEditScriptGenerating({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userPrompt,
    styleBible,
    screenplayText,
    initialDurationSeconds: durationSpec.targetSeconds,
  })
  await notifyGenerationStep(input.onGenerationStepPersisted, {
    stage: 'edit_script_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    progress: 18,
  })

  try {
    const structureRaw = await runPromptStep({
      userId: input.userId,
      projectId: input.projectId,
      model,
      locale,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      variables: {
        user_request: userPrompt,
        screenplay_text: screenplayText,
        director_decoupage_json: stringifyForPrompt(directorDecoupageJson),
        duration_guidance: buildEditFirstDurationGuidance(durationSpec, locale),
        aspect_ratio: effectiveVideoRatio,
        style_bible_json: stringifyForPrompt(styleBible),
      },
      stepTitle: 'Edit core table',
      stepIndex: 1,
      stepTotal: 2,
    })
    const structure = normalizeEditScriptStructure(structureRaw)
    await persistEditScriptGenerationStep({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt,
      styleBible,
      screenplayText,
      title: structure.title,
      logline: structure.logline ?? null,
      durationSec: structure.durationSec,
      shots: structure.shots,
      videoBlocks: structure.videoBlocks,
    })
    await notifyGenerationStep(input.onGenerationStepPersisted, {
      stage: 'edit_script_primary',
      stageLabel: 'progress.stage.editScriptPrimary',
      progress: 82,
    })
    const assetRaw = await runPromptStep({
      userId: input.userId,
      projectId: input.projectId,
      model,
      locale,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT,
      variables: {
        edit_script_json: stringifyForPrompt(structure),
      },
      stepTitle: 'Edit required assets',
      stepIndex: 2,
      stepTotal: 2,
    })
    const requirements = await designEditAssetRequirements({
      userId: input.userId,
      projectId: input.projectId,
      locale,
      analysisModel: model,
      userPrompt,
      styleBible,
      shots: structure.shots,
      requirements: normalizeEditAssetRequirements(assetRaw, structure.shots),
    })

    await notifyGenerationStep(input.onGenerationStepPersisted, {
      stage: 'edit_script_asset_extract',
      stageLabel: 'progress.stage.editScriptAssetExtract',
      progress: 72,
    })

    const core = structure

    const assetByRequirementKey = new Map<string, ExistingAssetRef>()
    const saved = await prisma.$transaction(async (tx) => {
      const script = await tx.projectEditScript.upsert({
        where: { episodeId: input.episodeId },
        create: {
          projectId: input.projectId,
          episodeId: input.episodeId,
          userPrompt,
          styleBibleJson: styleBibleToJsonValue(styleBible),
          screenplayText,
          title: core.title,
          logline: core.logline,
          durationSec: core.durationSec,
          shotCount: core.shotCount,
          status: 'ready',
          assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_PENDING,
          shotsJson: core.shots as unknown as Prisma.InputJsonValue,
          videoBlocksJson: core.videoBlocks as unknown as Prisma.InputJsonValue,
        },
        update: {
          userPrompt,
          styleBibleJson: styleBibleToJsonValue(styleBible),
          screenplayText,
          title: core.title,
          logline: core.logline,
          durationSec: core.durationSec,
          shotCount: core.shotCount,
          status: 'ready',
          assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_PENDING,
          shotsJson: core.shots as unknown as Prisma.InputJsonValue,
          videoBlocksJson: core.videoBlocks as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.projectEditAssetRequirement.deleteMany({
        where: { editScriptId: script.id },
      })
      for (const requirement of requirements) {
        const requirementKey = `${requirement.kind}:${requirement.name.trim().toLocaleLowerCase()}`
        let asset = assetByRequirementKey.get(requirementKey) ?? null
        if (!asset) {
          asset = await findExistingAsset({
            projectId: input.projectId,
            kind: requirement.kind,
            name: requirement.name,
          })
        }
        if (!asset) {
          asset = await createRequiredAssetInTransaction(tx, {
            projectId: input.projectId,
            kind: requirement.kind,
            name: requirement.name,
            description: requirement.description,
          })
        }
        assetByRequirementKey.set(requirementKey, asset)
        await tx.projectEditAssetRequirement.create({
          data: {
            editScriptId: script.id,
            projectId: input.projectId,
            episodeId: input.episodeId,
            kind: requirement.kind,
            name: requirement.name,
            description: requirement.description,
            shotIndexes: requirement.shotNumbers as unknown as Prisma.InputJsonValue,
            status: asset.hasOutput ? 'completed' : 'pending',
            targetId: asset.id,
            errorMessage: null,
          },
        })
      }
      const nextScript = await tx.projectEditScript.findUniqueOrThrow({
        where: { id: script.id },
        include: {
          requirements: {
            orderBy: [
              { kind: 'asc' },
              { name: 'asc' },
            ],
          },
        },
      })
      return nextScript
    })
    await notifyGenerationStep(input.onGenerationStepPersisted, {
      stage: 'edit_script_video_prompt',
      stageLabel: 'progress.stage.editScriptPersist',
      progress: 92,
    })

    return await mapPersistedEditScript(saved)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await markEditScriptFailed({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt,
      styleBible,
      initialDurationSeconds: durationSpec.targetSeconds,
      message,
    })
    throw caught
  }
}

export async function generateProjectEditCinematographyShotPlan(input: GenerateEditCinematographyShotPlanInput): Promise<EditCinematographyShotPlanPayload> {
  const locale = assertLocale(input.locale)
  const [episode, project, config] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: { id: true },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')
  const editScript = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!editScript) throw new ApiError('NOT_FOUND')
  if (editScript.status !== 'ready') {
    throw new Error(`EDIT_SCRIPT_NOT_READY:${editScript.id}`)
  }
  const directorDecoupage = await resolveReadyEditDirectorDecoupage({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  const mappedEditScript = await mapPersistedEditScript(editScript)
  if (!mappedEditScript.styleBible) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STYLE_BIBLE_REQUIRED',
      message: 'Style Bible is required before cinematography shot plan generation',
    })
  }
  const assets = await buildAssetSnapshots(mappedEditScript.requirements)
  const model = resolveTextModel(config)
  const raw = await runPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN,
    variables: {
      style_bible_json: stringifyForPrompt(mappedEditScript.styleBible),
      director_decoupage_json: stringifyForPrompt(parseDirectorDecoupageJson(directorDecoupage.decoupageJson)),
      edit_script_json: stringifyForPrompt({
        id: mappedEditScript.id,
        title: mappedEditScript.title,
        logline: mappedEditScript.logline,
        durationSec: mappedEditScript.durationSec,
        shotCount: mappedEditScript.shotCount,
        screenplayText: mappedEditScript.screenplayText,
        shots: mappedEditScript.shots,
        videoBlocks: mappedEditScript.videoBlocks,
      }),
      asset_context_json: stringifyForPrompt(assets),
      spatial_profiles_json: stringifyForPrompt(assets
        .filter((asset) => asset.kind === 'location')
        .map((asset) => ({
          requirementId: asset.requirementId,
          name: asset.name,
          targetId: asset.targetId,
          shotNumbers: asset.shotNumbers,
          spatialProfile: asset.spatialProfile ?? null,
        }))),
    },
    stepTitle: 'Edit cinematography shot plan',
    stepIndex: 1,
    stepTotal: 1,
  })
  const parsed = parseCinematographyShotPlanJson(raw as unknown as Prisma.JsonValue)
  const expectedShotNumbers = mappedEditScript.shots.map((shot) => shot.shotNumber)
  const actualShotNumbers = parsed.shots.map((shot) => shot.shotNumber)
  if (actualShotNumbers.length !== expectedShotNumbers.length
    || actualShotNumbers.some((shotNumber, index) => shotNumber !== expectedShotNumbers[index])) {
    throw new Error('EDIT_CINEMATOGRAPHY_SHOT_PLAN_COVERAGE_INVALID')
  }
  const shotPlanJson = {
    strategy: 'cinematography_shot_plan',
    schemaVersion: 1,
    shots: parsed.shots,
    hardBans: parsed.hardBans,
  }
  const saved = await prisma.projectEditCinematographyShotPlan.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      editScriptId: editScript.id,
      shotPlanJson: shotPlanJson as unknown as Prisma.InputJsonValue,
      status: 'ready',
    },
    update: {
      editScriptId: editScript.id,
      shotPlanJson: shotPlanJson as unknown as Prisma.InputJsonValue,
      status: 'ready',
    },
  })
  return mapPersistedEditCinematographyShotPlan(saved)
}

async function findExistingAsset(input: {
  readonly projectId: string
  readonly kind: EditAssetKind
  readonly name: string
}): Promise<ExistingAssetRef | null> {
  const normalizedName = input.name.trim().toLocaleLowerCase()
  if (input.kind === 'character') {
    const characters = await prisma.projectCharacter.findMany({
      where: { projectId: input.projectId },
      select: {
        id: true,
        name: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: {
            id: true,
            imageUrl: true,
            imageMediaId: true,
            imageUrls: true,
          },
        },
      },
    })
    const character = characters.find((item) => item.name.trim().toLocaleLowerCase() === normalizedName)
    if (!character) return null
    const appearance = character.appearances[0]
    const imageUrls = appearance ? decodeImageUrlsFromDb(appearance.imageUrls, 'editScript.existing.character.imageUrls') : []
    const previewImageUrl = appearance?.imageUrl || imageUrls[0] || null
    return {
      id: character.id,
      previewImageUrl,
      hasOutput: Boolean(appearance?.imageMediaId || previewImageUrl),
      taskTargetType: 'CharacterAppearance',
      taskTargetId: appearance?.id ?? character.id,
    }
  }

  const locations = await prisma.projectLocation.findMany({
    where: { projectId: input.projectId, assetKind: 'location' },
    select: {
      id: true,
      name: true,
      images: {
        orderBy: { imageIndex: 'asc' },
        take: 1,
        select: {
          imageUrl: true,
          imageMediaId: true,
        },
      },
    },
  })
  const location = locations.find((item) => item.name.trim().toLocaleLowerCase() === normalizedName)
  const image = location?.images[0]
  if (!location) return null
  return {
    id: location.id,
    previewImageUrl: image?.imageUrl || null,
    hasOutput: Boolean(image?.imageMediaId || image?.imageUrl),
    taskTargetType: 'LocationImage',
    taskTargetId: location.id,
  }
}

async function createRequiredAsset(input: {
  readonly projectId: string
  readonly kind: EditAssetKind
  readonly name: string
  readonly description: string
}): Promise<ExistingAssetRef> {
  if (input.kind === 'character') {
    const character = await prisma.projectCharacter.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        aliases: null,
        appearances: {
          create: {
            appearanceIndex: PRIMARY_APPEARANCE_INDEX,
            changeReason: 'primary',
            description: input.description,
            descriptions: JSON.stringify([input.description]),
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        },
      },
      select: {
        id: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    })
    return {
      id: character.id,
      previewImageUrl: null,
      hasOutput: false,
      taskTargetType: 'CharacterAppearance',
      taskTargetId: character.appearances[0]?.id ?? character.id,
    }
  }

  const location = await prisma.projectLocation.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      summary: input.description,
      assetKind: 'location',
      images: {
        create: {
          imageIndex: 0,
          description: input.description,
        },
      },
    },
    select: { id: true },
  })
  return {
    id: location.id,
    previewImageUrl: null,
    hasOutput: false,
    taskTargetType: 'LocationImage',
    taskTargetId: location.id,
  }
}

async function createRequiredAssetInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly projectId: string
    readonly kind: EditAssetKind
    readonly name: string
    readonly description: string
  },
): Promise<ExistingAssetRef> {
  if (input.kind === 'character') {
    const character = await tx.projectCharacter.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        aliases: null,
        appearances: {
          create: {
            appearanceIndex: PRIMARY_APPEARANCE_INDEX,
            changeReason: 'primary',
            description: input.description,
            descriptions: JSON.stringify([input.description]),
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        },
      },
      select: {
        id: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    })
    return {
      id: character.id,
      previewImageUrl: null,
      hasOutput: false,
      taskTargetType: 'CharacterAppearance',
      taskTargetId: character.appearances[0]?.id ?? character.id,
    }
  }

  const location = await tx.projectLocation.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      summary: input.description,
      assetKind: 'location',
      images: {
        create: {
          imageIndex: 0,
          description: input.description,
        },
      },
    },
    select: { id: true },
  })
  return {
    id: location.id,
    previewImageUrl: null,
    hasOutput: false,
    taskTargetType: 'LocationImage',
    taskTargetId: location.id,
  }
}

async function deleteCreatedAsset(input: {
  readonly kind: EditAssetKind
  readonly id: string
}): Promise<void> {
  if (input.kind === 'character') {
    await prisma.projectCharacter.delete({ where: { id: input.id } })
    return
  }
  await prisma.projectLocation.delete({ where: { id: input.id } })
}

async function submitRequirementImageTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly kind: EditAssetKind
  readonly assetId: string
}): Promise<Omit<EditScriptAssetGenerationTask, 'requirementId' | 'kind' | 'name'>> {
  const characterAppearance = input.kind === 'character'
    ? await prisma.characterAppearance.findFirst({
        where: { characterId: input.assetId },
        orderBy: { appearanceIndex: 'asc' },
        select: { id: true, appearanceIndex: true },
      })
    : null
  if (input.kind === 'character' && !characterAppearance) {
    throw new Error('EDIT_SCRIPT_CHARACTER_APPEARANCE_NOT_FOUND')
  }

  const result = await submitAssetGenerateTask({
    request: input.request,
    kind: input.kind,
    assetId: input.assetId,
    episodeId: input.episodeId,
    body: {
      count: 1,
      ...(characterAppearance
        ? {
            appearanceId: characterAppearance.id,
            appearanceIndex: characterAppearance.appearanceIndex,
          }
        : {}),
      meta: {
        locale: input.locale,
      },
    },
    access: {
      scope: 'project',
      userId: input.userId,
      projectId: input.projectId,
    },
  })

  if (input.kind === 'character') {
    const appearance = characterAppearance
    if (!appearance) {
      throw new Error('EDIT_SCRIPT_CHARACTER_APPEARANCE_NOT_FOUND')
    }
    return {
      taskId: result.taskId,
      status: result.status,
      runId: result.runId,
      deduped: result.deduped,
      taskType: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: appearance.id,
    }
  }

  return {
    taskId: result.taskId,
    status: result.status,
    runId: result.runId,
    deduped: result.deduped,
    taskType: TASK_TYPE.IMAGE_LOCATION,
    targetType: 'LocationImage',
    targetId: input.assetId,
  }
}

export async function generateProjectEditScriptAssets(input: GenerateEditScriptAssetsInput): Promise<EditScriptAssetGenerationPayload> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!script) throw new ApiError('NOT_FOUND')

  const requirements = input.requirementId
    ? script.requirements.filter((requirement) => requirement.id === input.requirementId)
    : script.requirements
  if (input.requirementId && requirements.length === 0) throw new ApiError('NOT_FOUND')

  const submittedTasks: EditScriptAssetGenerationTask[] = []
  const failedRequirements: Array<{
    readonly requirementId: string
    readonly kind: string
    readonly name: string
    readonly errorMessage: string
  }> = []

  for (const requirement of requirements) {
    if (!isEditAssetKind(requirement.kind)) {
      const errorMessage = `Unsupported asset kind: ${requirement.kind}`
      await prisma.projectEditAssetRequirement.update({
        where: { id: requirement.id },
        data: { status: 'failed', errorMessage },
      })
      failedRequirements.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        name: requirement.name,
        errorMessage,
      })
      continue
    }

    const existing = requirement.targetId
      ? await resolveRequirementAsset(input.projectId, requirement)
      : await findExistingAsset({
        projectId: input.projectId,
        kind: requirement.kind,
        name: requirement.name,
      })
    if (existing?.hasOutput) {
      await prisma.projectEditAssetRequirement.update({
        where: { id: requirement.id },
        data: { targetId: existing.id, status: 'completed', errorMessage: null },
      })
      continue
    }

    let createdAssetId: string | null = null
    const asset = existing ?? await createRequiredAsset({
      projectId: input.projectId,
      kind: requirement.kind,
      name: requirement.name,
      description: requirement.description,
    })
    if (!existing) {
      createdAssetId = asset.id
    }

    await prisma.projectEditAssetRequirement.update({
      where: { id: requirement.id },
      data: { targetId: asset.id, status: 'generating', errorMessage: null },
    })

    try {
      const submittedTask = await submitRequirementImageTask({
        request: input.request,
        projectId: input.projectId,
        episodeId: input.episodeId,
        userId: input.userId,
        locale: input.locale,
        kind: requirement.kind,
        assetId: asset.id,
      })
      submittedTasks.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        name: requirement.name,
        ...submittedTask,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (createdAssetId) {
        await deleteCreatedAsset({ kind: requirement.kind, id: createdAssetId })
      }
      await prisma.projectEditAssetRequirement.update({
        where: { id: requirement.id },
        data: {
          targetId: existing?.id ?? null,
          status: 'failed',
          errorMessage,
        },
      })
      failedRequirements.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        name: requirement.name,
        errorMessage,
      })
    }
  }

  const updated = await getPersistedEditScript(input.projectId, input.episodeId, script.id)
  if (!updated) throw new ApiError('NOT_FOUND')
  const editScript = await mapPersistedEditScript(updated)
  if (submittedTasks.length === 0 && failedRequirements.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSET_GENERATION_FAILED',
      message: 'No edit script asset generation tasks were submitted.',
      failedRequirements,
    })
  }
  return {
    success: true,
    async: submittedTasks.length > 0,
    total: submittedTasks.length,
    taskIds: submittedTasks.map((task) => task.taskId),
    results: submittedTasks.map((task) => ({
      refId: task.requirementId,
      taskId: task.taskId,
      taskType: task.taskType,
      targetType: task.targetType,
      targetId: task.targetId,
    })),
    submittedTasks,
    editScript,
  }
}
