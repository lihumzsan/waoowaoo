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
import { getSignedUrl } from '@/lib/storage'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  assembleChapterPlanInput,
  buildChapterPlanOutputSchema,
  normalizeChapterPlanOutput,
  projectChapterPersistentFacts,
  resolveDefaultEditChapter,
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
  parsePersistedEditShotExecutionPlan,
} from './normalize'
import type {
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
  EditScriptVideoRatio,
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
import {
  editStylePreviewKeySchema,
  editStylePreviewOptionsSchema,
  EDIT_STYLE_PREVIEW_KEYS,
  EDIT_STYLE_PREVIEW_MAX_COUNT,
  editScriptStyleBibleSchema,
} from './types'
import { EDIT_GENERATION_SEGMENT_MAX_DURATION_SEC } from './generation-segment-constraints'
import { buildShotExecutionPlanPromptStructure } from './shot-execution-plan-prompt'
import { projectEditScriptCoreNames } from './core-view'

interface GenerateEditScriptInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly userId: string
  readonly locale: Locale
  readonly taskId: string
  readonly videoRatio?: '9:16' | '16:9' | '21:9'
  readonly onGenerationStepPersisted?: (step: EditScriptGenerationStep) => Promise<void>
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
  readonly taskId: string
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
  readonly generationTaskId: string | null
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
  readonly updatedAt: Date
}

interface PersistedEditShotExecutionPlan {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly editScriptId: string
  readonly executionPlanJson: Prisma.JsonValue
  readonly status: string
  readonly generationTaskId: string | null
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

function createSystemSegmentId(): string {
  return `segment_${createShotCuid()}`
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
    segmentId: createSystemSegmentId(),
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
  if (config.locationModel) return config.locationModel
  throw new ApiError('INVALID_PARAMS', {
    code: 'PROJECT_LOCATION_MODEL_REQUIRED',
    message: 'Project location image model is required before visual style preview generation',
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
    updatedAt: preview.updatedAt,
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
  const knownAssets = await loadKnownPlanAssets(script.projectId)
  const core = script.corePlanJson
    ? projectEditScriptCoreNames(script.corePlanJson, knownAssets)
    : { durationSec: script.durationSec, shotCount: script.shotCount, shots: [], generationSegments: [] }
  const source = await resolvePersistedEditScriptSource(script)
  const requirements = await Promise.all(script.requirements.map(async (requirement): Promise<EditAssetRequirement> => {
    const currentAsset = requirement.targetId
      ? knownAssets.find((asset) => asset.id === requirement.targetId && asset.kind === requirement.kind)
      : null
    if (requirement.targetId && !currentAsset) {
      throw new Error(`EDIT_SCRIPT_REQUIREMENT_ASSET_UNKNOWN:${requirement.id}:${requirement.targetId}`)
    }
    const resolvedAsset = currentAsset?.asset ?? null
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
      name: currentAsset?.name ?? requirement.name,
      description: requirement.description,
      shotIds: readShotIds(requirement.requiredForShotIds),
      status,
      targetId: requirement.targetId,
      taskTargetType: resolvedAsset?.taskTargetType ?? null,
      taskTargetId: resolvedAsset?.taskTargetId ?? null,
      errorMessage: status === 'failed' ? taskFailure || requirement.errorMessage : null,
      previewImageUrl: resolvedAsset?.previewImageUrl ?? null,
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
    generationTaskId: script.generationTaskId,
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
  const parsed = parsePersistedEditShotExecutionPlan(plan.executionPlanJson, core.shots, core.generationSegments)
  return {
    id: plan.id,
    projectId: plan.projectId,
    episodeId: plan.episodeId,
    chapterId: plan.chapterId,
    editScriptId: plan.editScriptId,
    status: plan.status,
    generationTaskId: plan.generationTaskId,
    generationSegments: parsed.generationSegments,
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
      status: 'ready',
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
  readonly taskId: string
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
      generationTaskId: input.taskId,
    },
    update: {
      corePlanJson: Prisma.JsonNull,
      durationSec: input.initialDurationSeconds,
      shotCount: 0,
      status: 'generating',
      generationTaskId: input.taskId,
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
  readonly taskId: string
}) {
  const updated = await prisma.projectEditScript.updateMany({
    where: {
      chapterId: input.chapterId,
      generationTaskId: input.taskId,
      status: 'generating',
    },
    data: {
      corePlanJson: {
        shots: input.shots,
        generationSegments: input.generationSegments,
      } as unknown as Prisma.InputJsonValue,
      durationSec: input.durationSec,
      shotCount: input.shots.length,
    },
  })
  if (updated.count !== 1) {
    throw new Error(`EDIT_SCRIPT_TASK_OWNERSHIP_STALE:${input.chapterId}:${input.taskId}`)
  }
}

async function notifyGenerationStep(
  callback: GenerateEditScriptInput['onGenerationStepPersisted'],
  step: EditScriptGenerationStep,
) {
  if (!callback) return
  await callback(step)
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
  readonly client?: Prisma.TransactionClient
}): Promise<EpisodeEditScriptAssetApprovalResult> {
  const approve = async (tx: Prisma.TransactionClient) => {
    const scripts = await tx.projectEditScript.findMany({
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
  }
  const updated = input.client ? await approve(input.client) : await prisma.$transaction(approve)
  return {
    approvedCount: updated.length,
    scripts: await Promise.all(updated.map((script) => mapPersistedEditScript(script))),
  }
}

export async function confirmProjectEditStylePreview(
  input: ConfirmEditStylePreviewInput & { readonly client?: Prisma.TransactionClient },
): Promise<EditStylePreviewPayload> {
  const confirm = async (tx: Prisma.TransactionClient) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: { id: true },
    })
    if (!project) throw new ApiError('NOT_FOUND')

    const selectedPreview = await tx.projectEditStylePreview.findFirst({
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
    if (editBible.episodeId !== input.episodeId) throw new ApiError('NOT_FOUND')
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
    await tx.projectEditStylePreview.updateMany({
      where: {
        editBibleId: editBible.id,
        status: 'confirmed',
      },
      data: {
        status: 'completed',
      },
    })
    await tx.projectEditStylePreview.update({
      where: { id: selectedPreview.id },
      data: {
        status: 'confirmed',
        errorMessage: null,
      },
    })
    await tx.projectEditBible.update({
      where: { id: editBible.id },
      data: {
        styleBibleJson: styleBibleToJsonValue(selectedStyleBible),
      },
    })
    await tx.project.update({
      where: { id: project.id },
      data: {
        videoRatio: selectedAspectRatio,
      },
    })

    const next = await tx.projectEditStylePreview.findUnique({
      where: { id: selectedPreview.id },
    })
    if (!next) throw new ApiError('NOT_FOUND')
    return next
  }
  const next = input.client ? await confirm(input.client) : await prisma.$transaction(confirm)
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
      status: 'ready',
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

export async function resolveProjectEditStylePreviewOptionsTaskTarget(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly bibleId?: string
}): Promise<{ readonly bibleId: string; readonly generation: number; readonly requestOrdinal: number }> {
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
      stylePreviews: {
        select: {
          styleKey: true,
          status: true,
        },
      },
    },
  })
  if (!bible) throw new ApiError('NOT_FOUND')
  if (bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_STYLE_PREVIEW_PLANNING_NOT_READY',
      message: `Edit Bible must be confirmed before style direction generation; current status is ${bible.status}`,
    })
  }
  if (bible.stylePreviews.some((preview) => preview.status === 'pending' || preview.status === 'generating')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_STYLE_PREVIEW_IMAGE_PLAN_PENDING',
      message: 'The current visual style directions must finish image approval and generation before another direction batch can start.',
    })
  }
  const requestCount = await prisma.task.count({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: bible.id,
    },
  })
  return {
    bibleId: bible.id,
    generation: resolveNextStylePreviewGeneration(bible.stylePreviews.map((preview) => preview.styleKey)),
    requestOrdinal: requestCount + 1,
  }
}

export async function generateProjectEditStylePreviewOptions(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly bibleId: string
  readonly taskId: string
  readonly model: string
  readonly locale: Locale
  readonly styleDirection?: string
  readonly count?: number
  readonly generation: number
  readonly onOptionsGenerated: () => Promise<void>
}): Promise<{ readonly bibleId: string; readonly previews: readonly PersistedEditStylePreview[] }> {
  const locale = assertLocale(input.locale)
  const count = resolveStylePreviewCount(input.count)
  const persistedForTask = await prisma.projectEditStylePreview.findMany({
    where: { editBibleId: input.bibleId, taskId: input.taskId },
    orderBy: { styleKey: 'asc' },
  })
  if (persistedForTask.length > 0) {
    if (persistedForTask.length !== count) {
      throw new Error(`EDIT_STYLE_PREVIEW_OPTIONS_TASK_PARTIAL:${input.taskId}:${String(persistedForTask.length)}`)
    }
    return { bibleId: input.bibleId, previews: persistedForTask }
  }

  const [bible, chapters] = await Promise.all([
    prisma.projectEditBible.findFirst({
      where: {
        id: input.bibleId,
        episodeId: input.episodeId,
        episode: { projectId: input.projectId, project: { userId: input.userId } },
      },
      select: {
        id: true,
        bibleJson: true,
        beatSheetJson: true,
        emotionalCurveJson: true,
        status: true,
      },
    }),
    prisma.projectEditChapter.findMany({
      where: { episodeId: input.episodeId, targetDurationSec: { not: null } },
      orderBy: { chapterIndex: 'asc' },
      select: {
        chapterIndex: true,
        title: true,
        summary: true,
        targetDurationSec: true,
      },
    }),
  ])
  if (!bible) throw new ApiError('NOT_FOUND')
  if (bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new Error(`EDIT_BIBLE_STYLE_PREVIEW_OPTIONS_STALE:${bible.id}:${bible.status}`)
  }
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
    model: input.model,
    locale,
    userPrompt: buildEditBibleStylePreviewRequest({ bibleJson: bible.bibleJson, locale }),
    bibleText: buildEditBibleStylePreviewContext({
      bibleJson: bible.bibleJson,
      beatSheetJson: bible.beatSheetJson,
      emotionalCurveJson: bible.emotionalCurveJson,
      chapters: chapterContext,
    }),
    durationGuidance: buildEditBibleDurationGuidance({ locale, chapters: chapterContext }),
    styleDirection: input.styleDirection?.trim() ?? '',
    count,
  })
  await input.onOptionsGenerated()

  const previews = await prisma.$transaction(async (tx) => {
    const locked = (await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
      SELECT id, status
      FROM project_edit_bibles
      WHERE id = ${input.bibleId}
      FOR UPDATE
    `))[0] ?? null
    if (!locked || locked.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
      throw new Error(`EDIT_BIBLE_STYLE_PREVIEW_OPTIONS_STALE:${input.bibleId}:${locked?.status ?? 'missing'}`)
    }
    const existingOwned = await tx.projectEditStylePreview.findMany({
      where: { editBibleId: input.bibleId, taskId: input.taskId },
      orderBy: { styleKey: 'asc' },
    })
    if (existingOwned.length > 0) {
      if (existingOwned.length !== count) {
        throw new Error(`EDIT_STYLE_PREVIEW_OPTIONS_TASK_PARTIAL:${input.taskId}:${String(existingOwned.length)}`)
      }
      return existingOwned
    }
    const existing = await tx.projectEditStylePreview.findMany({
      where: { editBibleId: input.bibleId },
      select: { styleKey: true, status: true },
    })
    if (existing.some((preview) => preview.status === 'pending' || preview.status === 'generating')) {
      throw new Error(`EDIT_STYLE_PREVIEW_OPTIONS_ACTIVE_BATCH_EXISTS:${input.bibleId}`)
    }
    const currentGeneration = resolveNextStylePreviewGeneration(existing.map((preview) => preview.styleKey))
    if (currentGeneration !== input.generation) {
      throw new Error(`EDIT_STYLE_PREVIEW_OPTIONS_GENERATION_STALE:${String(input.generation)}:${String(currentGeneration)}`)
    }
    const created: PersistedEditStylePreview[] = []
    for (const option of styleOptions) {
      created.push(await tx.projectEditStylePreview.create({
        data: {
          projectId: input.projectId,
          episodeId: input.episodeId,
          editBibleId: bible.id,
          styleKey: buildStylePreviewPersistenceKey(option.styleKey, input.generation),
          aspectRatio: EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO,
          title: option.title,
          summary: option.summary,
          styleBibleJson: styleBibleToJsonValue(option.styleBible),
          imagePrompt: option.gridImagePrompt,
          status: 'pending',
          taskId: input.taskId,
        },
      }))
    }
    return created
  })
  return { bibleId: bible.id, previews }
}

export async function readProjectEditStylePreviewCandidatesForImagePlan(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly bibleId?: string
}): Promise<PreparedEditStylePreviewCandidates> {
  const [bible, config] = await Promise.all([
    prisma.projectEditBible.findFirst({
      where: {
        episodeId: input.episodeId,
        ...(input.bibleId ? { id: input.bibleId } : {}),
        episode: { projectId: input.projectId, project: { userId: input.userId } },
      },
      select: {
        id: true,
        status: true,
        stylePreviews: {
          where: { status: 'pending' },
          orderBy: { styleKey: 'asc' },
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
            updatedAt: true,
          },
        },
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!bible) throw new ApiError('NOT_FOUND')
  if (bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new Error(`EDIT_STYLE_PREVIEW_IMAGE_PLAN_BIBLE_NOT_CONFIRMED:${bible.status}`)
  }
  if (bible.stylePreviews.length < 1 || bible.stylePreviews.length > EDIT_STYLE_PREVIEW_MAX_COUNT) {
    throw new Error(`EDIT_STYLE_PREVIEW_IMAGE_PLAN_COUNT_INVALID:${String(bible.stylePreviews.length)}`)
  }
  const optionTaskIds = new Set(bible.stylePreviews.map((preview) => preview.taskId).filter((taskId): taskId is string => Boolean(taskId)))
  if (optionTaskIds.size !== 1) throw new Error('EDIT_STYLE_PREVIEW_IMAGE_PLAN_OPTIONS_TASK_MISMATCH')
  const optionTaskId = [...optionTaskIds][0]
  if (!optionTaskId) throw new Error('EDIT_STYLE_PREVIEW_IMAGE_PLAN_OPTIONS_TASK_REQUIRED')
  const optionTask = await prisma.task.findFirst({
    where: {
      id: optionTaskId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: bible.id,
      status: TASK_STATUS.COMPLETED,
    },
    select: { id: true },
  })
  if (!optionTask) throw new Error(`EDIT_STYLE_PREVIEW_IMAGE_PLAN_OPTIONS_TASK_NOT_COMPLETED:${optionTaskId}`)

  const imageModel = resolveStylePreviewImageModel(config)
  const candidates = await Promise.all(bible.stylePreviews.map(async (preview) => {
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

export async function generateProjectEditScript(input: GenerateEditScriptInput): Promise<EditScriptPayload> {
  return await generateProjectEditScriptInternal(input)
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
  const completedOwnedByThisTask = await prisma.projectEditScript.findFirst({
    where: { chapterId, generationTaskId: input.taskId, status: 'ready' },
    select: { id: true },
  })
  if (completedOwnedByThisTask) {
    const completed = await getPersistedEditScript(
      input.projectId,
      input.episodeId,
      completedOwnedByThisTask.id,
      chapterId,
    )
    if (!completed) throw new Error(`EDIT_SCRIPT_COMPLETED_RESOURCE_MISSING:${completedOwnedByThisTask.id}`)
    return await mapPersistedEditScript(completed)
  }
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
    taskId: input.taskId,
  })
  await notifyGenerationStep(input.onGenerationStepPersisted, {
    stage: 'edit_script_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    progress: 18,
  })

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
        asset_menu_json: stringifyForPrompt({
          locations: scriptSource.assetMenu.locations.map(({ name, description }) => ({ name, description })),
          characters: scriptSource.assetMenu.characters.map(({ name, description }) => ({ name, description })),
        }),
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
        return rewriteStructureWithSystemShotIds(normalized)
      },
    })
    // Asset generation runs in parallel with core planning. Reload after the
    // model step so an image/profile that completed during planning is
    // projected as ready instead of leaving a stale pending requirement.
    const requirements = buildProjectedAssetRequirements({
      structure,
      knownAssets: await loadKnownPlanAssets(input.projectId),
    })
    await persistEditScriptGenerationStep({
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId,
      durationSec: structure.durationSec,
      shots: structure.shots,
      generationSegments: structure.generationSegments,
      taskId: input.taskId,
    })
    await notifyGenerationStep(input.onGenerationStepPersisted, {
      stage: 'edit_script_primary',
      stageLabel: 'progress.stage.editScriptPrimary',
      progress: 82,
    })

    const core = structure

    const saved = await prisma.$transaction(async (tx) => {
      const projected = await tx.projectEditScript.updateMany({
        where: {
          chapterId,
          generationTaskId: input.taskId,
          status: 'generating',
        },
        data: {
          corePlanJson: {
            shots: core.shots,
            generationSegments: core.generationSegments,
          } as unknown as Prisma.InputJsonValue,
          durationSec: core.durationSec,
          shotCount: core.shotCount,
          status: 'ready',
          assetReviewStatus: EDIT_SCRIPT_ASSET_REVIEW_PENDING,
          generationTaskId: input.taskId,
        },
      })
      if (projected.count !== 1) {
        throw new Error(`EDIT_SCRIPT_TASK_OWNERSHIP_STALE:${chapterId}:${input.taskId}`)
      }
      const script = await tx.projectEditScript.findUniqueOrThrow({ where: { chapterId } })
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
            persistentFactsIntroduced: projectChapterPersistentFacts(scriptSource.events),
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
      select: { id: true, videoRatio: true },
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
  const completedByThisTask = await prisma.projectEditShotExecutionPlan.findFirst({
    where: {
      chapterId,
      editScriptId,
      generationTaskId: input.taskId,
      status: 'ready',
    },
  })
  if (completedByThisTask) return await mapPersistedEditShotExecutionPlan(completedByThisTask)
  await prisma.projectEditShotExecutionPlan.upsert({
    where: { chapterId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId,
      editScriptId,
      executionPlanJson: {} as Prisma.InputJsonValue,
      status: 'generating',
      generationTaskId: input.taskId,
    },
    update: {
      editScriptId,
      executionPlanJson: {} as Prisma.InputJsonValue,
      status: 'generating',
      generationTaskId: input.taskId,
    },
  })
  const model = resolveTextModel(config)
  const parsed = await runStructuredPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN,
    variables: {
      visual_style: mappedEditScript.styleBible.visualStyle,
      aspect_ratio: project.videoRatio,
      structure_json: stringifyForPrompt(buildShotExecutionPlanPromptStructure({
        durationSec: mappedEditScript.durationSec,
        shotCount: mappedEditScript.shotCount,
        sourceText: mappedEditScript.sourceText ?? null,
        shots: mappedEditScript.shots,
        generationSegments: mappedEditScript.generationSegments,
      })),
    },
    stepTitle: 'Edit shot execution plan',
    stepIndex: 1,
    stepTotal: 1,
    validate: (raw) => normalizeEditShotExecutionPlan(raw, mappedEditScript.shots, mappedEditScript.generationSegments),
  })
  const executionPlanJson = {
    generationSegments: parsed.generationSegments,
  }
  await prisma.$transaction(async (tx) => {
    const projected = await tx.projectEditShotExecutionPlan.updateMany({
      where: {
        chapterId,
        editScriptId: editScript.id,
        generationTaskId: input.taskId,
        status: 'generating',
      },
      data: {
        executionPlanJson: executionPlanJson as unknown as Prisma.InputJsonValue,
        status: 'ready',
        generationTaskId: input.taskId,
      },
    })
    if (projected.count !== 1) {
      throw new Error(`EDIT_SHOT_EXECUTION_PLAN_TASK_OWNERSHIP_STALE:${editScript.id}:${input.taskId}`)
    }
  })
  const saved = await prisma.projectEditShotExecutionPlan.findUniqueOrThrow({ where: { chapterId } })
  return await mapPersistedEditShotExecutionPlan(saved)
}
