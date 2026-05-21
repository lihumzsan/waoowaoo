import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { withTextBilling } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { encodeImageUrls, decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { PRIMARY_APPEARANCE_INDEX, isArtStyleValue } from '@/lib/constants'
import { submitAssetGenerateTask } from '@/lib/assets/services/asset-actions'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import type { Locale } from '@/i18n/routing'
import {
  applyEditScriptVideoPrompts,
  normalizeEditAssetRequirements,
  normalizeEditScriptStructure,
  resolveEditScriptDefaults,
} from './normalize'
import type {
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
  EditScreenplayPayload,
  EditScriptPayload,
  EditScriptStyleBible,
  EditScriptShot,
  EditScriptVideoBlock,
} from './types'
import {
  editScriptStyleBibleSchema,
  editScriptVideoPromptBlockSchema,
} from './types'
import { designEditAssetRequirements } from './asset-design'

interface GenerateEditScriptInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly screenplayId?: string
  readonly videoRatio?: '9:16' | '16:9' | '21:9'
  readonly artStyle?: string
  readonly onGenerationStepPersisted?: (step: EditScriptGenerationStep) => Promise<void>
}

interface GenerateEditScreenplayInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly prompt: string
  readonly videoRatio?: '9:16' | '16:9' | '21:9'
  readonly artStyle?: string
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
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_TIMELINE
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_VISUAL_ACTION
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_CAMERA
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_AUDIO
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT
  | typeof AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK

type EditScriptGenerationStage =
  | 'edit_script_prepare'
  | 'edit_script_style_bible'
  | 'edit_script_timeline'
  | 'edit_script_visual_action'
  | 'edit_script_camera'
  | 'edit_script_audio'
  | 'edit_script_primary'
  | 'edit_script_asset_extract'
  | 'edit_script_video_prompt'

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
  readonly shotsJson: Prisma.JsonValue
  readonly videoBlocksJson: Prisma.JsonValue | null
  readonly requirements: readonly PersistedEditScriptRequirement[]
}

interface PersistedEditScreenplay {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly screenplayText: string
  readonly status: string
}

interface ExistingAssetRef {
  readonly id: string
  readonly previewImageUrl: string | null
  readonly hasOutput: boolean
  readonly taskTargetType: 'CharacterAppearance' | 'LocationImage'
  readonly taskTargetId: string
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

interface EditScriptProjectStyleInput {
  readonly artStyle: string | null
  readonly aspectRatio: string | null
}

function buildProjectStyleInput(input: {
  readonly artStyle: string | null
  readonly videoRatio: string | null
}): EditScriptProjectStyleInput {
  return {
    artStyle: input.artStyle,
    aspectRatio: input.videoRatio,
  }
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

function styleBibleToJsonValue(styleBible: EditScriptStyleBible): Prisma.InputJsonValue {
  return styleBible as unknown as Prisma.InputJsonValue
}

function buildVideoPromptAssetContext(requirements: readonly EditAssetRequirement[]): string {
  return stringifyForPrompt({
    assets: requirements.map((requirement) => {
      const voiceTimbreText = requirement.voiceTimbreText?.trim() ?? null
      if (requirement.kind === 'character' && !voiceTimbreText) {
        throw new Error(`EDIT_SCRIPT_CHARACTER_VOICE_TIMBRE_MISSING:${requirement.name}`)
      }
      return {
        kind: requirement.kind,
        name: requirement.name,
        description: requirement.description,
        voiceTimbreText: requirement.kind === 'character' ? voiceTimbreText : null,
        shotNumbers: requirement.shotNumbers,
      }
    }),
    rules: [
      'Use these asset descriptions as fixed character and location identity context when writing video prompts.',
      'For character dialogue, use voiceTimbreText as the fixed voice timbre and write dialogue in the form: character says {exact line} with the fixed voice timbre attached to the speaker.',
      'Do not invent additional reusable characters or locations beyond the screenplay and edit structure.',
      'Do not copy asset descriptions verbatim when they would overtake shot action; use them to preserve identity and scene continuity.',
    ],
  })
}

function intersectsShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  const rightSet = new Set(right)
  return left.some((shotNumber) => rightSet.has(shotNumber))
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function blockShots(structure: Omit<EditScriptPayload, 'requirements' | 'styleBible'>, block: EditScriptVideoBlock): readonly EditScriptShot[] {
  return block.shotNumbers.map((shotNumber) => {
    const shot = structure.shots.find((item) => item.shotNumber === shotNumber)
    if (!shot) throw new Error(`EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_SHOT_MISSING:${shotNumber}`)
    return shot
  })
}

function adjacentVideoBlocks(structure: Omit<EditScriptPayload, 'requirements' | 'styleBible'>, blockIndex: number) {
  return {
    previous: blockIndex > 0 ? structure.videoBlocks[blockIndex - 1] ?? null : null,
    next: blockIndex < structure.videoBlocks.length - 1 ? structure.videoBlocks[blockIndex + 1] ?? null : null,
  }
}

function videoPromptBlockContext(input: {
  readonly structure: Omit<EditScriptPayload, 'requirements' | 'styleBible'>
  readonly block: EditScriptVideoBlock
  readonly blockIndex: number
}) {
  return {
    sourceVideoBlockIndex: input.blockIndex,
    videoBlock: input.block,
    shots: blockShots(input.structure, input.block),
  }
}

async function generateEditScriptVideoPromptsByBlock(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly userPrompt: string
  readonly screenplayText: string
  readonly structure: Omit<EditScriptPayload, 'requirements' | 'styleBible'>
  readonly requirements: readonly EditAssetRequirement[]
  readonly aspectRatio: string
  readonly styleBible: EditScriptStyleBible
}): Promise<Omit<EditScriptPayload, 'requirements' | 'styleBible'>> {
  const blockOutputs = await Promise.all(input.structure.videoBlocks.map(async (block, blockIndex) => {
    const shotNumbers = block.shotNumbers
    const blockRequirements = input.requirements.filter((requirement) => intersectsShotNumbers(requirement.shotNumbers, shotNumbers))
    const raw = await runPromptStep({
      userId: input.userId,
      projectId: input.projectId,
      model: input.model,
      locale: input.locale,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK,
      variables: {
        user_request: input.userPrompt,
        screenplay_text: input.screenplayText,
        style_bible_json: stringifyForPrompt(input.styleBible),
        video_block_json: stringifyForPrompt(videoPromptBlockContext({ structure: input.structure, block, blockIndex })),
        block_shots_json: stringifyForPrompt(blockShots(input.structure, block)),
        asset_context_json: buildVideoPromptAssetContext(blockRequirements),
        adjacent_blocks_json: stringifyForPrompt(adjacentVideoBlocks(input.structure, blockIndex)),
        aspect_ratio: input.aspectRatio,
      },
      stepTitle: `Edit video prompts for block ${blockIndex + 1}`,
      stepIndex: 3,
      stepTotal: 3,
    })
    const parsed = editScriptVideoPromptBlockSchema.parse(raw)
    if (parsed.sourceVideoBlockIndex !== blockIndex) {
      throw new Error(`EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_INDEX_MISMATCH:${blockIndex}`)
    }
    if (!sameShotNumbers(parsed.shotNumbers, block.shotNumbers) || !sameShotNumbers(parsed.videoBlock.shotNumbers, block.shotNumbers)) {
      throw new Error(`EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_SHOTS_MISMATCH:${block.shotNumbers.join(',')}`)
    }
    return parsed
  }))
  return applyEditScriptVideoPrompts(input.structure, {
    shots: blockOutputs.flatMap((block) => block.shots),
    videoBlocks: blockOutputs.map((block) => block.videoBlock),
  })
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
  const finalPrompt = buildAiPrompt({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
  })
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const action = input.promptId
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPrompt }],
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
  const finalPrompt = buildAiPrompt({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
  })
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const action = input.promptId
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPrompt }],
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

async function generateEditScriptStyleBible(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly userPrompt: string
  readonly durationSeconds: number
  readonly aspectRatio: string
  readonly projectStyle: EditScriptProjectStyleInput
}): Promise<EditScriptStyleBible> {
  const raw = await runPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model: input.model,
    locale: input.locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE,
    variables: {
      user_request: input.userPrompt,
      duration_seconds: String(input.durationSeconds),
      aspect_ratio: input.aspectRatio,
      project_style_json: stringifyForPrompt(input.projectStyle),
    },
    stepTitle: 'Edit style bible',
    stepIndex: 1,
    stepTotal: 2,
  })
  return editScriptStyleBibleSchema.parse(raw).styleBible
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
      visualAction: String(item.visualAction ?? ''),
      charactersAndScene: String(item.charactersAndScene ?? ''),
      camera: String(item.camera ?? ''),
      videoPrompt: String(item.videoPrompt ?? ''),
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
  const image = location?.images[0]
  if (!location || !image) return null
  return {
    id: location.id,
    previewImageUrl: image.imageUrl || null,
    hasOutput: Boolean(image.imageMediaId || image.imageUrl),
    taskTargetType: 'LocationImage',
    taskTargetId: location.id,
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
      voiceTimbreText: null,
      previewImageUrl: resolvedAsset?.previewImageUrl ?? null,
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
    screenplayText: screenplay.screenplayText,
    status: screenplay.status,
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

async function markEditScriptGenerating(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible
  readonly screenplayText: string
  readonly durationSeconds: number
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
      durationSec: input.durationSeconds,
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
      durationSec: input.durationSeconds,
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
  readonly durationSeconds: number
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
      durationSec: input.durationSeconds,
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
        artStyle: true,
        videoRatio: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')
  const effectiveVideoRatio = input.videoRatio ?? project.videoRatio
  const effectiveArtStyle = input.artStyle ?? project.artStyle
  if (input.artStyle && !isArtStyleValue(input.artStyle)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      message: 'artStyle must be a supported value',
    })
  }
  if ((input.videoRatio && input.videoRatio !== project.videoRatio)
    || (input.artStyle && input.artStyle !== project.artStyle)) {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
        ...(input.artStyle ? { artStyle: input.artStyle } : {}),
      },
    })
  }

  const model = resolveTextModel(config)
  const defaults = resolveEditScriptDefaults(input.prompt)
  const projectStyle = buildProjectStyleInput({
    artStyle: effectiveArtStyle,
    videoRatio: effectiveVideoRatio,
  })
  const styleBible = await generateEditScriptStyleBible({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    userPrompt: input.prompt,
    durationSeconds: defaults.durationSeconds,
    aspectRatio: effectiveVideoRatio,
    projectStyle,
  })
  const screenplayText = await runPromptTextStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
    variables: {
      user_request: input.prompt,
      duration_seconds: String(defaults.durationSeconds),
      aspect_ratio: effectiveVideoRatio,
      style_bible_json: stringifyForPrompt(styleBible),
    },
    stepTitle: 'Edit screenplay',
    stepIndex: 2,
    stepTotal: 2,
  })
  const saved = await prisma.projectEditScreenplay.upsert({
    where: { episodeId: input.episodeId },
    create: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      userPrompt: input.prompt,
      styleBibleJson: styleBibleToJsonValue(styleBible),
      screenplayText,
      status: 'ready',
    },
    update: {
      userPrompt: input.prompt,
      styleBibleJson: styleBibleToJsonValue(styleBible),
      screenplayText,
      status: 'ready',
    },
  })
  return mapPersistedEditScreenplay(saved)
}

export async function generateProjectEditScript(input: GenerateEditScriptInput): Promise<EditScriptPayload> {
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
        artStyle: true,
        videoRatio: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!episode || !project) throw new ApiError('NOT_FOUND')
  const effectiveVideoRatio = input.videoRatio ?? project.videoRatio
  const effectiveArtStyle = input.artStyle ?? project.artStyle
  if (input.artStyle && !isArtStyleValue(input.artStyle)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      message: 'artStyle must be a supported value',
    })
  }
  if ((input.videoRatio && input.videoRatio !== project.videoRatio)
    || (input.artStyle && input.artStyle !== project.artStyle)) {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
        ...(input.artStyle ? { artStyle: input.artStyle } : {}),
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
  const defaults = resolveEditScriptDefaults(userPrompt)
  const screenplayText = screenplay.screenplayText
  await markEditScriptGenerating({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userPrompt,
    styleBible,
    screenplayText,
    durationSeconds: defaults.durationSeconds,
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
        duration_seconds: String(defaults.durationSeconds),
        aspect_ratio: effectiveVideoRatio,
        style_bible_json: stringifyForPrompt(styleBible),
      },
      stepTitle: 'Edit core table',
      stepIndex: 1,
      stepTotal: 3,
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
      stepTotal: 3,
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

    const core = await generateEditScriptVideoPromptsByBlock({
      userId: input.userId,
      projectId: input.projectId,
      model,
      locale,
      userPrompt,
      screenplayText,
      structure,
      requirements,
      aspectRatio: effectiveVideoRatio,
      styleBible,
    })

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
      stageLabel: 'progress.stage.editScriptVideoPrompt',
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
      durationSeconds: defaults.durationSeconds,
      message,
    })
    throw caught
  }
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
}): Promise<void> {
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

  await submitAssetGenerateTask({
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
}

export async function generateProjectEditScriptAssets(input: GenerateEditScriptAssetsInput): Promise<EditScriptPayload> {
  const script = await getPersistedEditScript(input.projectId, input.episodeId, input.editScriptId)
  if (!script) throw new ApiError('NOT_FOUND')

  const requirements = input.requirementId
    ? script.requirements.filter((requirement) => requirement.id === input.requirementId)
    : script.requirements
  if (input.requirementId && requirements.length === 0) throw new ApiError('NOT_FOUND')

  for (const requirement of requirements) {
    if (!isEditAssetKind(requirement.kind)) {
      await prisma.projectEditAssetRequirement.update({
        where: { id: requirement.id },
        data: { status: 'failed', errorMessage: `Unsupported asset kind: ${requirement.kind}` },
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
      await submitRequirementImageTask({
        request: input.request,
        projectId: input.projectId,
        episodeId: input.episodeId,
        userId: input.userId,
        locale: input.locale,
        kind: requirement.kind,
        assetId: asset.id,
      })
    } catch (error) {
      if (createdAssetId) {
        await deleteCreatedAsset({ kind: requirement.kind, id: createdAssetId })
      }
      await prisma.projectEditAssetRequirement.update({
        where: { id: requirement.id },
        data: {
          targetId: existing?.id ?? null,
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const updated = await getPersistedEditScript(input.projectId, input.episodeId, script.id)
  if (!updated) throw new ApiError('NOT_FOUND')
  return await mapPersistedEditScript(updated)
}
