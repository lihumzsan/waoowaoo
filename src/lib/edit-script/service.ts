import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { AppError } from '@/lib/errors/app-error'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import { buildDefaultTaskBillingInfo, withTextBilling } from '@/lib/billing'
import { buildImageBillingPayloadFromUserConfig, getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { getSignedUrl } from '@/lib/storage'
import { submitTask } from '@/lib/task/submitter'
import { cancelTask } from '@/lib/task/service'
import { removeTaskJob } from '@/lib/task/queues'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  assembleChapterPlanInput,
  buildChapterPlanOutputSchema,
  normalizeChapterPlanOutput,
  resolveDefaultEditChapter,
  validateChapterPlan,
  type AssembledChapterPlanInput,
  type NormalizedChapterPlanOutput,
} from '@/lib/edit-chapter'
import {
  loadKnownPlanAssets,
  type ExistingAssetRef,
  type KnownPlanAsset,
} from '@/lib/edit-chapter/asset-menu'
import { EDIT_BIBLE_STATUS } from '@/lib/edit-bible/constraints'
import { EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO } from '@/lib/edit-script/style-preview-image-constants'
import type { Locale } from '@/i18n/routing'
import {
  normalizeEditScriptStructure,
  normalizeEditShotExecutionPlan,
} from './normalize'
import { resolveEditScriptDialogueVoiceContext } from './voice-profiles'
import type {
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
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
  EditShotExecutionPlanPayload,
} from './types'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'
import {
  editStylePreviewKeySchema,
  editStylePreviewOptionsSchema,
  EDIT_STYLE_PREVIEW_KEYS,
  EDIT_STYLE_PREVIEW_MAX_COUNT,
  editScriptStyleBibleSchema,
} from './types'
import { buildAssetSnapshots } from './storyboard-consistency/source-snapshot'
import { EDIT_GENERATION_SEGMENT_MAX_DURATION_SEC } from './generation-segment-constraints'
import { buildShotExecutionPlanPromptStructure } from './shot-execution-plan-prompt'

interface GenerateEditScriptInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly userId: string
  readonly locale: Locale
  readonly videoRatio?: '9:16' | '16:9' | '21:9'
  readonly onGenerationStepPersisted?: (step: EditScriptGenerationStep) => Promise<void>
}

interface GenerateEditStylePreviewsInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly bibleId?: string
  readonly styleDirection?: string
  readonly count?: number
  readonly parentTaskId?: string | null
  readonly operationConfirmed: boolean
  readonly operationRequestId?: string | null
  readonly plannedStylePreviewIds?: readonly string[]
  readonly plannedImageModel?: string
  readonly confirmedMaxCost?: number | null
}

export interface PreparedEditStylePreviewCandidate {
  readonly preview: PersistedEditStylePreview
  readonly imageModel: string
  readonly payload: Record<string, unknown>
  readonly billingInfo: TaskBillingInfo
}

export interface PreparedEditStylePreviewCandidates {
  readonly bibleId: string
  readonly candidates: readonly PreparedEditStylePreviewCandidate[]
}

interface ConfirmEditStylePreviewInput {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly stylePreviewId: string
  readonly aspectRatio: '9:16' | '16:9' | '21:9'
}

interface GenerateEditShotExecutionPlanInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly userId: string
  readonly locale: Locale
  readonly editScriptId?: string
}

interface UpdateEditScriptAssetRequirementDescriptionInput {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly editScriptId: string
  readonly requirementId: string
  readonly description: string
}

type PromptStepId =
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN

type EditScriptGenerationStage =
  | 'edit_script_prepare'
  | 'edit_script_style_bible'
  | 'edit_script_primary'
  | 'edit_script_persist'

const EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS = 1024

interface EditScriptGenerationStep {
  readonly stage: EditScriptGenerationStage
  readonly stageLabel: string
  readonly progress: number
}

interface PersistedEditScriptRequirement {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly requiredForShotIds: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScript {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly corePlanJson: Prisma.JsonValue | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly requirements: readonly PersistedEditScriptRequirement[]
}

export interface PersistedEditStylePreview {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editBibleId: string
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

interface PersistedEditShotExecutionPlan {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly editScriptId: string
  readonly executionPlanJson: Prisma.JsonValue
  readonly status: string
}

type ChapterEditScriptSource = AssembledChapterPlanInput

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

function editScriptRequirementOrderBy(): Prisma.ProjectEditAssetRequirementOrderByWithRelationInput[] {
  return [
    { kind: 'asc' },
    { name: 'asc' },
  ]
}

let shotCuidCounter = 0

function createShotCuid(): string {
  shotCuidCounter = (shotCuidCounter + 1) % 1679616
  const counter = shotCuidCounter.toString(36).padStart(4, '0')
  const entropy = randomUUID().replace(/-/g, '').slice(0, 12)
  return `c${Date.now().toString(36)}${counter}${entropy}`
}

function createSystemShotId(): string {
  return `shot_${createShotCuid()}`
}

function rewriteStructureWithSystemShotIds(structure: NormalizedChapterPlanOutput): NormalizedChapterPlanOutput {
  const shotIdMap = new Map<string, string>()
  const shots = structure.shots.map((shot): EditScriptShot => {
    const systemShotId = createSystemShotId()
    shotIdMap.set(shot.shotId, systemShotId)
    return {
      ...shot,
      shotId: systemShotId,
    }
  })
  const generationSegments = structure.generationSegments.map((segment) => ({
    ...segment,
    shotIds: segment.shotIds.map((shotId) => {
      const systemShotId = shotIdMap.get(shotId)
      if (!systemShotId) throw new Error(`EDIT_SCRIPT_SYSTEM_SHOT_ID_REWRITE_MISSING:${shotId}`)
      return systemShotId
    }),
  }))
  return {
    ...structure,
    shots,
    generationSegments,
  }
}

function buildProjectedAssetRequirements(input: {
  readonly structure: NormalizedChapterPlanOutput
  readonly knownAssets: readonly KnownPlanAsset[]
}): readonly EditAssetRequirement[] {
  const knownAssetsById = new Map(input.knownAssets.map((asset) => [asset.id, asset]))
  const grouped = new Map<string, {
    readonly kind: EditAssetKind
    readonly name: string
    readonly shotIds: Set<string>
    readonly assetId: string
  }>()
  for (const shot of input.structure.shots) {
    const locationAsset = knownAssetsById.get(shot.scene.locationId)
    if (!locationAsset || locationAsset.kind !== 'location') {
      throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:ASSET_UNKNOWN:location:${shot.scene.locationId}`, {
        details: {
          assetKind: 'location',
          assetId: shot.scene.locationId,
        },
      })
    }
    const locationKey = `location:${locationAsset.id}`
    const currentLocation = grouped.get(locationKey) ?? {
      kind: 'location' as const,
      name: locationAsset.name,
      assetId: locationAsset.id,
      shotIds: new Set<string>(),
    }
    currentLocation.shotIds.add(shot.shotId)
    grouped.set(locationKey, currentLocation)
    for (const character of shot.characters) {
      const characterAsset = knownAssetsById.get(character.characterId)
      if (!characterAsset || characterAsset.kind !== 'character') {
        throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:ASSET_UNKNOWN:character:${character.characterId}`, {
          details: {
            assetKind: 'character',
            assetId: character.characterId,
          },
        })
      }
      const key = `character:${characterAsset.id}`
      const current = grouped.get(key) ?? {
        kind: 'character' as const,
        name: characterAsset.name,
        assetId: characterAsset.id,
        shotIds: new Set<string>(),
      }
      current.shotIds.add(shot.shotId)
      grouped.set(key, current)
    }
  }
  return [...grouped.entries()].map(([key, requirement]) => {
    const knownAsset = knownAssetsById.get(requirement.assetId)
    if (!knownAsset) throw new Error(`EDIT_SCRIPT_ASSET_NOT_PRECONFIRMED:${key}`)
    return {
      kind: requirement.kind,
      name: requirement.name,
      description: knownAsset.description,
      shotIds: [...requirement.shotIds],
      status: knownAsset.asset.hasOutput ? 'completed' : 'pending',
      targetId: knownAsset.asset.id,
      taskTargetType: knownAsset.asset.taskTargetType,
      taskTargetId: knownAsset.asset.taskTargetId,
      previewImageUrl: knownAsset.asset.previewImageUrl,
      spatialProfileJson: knownAsset.asset.spatialProfileJson ?? null,
      spatialProfileStatus: knownAsset.asset.spatialProfileStatus ?? null,
      spatialProfileError: knownAsset.asset.spatialProfileError ?? null,
      spatialProfileAnalyzedAt: knownAsset.asset.spatialProfileAnalyzedAt ?? null,
      spatialProfileModel: knownAsset.asset.spatialProfileModel ?? null,
    }
  })
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
    bibleId: preview.editBibleId,
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

function styleBibleToJsonValue(styleBible: EditScriptStyleBible): Prisma.InputJsonValue {
  return styleBible as unknown as Prisma.InputJsonValue
}

function assertLocale(value: Locale): Locale {
  return value
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

async function runStructuredPromptStep<TData>(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly promptId: PromptStepId
  readonly variables: Record<string, string>
  readonly stepTitle: string
  readonly stepIndex: number
  readonly stepTotal: number
  readonly schema?: ZodType<unknown>
  readonly validate: (raw: unknown) => TData
}): Promise<TData> {
  const finalPromptContent = buildAiPromptContent({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
    cacheVariableKeys: Object.keys(input.variables),
    minCacheChars: EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS,
  })
  const finalPrompt = flattenChatMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const action = input.promptId
  const runCompletion = async () => executeAiStructuredTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.4,
    projectId: input.projectId,
    action,
    locale: input.locale,
    meta: {
      stepId: action,
      stepTitle: input.stepTitle,
      stepIndex: input.stepIndex,
      stepTotal: input.stepTotal,
    },
    schema: input.schema ?? z.unknown(),
    parse: { kind: 'object' },
    validate: input.validate,
  })

  const result = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    { projectId: input.projectId, action, metadata: { promptId: input.promptId } },
    runCompletion,
  )
  if (!result.text.trim()) {
    throw new Error(`EDIT_SCRIPT_PROMPT_EMPTY:${input.promptId}`)
  }
  return result.data
}

async function generateEditStylePreviewOptions(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly userPrompt: string
  readonly bibleText: string
  readonly durationGuidance: string
  readonly styleDirection: string
  readonly count: number
}): Promise<readonly EditStylePreviewOption[]> {
  return await runStructuredPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model: input.model,
    locale: input.locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS,
    variables: {
      user_request: input.userPrompt,
      bible_text: input.bibleText,
      duration_guidance: input.durationGuidance,
      style_direction: input.styleDirection,
      style_preview_count: String(input.count),
    },
    stepTitle: 'Edit style preview options',
    stepIndex: 2,
    stepTotal: 2,
    validate: (raw) => {
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
    },
  })
}

interface StylePreviewChapterContext {
  readonly chapterIndex: number
  readonly title: string | null
  readonly summary: string | null
  readonly targetDurationSec: number
}

function buildEditBibleStylePreviewRequest(input: {
  readonly bibleJson: Prisma.JsonValue | null
  readonly locale: Locale
}): string {
  const bible = input.bibleJson && typeof input.bibleJson === 'object' && !Array.isArray(input.bibleJson)
    ? input.bibleJson as { readonly title?: unknown; readonly synopsis?: unknown; readonly logline?: unknown }
    : null
  const title = typeof bible?.title === 'string' ? bible.title : ''
  const logline = typeof bible?.logline === 'string' ? bible.logline : ''
  const synopsis = typeof bible?.synopsis === 'string' ? bible.synopsis : ''
  if (input.locale === 'en') {
    return [
      title ? `Series title: ${title}` : '',
      logline ? `Logline: ${logline}` : '',
      synopsis ? `Synopsis: ${synopsis}` : '',
      'Create coherent visual style directions for the confirmed episode bible.',
    ].filter(Boolean).join('\n')
  }
  return [
    title ? `作品标题：${title}` : '',
    logline ? `一句话梗概：${logline}` : '',
    synopsis ? `故事梗概：${synopsis}` : '',
    '请基于已确认的本集 Bible 生成统一的视觉风格候选。',
  ].filter(Boolean).join('\n')
}

function buildEditBibleStylePreviewContext(input: {
  readonly bibleJson: Prisma.JsonValue | null
  readonly beatSheetJson: Prisma.JsonValue | null
  readonly emotionalCurveJson: Prisma.JsonValue | null
  readonly chapters: readonly StylePreviewChapterContext[]
}): string {
  return stringifyForPrompt({
    bible: input.bibleJson,
    beatSheet: input.beatSheetJson,
    emotionalCurve: input.emotionalCurveJson,
    chapters: input.chapters,
  })
}

function buildEditBibleDurationGuidance(input: {
  readonly locale: Locale
  readonly chapters: readonly StylePreviewChapterContext[]
}): string {
  const totalDurationSec = input.chapters.reduce((sum, chapter) => sum + chapter.targetDurationSec, 0)
  if (input.locale === 'en') {
    return `The episode contains ${String(input.chapters.length)} chapter(s), with a total target duration of about ${String(totalDurationSec)} seconds. The style must stay coherent across all chapters.`
  }
  return `本集包含 ${String(input.chapters.length)} 个章节，目标总时长约 ${String(totalDurationSec)} 秒。风格必须能贯穿所有章节并保持一致。`
}

function readShotIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

async function resolveEditChapterId(episodeId: string, chapterId?: string): Promise<string> {
  if (chapterId) {
    const chapter = await prisma.projectEditChapter.findFirst({
      where: { id: chapterId, episodeId },
      select: { id: true },
    })
    if (!chapter) throw new ApiError('NOT_FOUND')
    return chapter.id
  }
  const chapter = await resolveDefaultEditChapter(episodeId)
  return chapter.id
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

async function resolvePersistedEditScriptSource(script: PersistedEditScript): Promise<{
  readonly bibleId: string | null
  readonly sourceDocumentId: string | null
  readonly sourceStart: number | null
  readonly sourceEnd: number | null
  readonly sourceText: string | null
  readonly styleBible: EditScriptStyleBible | null
}> {
  const [chapter, bible] = await Promise.all([
    prisma.projectEditChapter.findFirst({
      where: {
        id: script.chapterId,
        episodeId: script.episodeId,
      },
      include: {
        sourceDocument: true,
      },
    }),
    prisma.projectEditBible.findUnique({
      where: { episodeId: script.episodeId },
      select: {
        id: true,
        styleBibleJson: true,
      },
    }),
  ])
  const sourceStart = chapter?.sourceStart ?? null
  const sourceEnd = chapter?.sourceEnd ?? null
  const sourceDocument = chapter?.sourceDocument ?? null
  const sourceText =
    sourceDocument && sourceStart !== null && sourceEnd !== null
      ? sourceDocument.normalizedText.slice(sourceStart, sourceEnd)
      : null
  return {
    bibleId: bible?.id ?? null,
    sourceDocumentId: chapter?.sourceDocumentId ?? null,
    sourceStart,
    sourceEnd,
    sourceText,
    styleBible: bible?.styleBibleJson ? parseOptionalStyleBibleJson(bible.styleBibleJson) : null,
  }
}

async function mapPersistedEditScript(script: PersistedEditScript): Promise<EditScriptPayload> {
  if (!script.corePlanJson && script.status === 'ready') {
    throw new Error(`EDIT_SCRIPT_CORE_PLAN_REQUIRED:${script.id}`)
  }
  const core = script.corePlanJson
    ? normalizeEditScriptStructure(script.corePlanJson)
    : { durationSec: script.durationSec, shotCount: script.shotCount, shots: [], generationSegments: [] }
  const source = await resolvePersistedEditScriptSource(script)
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
      shotIds: readShotIds(requirement.requiredForShotIds),
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

  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    chapterId: script.chapterId,
    ...(source.bibleId ? { bibleId: source.bibleId } : {}),
    ...(source.sourceDocumentId ? { sourceDocumentId: source.sourceDocumentId } : {}),
    ...(source.sourceStart !== null ? { sourceStart: source.sourceStart } : {}),
    ...(source.sourceEnd !== null ? { sourceEnd: source.sourceEnd } : {}),
    styleBible: source.styleBible,
    sourceText: source.sourceText,
    durationSec: core.durationSec,
    shotCount: core.shotCount,
    status: script.status,
    assetReviewStatus: normalizeAssetReviewStatus(script.assetReviewStatus),
    shots: core.shots,
    generationSegments: core.generationSegments,
    requirements,
  }
}

async function mapPersistedEditShotExecutionPlan(plan: PersistedEditShotExecutionPlan): Promise<EditShotExecutionPlanPayload> {
  const script = await getPersistedEditScript(plan.projectId, plan.episodeId, plan.editScriptId, plan.chapterId)
  if (!script) throw new Error(`EDIT_SCRIPT_NOT_FOUND:${plan.editScriptId}`)
  const core = normalizeEditScriptStructure(script.corePlanJson)
  const parsed = normalizeEditShotExecutionPlan(plan.executionPlanJson, core.shots, core.generationSegments)
  return {
    id: plan.id,
    projectId: plan.projectId,
    episodeId: plan.episodeId,
    chapterId: plan.chapterId,
    editScriptId: plan.editScriptId,
    status: plan.status,
    shots: parsed.shots,
    generationSegmentExecutions: parsed.generationSegmentExecutions,
  }
}

async function getPersistedEditScript(projectId: string, episodeId: string, editScriptId?: string, chapterId?: string): Promise<PersistedEditScript | null> {
  const resolvedChapterId = await resolveEditChapterId(episodeId, chapterId)
  return await prisma.projectEditScript.findFirst({
    where: {
      projectId,
      episodeId,
      chapterId: resolvedChapterId,
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


async function getPersistedEditShotExecutionPlan(projectId: string, episodeId: string, editScriptId?: string, chapterId?: string): Promise<PersistedEditShotExecutionPlan | null> {
  const resolvedChapterId = await resolveEditChapterId(episodeId, chapterId)
  return await prisma.projectEditShotExecutionPlan.findFirst({
    where: {
      projectId,
      episodeId,
      chapterId: resolvedChapterId,
      ...(editScriptId ? { editScriptId } : {}),
    },
  })
}

export async function resolveEditShotExecutionPlanTaskTarget(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly editScriptId?: string
}): Promise<{ readonly episodeId: string; readonly chapterId: string; readonly editScriptId: string }> {
  const editScript = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId, input.chapterId)
  if (!editScript) throw new ApiError('NOT_FOUND')
  if (editScript.status !== 'ready') {
    throw new Error(`EDIT_SCRIPT_NOT_READY:${editScript.id}`)
  }
  return {
    episodeId: editScript.episodeId,
    chapterId: editScript.chapterId,
    editScriptId: editScript.id,
  }
}

function buildChapterDurationGuidance(input: {
  readonly targetDurationSec: number
  readonly locale: Locale
}): string {
  if (input.locale === 'en') {
    return `Target chapter duration is around ${String(input.targetDurationSec)} seconds. Keep individual shots 1-5 seconds and preserve story continuity from the provided chapter source slice.`
  }
  return `本章目标时长约 ${String(input.targetDurationSec)} 秒。每个镜头保持 1-5 秒，并严格保留当前章节源文本中的剧情连续性。`
}

async function resolveChapterEditScriptSource(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
}): Promise<ChapterEditScriptSource> {
  return await assembleChapterPlanInput(input)
}

async function markEditScriptGenerating(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly initialDurationSeconds: number
}): Promise<void> {
  await prisma.projectEditScript.upsert({
    where: { chapterId: input.chapterId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId: input.chapterId,
      corePlanJson: Prisma.JsonNull,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'generating',
    },
    update: {
      corePlanJson: Prisma.JsonNull,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'generating',
    },
  })
}

async function persistEditScriptGenerationStep(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly durationSec: number
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly { readonly shotIds: readonly string[]; readonly continuity: string }[]
}) {
  await prisma.projectEditScript.upsert({
    where: { chapterId: input.chapterId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId: input.chapterId,
      corePlanJson: {
        shots: input.shots,
        generationSegments: input.generationSegments,
      } as unknown as Prisma.InputJsonValue,
      durationSec: input.durationSec,
      shotCount: input.shots.length,
      status: 'generating',
    },
    update: {
      corePlanJson: {
        shots: input.shots,
        generationSegments: input.generationSegments,
      } as unknown as Prisma.InputJsonValue,
      durationSec: input.durationSec,
      shotCount: input.shots.length,
      status: 'generating',
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
  readonly chapterId: string
  readonly initialDurationSeconds: number
  readonly message: string
}): Promise<void> {
  await prisma.projectEditScript.upsert({
    where: { chapterId: input.chapterId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId: input.chapterId,
      corePlanJson: Prisma.JsonNull,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'failed',
    },
    update: {
      corePlanJson: Prisma.JsonNull,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'failed',
    },
  })
}

async function markGeneratingEditScriptFailed(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly message: string
}): Promise<void> {
  const chapterId = await resolveEditChapterId(input.episodeId, input.chapterId)
  await prisma.projectEditScript.updateMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId,
      status: 'generating',
    },
    data: {
      status: 'failed',
    },
  })
}

export async function readProjectEditScript(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
}): Promise<EditScriptPayload | null> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId, undefined, input.chapterId)
  return script ? mapPersistedEditScript(script) : null
}

export async function readProjectEditScripts(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<EditScriptPayload[]> {
  const scripts = await prisma.projectEditScript.findMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
    },
    include: {
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return await Promise.all(scripts.map((script) => mapPersistedEditScript(script)))
}

export async function approveProjectEditScriptAssets(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly chapterId?: string
}): Promise<EditScriptPayload> {
  const scripts = input.chapterId
    ? [await (async () => {
        const chapterId = await resolveEditChapterId(input.episodeId, input.chapterId)
        return await prisma.projectEditScript.findFirst({
          where: {
            projectId: input.projectId,
            episodeId: input.episodeId,
            chapterId,
            project: {
              userId: input.userId,
            },
          },
          include: {
            requirements: {
              orderBy: editScriptRequirementOrderBy(),
            },
          },
        })
      })()]
    : await prisma.projectEditScript.findMany({
        where: {
          projectId: input.projectId,
          episodeId: input.episodeId,
          project: {
            userId: input.userId,
          },
        },
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        include: {
          requirements: {
            orderBy: editScriptRequirementOrderBy(),
          },
        },
      })
  const readyScripts: PersistedEditScript[] = scripts
    .filter((script): script is NonNullable<(typeof scripts)[number]> => Boolean(script))
  if (readyScripts.length === 0) throw new ApiError('NOT_FOUND')
  const mappedScripts = await Promise.all(readyScripts.map((script) => mapPersistedEditScript(script)))
  const notReady = mappedScripts.flatMap((script) =>
    script.requirements
      .filter((requirement) => requirement.status !== 'completed')
      .map((requirement) => requirement.name))
  if (notReady.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSETS_NOT_READY',
      message: `Edit script assets are not ready: ${notReady.join(', ')}`,
    })
  }
  const scriptIds = readyScripts.map((script) => script.id)
  await prisma.projectEditScript.updateMany({
    where: {
      id: { in: scriptIds },
      projectId: input.projectId,
      episodeId: input.episodeId,
      project: {
        userId: input.userId,
      },
    },
    data: {
      assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_APPROVED,
    },
  })
  return {
    ...mappedScripts[0],
    assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_APPROVED,
  }
}

export interface EpisodeEditScriptAssetApprovalResult {
  readonly approvedCount: number
  readonly scripts: readonly EditScriptPayload[]
}

export async function approveProjectEpisodeEditScriptAssets(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}): Promise<EpisodeEditScriptAssetApprovalResult> {
  const scripts = await prisma.projectEditScript.findMany({
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
    orderBy: { createdAt: 'asc' },
  })
  if (scripts.length === 0) throw new ApiError('NOT_FOUND')

  const notReady = scripts.flatMap((script) => {
    const chapterId = script.chapterId ?? 'unknown'
    return script.requirements
      .filter((requirement) => normalizeStoredStatus(requirement.status) !== 'completed')
      .map((requirement) => `${chapterId}:${requirement.name}`)
  })
  if (notReady.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSETS_NOT_READY',
      message: `Edit script assets are not ready: ${notReady.join(', ')}`,
    })
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.projectEditScript.updateMany({
      where: {
        id: { in: scripts.map((script) => script.id) },
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      data: {
        assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_APPROVED,
      },
    })
    return await tx.projectEditScript.findMany({
      where: {
        id: { in: scripts.map((script) => script.id) },
      },
      include: {
        requirements: {
          orderBy: [
            { kind: 'asc' },
            { name: 'asc' },
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    })
  })

  return {
    approvedCount: updated.length,
    scripts: await Promise.all(updated.map((script) => mapPersistedEditScript(script))),
  }
}

export async function confirmProjectEditStylePreview(input: ConfirmEditStylePreviewInput): Promise<EditStylePreviewPayload> {
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
      editBible: {
        include: {
          stylePreviews: true,
        },
      },
    },
  })
  if (!selectedPreview) throw new ApiError('NOT_FOUND')

  const editBible = selectedPreview.editBible
  if (editBible.episodeId !== input.episodeId) {
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

  const allPreviewsTerminal = editBible.stylePreviews.length > 0
    && editBible.stylePreviews.every((preview) => preview.status === 'completed' || preview.status === 'confirmed' || preview.status === 'failed')
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
        editBibleId: editBible.id,
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
    prisma.projectEditBible.update({
      where: { id: editBible.id },
      data: {
        styleBibleJson: styleBibleToJsonValue(selectedStyleBible),
      },
    }),
    prisma.project.update({
      where: { id: project.id },
      data: {
        videoRatio: selectedAspectRatio,
      },
    }),
  ])

  const next = await prisma.projectEditStylePreview.findUnique({
    where: { id: selectedPreview.id },
  })
  if (!next) throw new ApiError('NOT_FOUND')
  return mapPersistedStylePreview(next)
}

export async function readProjectEditShotExecutionPlan(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly editScriptId?: string
}): Promise<EditShotExecutionPlanPayload | null> {
  const plan = await getPersistedEditShotExecutionPlan(input.projectId, input.episodeId, input.editScriptId, input.chapterId)
  return plan ? await mapPersistedEditShotExecutionPlan(plan) : null
}

export async function readProjectEditShotExecutionPlans(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<EditShotExecutionPlanPayload[]> {
  const plans = await prisma.projectEditShotExecutionPlan.findMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
    },
    orderBy: { createdAt: 'asc' },
  })
  return await Promise.all(plans.map((plan) => mapPersistedEditShotExecutionPlan(plan)))
}

export async function updateProjectEditScriptAssetRequirementDescription(
  input: UpdateEditScriptAssetRequirementDescriptionInput,
): Promise<EditScriptPayload> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId, input.chapterId)
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

  const updated = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId, input.chapterId)
  if (!updated) throw new ApiError('NOT_FOUND')
  return await mapPersistedEditScript(updated)
}

async function buildEditStylePreviewImageTaskPayload(input: {
  readonly userId: string
  readonly imageModel: string
  readonly stylePreviewId: string
  readonly styleKey: EditStylePreviewKey
  readonly imagePrompt: string
}): Promise<{ readonly payload: Record<string, unknown>; readonly billingInfo: TaskBillingInfo }> {
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
  const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE, payload)
  if (!billingInfo || billingInfo.billable !== true || billingInfo.apiType !== 'image') {
    throw new Error('EDIT_STYLE_PREVIEW_IMAGE_BILLING_INFO_REQUIRED')
  }
  return { payload, billingInfo }
}

async function submitEditStylePreviewImageTask(input: {
  readonly request: NextRequest
  readonly userId: string
  readonly projectId: string
  readonly parentTaskId?: string | null
  readonly episodeId: string
  readonly locale: Locale
  readonly stylePreviewId: string
  readonly styleKey: EditStylePreviewKey
  readonly imagePrompt: string
  readonly imageModel: string
  readonly plannedPayload?: Record<string, unknown>
  readonly plannedBillingInfo?: TaskBillingInfo
  readonly operationConfirmed: boolean
  readonly operationRequestId?: string | null
}) {
  const planned = input.plannedPayload && input.plannedBillingInfo
    ? { payload: input.plannedPayload, billingInfo: input.plannedBillingInfo }
    : await buildEditStylePreviewImageTaskPayload(input)

  return await submitTask({
    requestId: input.request.headers.get('x-request-id'),
    userId: input.userId,
    locale: input.locale,
    projectId: input.projectId,
    parentTaskId: input.parentTaskId || null,
    episodeId: input.episodeId,
    type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    targetType: 'ProjectEditStylePreview',
    targetId: input.stylePreviewId,
    operationId: 'generate_edit_style_preview_image',
    operationSource: 'worker',
    operationConfirmed: input.operationConfirmed,
    operationRequestId: input.operationRequestId || null,
    payload: planned.payload,
    dedupeKey: `edit_style_preview_image:${input.projectId}:${input.episodeId}:${input.stylePreviewId}`,
    billingInfo: planned.billingInfo,
  })
}

export async function prepareProjectEditStylePreviewCandidates(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly bibleId?: string
  readonly styleDirection?: string
  readonly count?: number
  readonly plannedStylePreviewIds?: readonly string[]
  readonly plannedImageModel?: string
}): Promise<PreparedEditStylePreviewCandidates> {
  const locale = assertLocale(input.locale)
  const count = resolveStylePreviewCount(input.count)
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

  const bible = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: input.episodeId,
      ...(input.bibleId ? { id: input.bibleId } : {}),
      episode: {
        projectId: input.projectId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      bibleJson: true,
      beatSheetJson: true,
      emotionalCurveJson: true,
      status: true,
      stylePreviews: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          projectId: true,
          episodeId: true,
          editBibleId: true,
          styleKey: true,
          aspectRatio: true,
          title: true,
          summary: true,
          styleBibleJson: true,
          imagePrompt: true,
          imageKey: true,
          status: true,
          taskId: true,
          errorMessage: true,
        },
      },
    },
  })
  if (!bible) throw new ApiError('NOT_FOUND')
  if (bible.status !== EDIT_BIBLE_STATUS.READY_FOR_REVIEW && bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_STYLE_PREVIEW_PLANNING_NOT_READY',
      message: `Edit Bible must be ready for review before style preview planning; current status is ${bible.status}`,
    })
  }

  const plannedIds = input.plannedStylePreviewIds?.map((id) => id.trim()).filter(Boolean) ?? []
  let stylePreviews: PersistedEditStylePreview[]
  if (plannedIds.length > 0) {
    const plannedById = new Map(bible.stylePreviews.map((preview) => [preview.id, preview]))
    stylePreviews = plannedIds.map((id) => {
      const preview = plannedById.get(id)
      if (!preview) throw new Error(`EDIT_STYLE_PREVIEW_PLANNED_CANDIDATE_NOT_FOUND:${id}`)
      if (preview.status !== 'pending' || preview.taskId) {
        throw new Error(`EDIT_STYLE_PREVIEW_PLANNED_CANDIDATE_NOT_PENDING:${id}:${preview.status}`)
      }
      return preview
    })
    if (stylePreviews.length !== count) {
      throw new Error(`EDIT_STYLE_PREVIEW_PLANNED_COUNT_MISMATCH:expected=${String(count)}:actual=${String(stylePreviews.length)}`)
    }
  } else {
    const reusablePending = input.styleDirection?.trim()
      ? []
      : bible.stylePreviews.filter((preview) => preview.status === 'pending' && !preview.taskId)
    if (reusablePending.length === count) {
      stylePreviews = reusablePending
    } else {
      const chapters = await prisma.projectEditChapter.findMany({
        where: {
          episodeId: input.episodeId,
          targetDurationSec: { not: null },
        },
        orderBy: { chapterIndex: 'asc' },
        select: {
          chapterIndex: true,
          title: true,
          summary: true,
          targetDurationSec: true,
        },
      })
      const chapterContext = chapters.map((chapter): StylePreviewChapterContext => {
        if (chapter.targetDurationSec === null) {
          throw new Error(`EDIT_CHAPTER_TARGET_DURATION_REQUIRED:${String(chapter.chapterIndex)}`)
        }
        return {
          chapterIndex: chapter.chapterIndex,
          title: chapter.title,
          summary: chapter.summary,
          targetDurationSec: chapter.targetDurationSec,
        }
      })
      if (chapterContext.length < 1) throw new Error(`EDIT_BIBLE_CHAPTERS_REQUIRED:${bible.id}`)

      const styleOptions = await generateEditStylePreviewOptions({
        userId: input.userId,
        projectId: input.projectId,
        model: resolveTextModel(config),
        locale,
        userPrompt: buildEditBibleStylePreviewRequest({
          bibleJson: bible.bibleJson,
          locale,
        }),
        bibleText: buildEditBibleStylePreviewContext({
          bibleJson: bible.bibleJson,
          beatSheetJson: bible.beatSheetJson,
          emotionalCurveJson: bible.emotionalCurveJson,
          chapters: chapterContext,
        }),
        durationGuidance: buildEditBibleDurationGuidance({
          locale,
          chapters: chapterContext,
        }),
        styleDirection: input.styleDirection?.trim() ?? '',
        count,
      })
      const nextGeneration = resolveNextStylePreviewGeneration(
        bible.stylePreviews.map((preview) => preview.styleKey),
      )
      stylePreviews = await prisma.$transaction(async (tx) => {
        const created: PersistedEditStylePreview[] = []
        for (const option of styleOptions) {
          const styleKey = buildStylePreviewPersistenceKey(option.styleKey, nextGeneration)
          created.push(await tx.projectEditStylePreview.create({
            data: {
              projectId: input.projectId,
              episodeId: input.episodeId,
              editBibleId: bible.id,
              styleKey,
              aspectRatio: EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO,
              title: option.title,
              summary: option.summary,
              styleBibleJson: styleBibleToJsonValue(option.styleBible),
              imagePrompt: option.gridImagePrompt,
              status: 'pending',
            },
          }))
        }
        return created
      })
    }
  }

  const imageModel = input.plannedImageModel?.trim() || resolveStylePreviewImageModel(config)
  const candidates = await Promise.all(stylePreviews.map(async (preview) => {
    const task = await buildEditStylePreviewImageTaskPayload({
      userId: input.userId,
      imageModel,
      stylePreviewId: preview.id,
      styleKey: normalizeStylePreviewKey(preview.styleKey),
      imagePrompt: preview.imagePrompt,
    })
    return {
      preview,
      imageModel,
      payload: task.payload,
      billingInfo: task.billingInfo,
    }
  }))
  return { bibleId: bible.id, candidates }
}

export async function markProjectEditStylePreviewGenerationFailed(input: {
  readonly bibleId: string
  readonly message: string
}) {
  await prisma.$transaction([
    prisma.projectEditBible.update({
      where: { id: input.bibleId },
      data: {
        diagnosticsJson: {
          error: input.message,
          stage: 'style_preview_generation',
        },
      },
    }),
    prisma.projectEditStylePreview.updateMany({
      where: {
        editBibleId: input.bibleId,
        status: { in: ['pending', 'generating'] },
      },
      data: {
        status: 'failed',
        errorMessage: input.message,
      },
    }),
  ])
}

export async function generateProjectEditStylePreviews(input: GenerateEditStylePreviewsInput): Promise<EditStylePreviewGenerationPayload> {
  const locale = assertLocale(input.locale)
  const bible = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: input.episodeId,
      ...(input.bibleId ? { id: input.bibleId } : {}),
      episode: {
        projectId: input.projectId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      status: true,
    },
  })
  if (!bible) throw new ApiError('NOT_FOUND')
  const count = resolveStylePreviewCount(input.count)
  if (bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_CONFIRMATION_REQUIRED',
      message: `Edit Bible must be confirmed before style preview generation; current status is ${bible.status}`,
    })
  }
  const submittedTaskIds: string[] = []
  try {
    const prepared = await prepareProjectEditStylePreviewCandidates({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
      locale,
      bibleId: bible.id,
      count,
      ...(input.styleDirection ? { styleDirection: input.styleDirection } : {}),
      ...(input.plannedStylePreviewIds ? { plannedStylePreviewIds: input.plannedStylePreviewIds } : {}),
      ...(input.plannedImageModel ? { plannedImageModel: input.plannedImageModel } : {}),
    })
    const plannedMaxCost = prepared.candidates.reduce((total, candidate) => (
      candidate.billingInfo.billable ? total + candidate.billingInfo.maxFrozenCost : total
    ), 0)
    if (
      typeof input.confirmedMaxCost === 'number'
      && Number.isFinite(input.confirmedMaxCost)
      && plannedMaxCost > input.confirmedMaxCost
    ) {
      throw new Error(`EDIT_STYLE_PREVIEW_CONFIRMED_COST_EXCEEDED:confirmed=${String(input.confirmedMaxCost)}:actual=${String(plannedMaxCost)}`)
    }

    const submittedPreviews: Array<{
      readonly preview: PersistedEditStylePreview
      readonly taskId: string
    }> = []
    for (const candidate of prepared.candidates) {
      const preview = candidate.preview
      const result = await submitEditStylePreviewImageTask({
        request: input.request,
        userId: input.userId,
        projectId: input.projectId,
        parentTaskId: input.parentTaskId || null,
        episodeId: input.episodeId,
        locale,
        stylePreviewId: preview.id,
        styleKey: normalizeStylePreviewKey(preview.styleKey),
        imagePrompt: preview.imagePrompt,
        imageModel: candidate.imageModel,
        plannedPayload: candidate.payload,
        plannedBillingInfo: candidate.billingInfo,
        operationConfirmed: input.operationConfirmed,
        operationRequestId: input.operationRequestId || null,
      })
      submittedTaskIds.push(result.taskId)
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

    return {
      success: true,
      async: true,
      projectId: input.projectId,
      episodeId: input.episodeId,
      bibleId: bible.id,
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
    for (const taskId of submittedTaskIds) {
      await cancelTask(taskId, 'Visual style batch submission did not complete')
      await removeTaskJob(taskId).catch(() => false)
    }
    await markProjectEditStylePreviewGenerationFailed({
      bibleId: bible.id,
      message,
    })
    throw caught
  }
}

export async function generateProjectEditScript(input: GenerateEditScriptInput): Promise<EditScriptPayload> {
  try {
    return await generateProjectEditScriptInternal(input)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await markGeneratingEditScriptFailed({
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId: input.chapterId,
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
  const chapterId = await resolveEditChapterId(input.episodeId, input.chapterId)
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
  const scriptSource = await resolveChapterEditScriptSource({
    projectId: input.projectId,
    episodeId: input.episodeId,
    chapterId,
  })
  const userPrompt = [
    scriptSource.chapterTitle ? `Chapter title: ${scriptSource.chapterTitle}` : '',
    scriptSource.chapterSummary ? `Chapter summary: ${scriptSource.chapterSummary}` : '',
  ].filter(Boolean).join('\n')
  const durationGuidance = buildChapterDurationGuidance({
    targetDurationSec: scriptSource.targetDurationSec,
    locale,
  })
  await markEditScriptGenerating({
    projectId: input.projectId,
    episodeId: input.episodeId,
    chapterId,
    initialDurationSeconds: scriptSource.targetDurationSec,
  })
  await notifyGenerationStep(input.onGenerationStepPersisted, {
    stage: 'edit_script_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    progress: 18,
  })

  try {
    const knownAssets = await loadKnownPlanAssets(input.projectId)
    const structure = await runStructuredPromptStep({
      userId: input.userId,
      projectId: input.projectId,
      model,
      locale,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
      schema: buildChapterPlanOutputSchema(scriptSource.assetMenu),
      variables: {
        user_request: userPrompt,
        bible_text: scriptSource.sourceText,
        story_bible_json: stringifyForPrompt(scriptSource.storyBibleJson),
        entry_snapshot_json: stringifyForPrompt(scriptSource.entrySnapshot),
        chapter_events_json: stringifyForPrompt(scriptSource.events),
        asset_menu_json: stringifyForPrompt(scriptSource.assetMenu),
        duration_guidance: durationGuidance,
        generation_segment_max_duration_seconds: String(EDIT_GENERATION_SEGMENT_MAX_DURATION_SEC),
        aspect_ratio: effectiveVideoRatio,
        style_bible_json: stringifyForPrompt(scriptSource.styleBible),
      },
      stepTitle: 'Edit core table',
      stepIndex: 1,
      stepTotal: 1,
      validate: (raw) => {
        const normalized = normalizeChapterPlanOutput(raw, scriptSource.assetMenu)
        const withShotIds = rewriteStructureWithSystemShotIds(normalized)
        validateChapterPlan({
          chapterId,
          output: withShotIds,
          entrySnapshot: scriptSource.entrySnapshot,
          events: scriptSource.events,
        })
        return withShotIds
      },
    })
    const requirements = buildProjectedAssetRequirements({
      structure,
      knownAssets,
    })
    await persistEditScriptGenerationStep({
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId,
      durationSec: structure.durationSec,
      shots: structure.shots,
      generationSegments: structure.generationSegments,
    })
    await notifyGenerationStep(input.onGenerationStepPersisted, {
      stage: 'edit_script_primary',
      stageLabel: 'progress.stage.editScriptPrimary',
      progress: 82,
    })

    const core = structure

    const saved = await prisma.$transaction(async (tx) => {
      const script = await tx.projectEditScript.upsert({
        where: { chapterId },
        create: {
          projectId: input.projectId,
          episodeId: input.episodeId,
          chapterId,
          corePlanJson: {
            shots: core.shots,
            generationSegments: core.generationSegments,
          } as unknown as Prisma.InputJsonValue,
          durationSec: core.durationSec,
          shotCount: core.shotCount,
          status: 'ready',
          assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_PENDING,
        },
        update: {
          corePlanJson: {
            shots: core.shots,
            generationSegments: core.generationSegments,
          } as unknown as Prisma.InputJsonValue,
          durationSec: core.durationSec,
          shotCount: core.shotCount,
          status: 'ready',
          assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_PENDING,
        },
      })
      await tx.projectEditChapter.update({
        where: { id: chapterId },
        data: {
          entrySnapshotJson: scriptSource.entrySnapshot as unknown as Prisma.InputJsonValue,
          eventsJson: [...scriptSource.events] as unknown as Prisma.InputJsonValue,
          provenanceJson: {
            sourceDocumentId: scriptSource.sourceDocumentId,
            sourceStart: scriptSource.sourceStart,
            sourceEnd: scriptSource.sourceEnd,
            bibleId: scriptSource.bibleId,
            bibleVersion: scriptSource.bibleVersion,
            styleBibleChecksum: scriptSource.styleBibleChecksum,
            chapterIndex: scriptSource.chapterIndex,
            promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
            persistentFactsIntroduced: [...core.persistentFactsIntroduced],
          } as unknown as Prisma.InputJsonValue,
          planVersion: { increment: 1 },
          status: 'planned',
        },
      })
      await tx.projectEditAssetRequirement.deleteMany({
        where: { editScriptId: script.id },
      })
      for (const requirement of requirements) {
        await tx.projectEditAssetRequirement.create({
          data: {
            editScriptId: script.id,
            projectId: input.projectId,
            episodeId: input.episodeId,
            chapterId,
            kind: requirement.kind,
            name: requirement.name,
            description: requirement.description,
            requiredForShotIds: requirement.shotIds as unknown as Prisma.InputJsonValue,
            status: requirement.status ?? 'pending',
            targetId: requirement.targetId ?? null,
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
      stage: 'edit_script_persist',
      stageLabel: 'progress.stage.editScriptPersist',
      progress: 92,
    })

    return await mapPersistedEditScript(saved)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await markEditScriptFailed({
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId,
      initialDurationSeconds: scriptSource.targetDurationSec,
      message,
    })
    throw caught
  }
}

export async function generateProjectEditShotExecutionPlan(input: GenerateEditShotExecutionPlanInput): Promise<EditShotExecutionPlanPayload> {
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
  const chapterId = await resolveEditChapterId(input.episodeId, input.chapterId)
  const editScript = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId, chapterId)
  if (!editScript) throw new ApiError('NOT_FOUND')
  if (editScript.status !== 'ready') {
    throw new Error(`EDIT_SCRIPT_NOT_READY:${editScript.id}`)
  }
  const mappedEditScript = await mapPersistedEditScript(editScript)
  if (!mappedEditScript.styleBible) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STYLE_BIBLE_REQUIRED',
      message: 'Style Bible is required before shot execution plan generation',
    })
  }
  const editScriptId = mappedEditScript.id
  if (!editScriptId) {
    throw new Error(`EDIT_SCRIPT_ID_REQUIRED:${editScript.id}`)
  }
  const editBible = await prisma.projectEditBible.findUnique({
    where: { episodeId: input.episodeId },
    select: { bibleJson: true },
  })
  if (!editBible?.bibleJson) throw new Error('EDIT_SCRIPT_STORY_BIBLE_REQUIRED')
  const dialogueVoiceContext = resolveEditScriptDialogueVoiceContext({
    storyBibleJson: editBible.bibleJson,
    shots: mappedEditScript.shots,
  })
  const assets = await buildAssetSnapshots(mappedEditScript.requirements)
  const model = resolveTextModel(config)
  const parsed = await runStructuredPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN,
    variables: {
      style_bible_json: stringifyForPrompt(mappedEditScript.styleBible),
      structure_json: stringifyForPrompt(buildShotExecutionPlanPromptStructure({
        id: editScriptId,
        durationSec: mappedEditScript.durationSec,
        shotCount: mappedEditScript.shotCount,
        sourceText: mappedEditScript.sourceText ?? null,
        shots: mappedEditScript.shots,
        generationSegments: mappedEditScript.generationSegments,
      })),
      character_voice_profiles_json: stringifyForPrompt(dialogueVoiceContext.characters),
      dialogue_voice_context_json: stringifyForPrompt(dialogueVoiceContext.shots),
      asset_context_json: stringifyForPrompt(assets),
      spatial_profiles_json: stringifyForPrompt(assets
        .filter((asset) => asset.kind === 'location')
        .map((asset) => ({
          requirementId: asset.requirementId,
          name: asset.name,
          targetId: asset.targetId,
          shotIds: asset.shotIds,
          spatialProfile: asset.spatialProfile ?? null,
        }))),
    },
    stepTitle: 'Edit shot execution plan',
    stepIndex: 1,
    stepTotal: 1,
    validate: (raw) => normalizeEditShotExecutionPlan(raw, mappedEditScript.shots, mappedEditScript.generationSegments),
  })
  const executionPlanJson = {
    shots: parsed.shots,
    generationSegmentExecutions: parsed.generationSegmentExecutions,
  }
  const saved = await prisma.projectEditShotExecutionPlan.upsert({
    where: { chapterId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId,
      editScriptId: editScript.id,
      executionPlanJson: executionPlanJson as unknown as Prisma.InputJsonValue,
      status: 'ready',
    },
    update: {
      editScriptId: editScript.id,
      executionPlanJson: executionPlanJson as unknown as Prisma.InputJsonValue,
      status: 'ready',
    },
  })
  return await mapPersistedEditShotExecutionPlan(saved)
}
