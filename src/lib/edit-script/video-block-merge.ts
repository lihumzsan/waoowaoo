import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenProviderMessageContent } from '@/lib/ai-providers/shared/llm-support'
import { withTextBilling } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { inferVideoGridModeForShotCount, totalVideoGroupDuration } from '@/lib/video-groups/core'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import type { Locale } from '@/i18n/routing'
import type {
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
  EditScriptPayload,
  EditScriptShot,
  EditScriptStyleBible,
  EditScriptVideoBlock,
} from './types'
import { editScriptStyleBibleSchema, editScriptVideoBlockMergeSchema } from './types'
import { assertNoRunningVideoGroupOverlap } from './video-group-running-guard'

const EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS = 1024

interface MergeEditScriptVideoBlocksInput {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly leftBlockIndex: number
  readonly rightBlockIndex: number
  readonly userId: string
  readonly locale: Locale
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
  readonly screenplayText: string | null
  readonly title: string
  readonly logline: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly shotsJson: Prisma.JsonValue
  readonly videoBlocksJson: Prisma.JsonValue | null
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly requirements: readonly PersistedEditScriptRequirement[]
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function parseStyleBibleJson(value: Prisma.JsonValue | null): EditScriptStyleBible {
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) {
    throw new Error('EDIT_SCRIPT_STYLE_BIBLE_REQUIRED')
  }
  return parsed.data.styleBible
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEditAssetKind(value: string): value is EditAssetKind {
  return value === 'character' || value === 'location'
}

function normalizeStoredStatus(value: string): EditAssetStatus {
  if (value === 'pending' || value === 'generating' || value === 'completed' || value === 'failed') {
    return value
  }
  throw new Error(`EDIT_SCRIPT_ASSET_STATUS_INVALID:${value}`)
}

function readShotNumbers(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' && Number.isInteger(item) ? item : null))
    .filter((item): item is number => item !== null && item > 0)
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

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function blockShots(structure: Omit<EditScriptPayload, 'requirements'>, block: EditScriptVideoBlock): readonly EditScriptShot[] {
  return block.shotNumbers.map((shotNumber) => {
    const shot = structure.shots.find((item) => item.shotNumber === shotNumber)
    if (!shot) throw new Error(`EDIT_SCRIPT_VIDEO_BLOCK_MERGE_SHOT_MISSING:${shotNumber}`)
    return shot
  })
}

function buildStructureFromPersistedScript(script: PersistedEditScript): Omit<EditScriptPayload, 'requirements'> {
  const shots = parseShotsJson(script.shotsJson)
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    userPrompt: script.userPrompt,
    screenplayText: script.screenplayText,
    title: script.title,
    logline: script.logline,
    durationSec: script.durationSec,
    shotCount: script.shotCount,
    status: script.status,
    assetReviewStatus: script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    styleBible: parseStyleBibleJson(script.styleBibleJson),
    shots,
    videoBlocks: parseVideoBlocksJson(script.videoBlocksJson, shots),
  }
}

function assertConsecutiveBlockIndexes(leftBlockIndex: number, rightBlockIndex: number): void {
  if (rightBlockIndex !== leftBlockIndex + 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_VIDEO_BLOCK_MERGE_REQUIRES_ADJACENT_BLOCKS',
    })
  }
}

function assertContinuousShotNumbers(shotNumbers: readonly number[]): void {
  shotNumbers.forEach((shotNumber, index) => {
    if (!Number.isInteger(shotNumber) || shotNumber <= 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_MERGE_SHOT_NUMBERS_INVALID',
      })
    }
    if (index === 0) return
    if (shotNumber !== shotNumbers[index - 1] + 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_MERGE_REQUIRES_CONTINUOUS_SHOTS',
      })
    }
  })
}

function assertMergeDurationSupported(durationSec: number): void {
  if (durationSec > 15) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_VIDEO_BLOCK_MERGE_DURATION_EXCEEDED',
      durationSec,
      maxDurationSec: 15,
    })
  }
}

function resolveTextModel(config: Awaited<ReturnType<typeof getProjectModelConfig>>): string {
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit-first video block merge',
    })
  }
  return config.analysisModel
}

function buildVideoPromptAssetContext(requirements: readonly EditAssetRequirement[]): string {
  return stringifyForPrompt({
    assets: requirements.map((requirement) => ({
      kind: requirement.kind,
      name: requirement.name,
      description: requirement.description,
      shotNumbers: requirement.shotNumbers,
    })),
    rules: [
      'Use these asset descriptions as fixed character and location identity context when writing video prompts.',
      'Do not invent additional reusable characters or locations beyond the screenplay and edit structure.',
      'Do not copy asset descriptions verbatim when they would overtake shot action; use them to preserve identity and scene continuity.',
    ],
  })
}

function persistedRequirementsForPrompt(script: PersistedEditScript): readonly EditAssetRequirement[] {
  return script.requirements.map((requirement) => {
    if (!isEditAssetKind(requirement.kind)) {
      throw new Error(`EDIT_SCRIPT_ASSET_KIND_INVALID:${requirement.kind}`)
    }
    return {
      id: requirement.id,
      kind: requirement.kind,
      name: requirement.name,
      description: requirement.description,
      shotNumbers: readShotNumbers(requirement.shotIndexes),
      status: normalizeStoredStatus(requirement.status),
      targetId: requirement.targetId,
      errorMessage: requirement.errorMessage,
    }
  })
}

function mergedAdjacentVideoBlocks(structure: Omit<EditScriptPayload, 'requirements'>, leftBlockIndex: number, rightBlockIndex: number) {
  return {
    previous: leftBlockIndex > 0 ? structure.videoBlocks[leftBlockIndex - 1] ?? null : null,
    next: rightBlockIndex < structure.videoBlocks.length - 1 ? structure.videoBlocks[rightBlockIndex + 1] ?? null : null,
  }
}

function normalizeMergedVideoBlocks(params: {
  readonly blocks: readonly EditScriptVideoBlock[]
  readonly leftBlockIndex: number
  readonly rightBlockIndex: number
  readonly mergedBlock: EditScriptVideoBlock
  readonly shots: readonly EditScriptShot[]
}): readonly EditScriptVideoBlock[] {
  return normalizeVideoBlockPlanResponse({
    response: {
      items: [
        ...params.blocks.slice(0, params.leftBlockIndex),
        params.mergedBlock,
        ...params.blocks.slice(params.rightBlockIndex + 1),
      ],
    },
    allShotNumbers: params.shots.map((shot) => shot.shotNumber),
    shots: params.shots,
    enforceSingleMinDuration: false,
  }).items
}

function mapPersistedEditScript(script: PersistedEditScript): EditScriptPayload {
  const shots = parseShotsJson(script.shotsJson)
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    userPrompt: script.userPrompt,
    screenplayText: script.screenplayText,
    title: script.title,
    logline: script.logline,
    durationSec: script.durationSec,
    shotCount: script.shotCount,
    status: script.status,
    assetReviewStatus: script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    styleBible: parseStyleBibleJson(script.styleBibleJson),
    shots,
    videoBlocks: parseVideoBlocksJson(script.videoBlocksJson, shots),
    requirements: persistedRequirementsForPrompt(script),
  }
}

async function runMergePromptStep(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly variables: Record<string, string>
}): Promise<Record<string, unknown>> {
  const promptId = AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_MERGE
  const finalPromptContent = buildAiPromptContent({
    promptId,
    locale: input.locale,
    variables: input.variables,
    cacheVariableKeys: Object.keys(input.variables),
    minCacheChars: EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS,
  })
  const finalPrompt = flattenProviderMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.4,
    projectId: input.projectId,
    action: promptId,
    meta: {
      stepId: promptId,
      stepTitle: 'Merge edit video blocks',
      stepIndex: 1,
      stepTotal: 1,
    },
  })
  const completion = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    { projectId: input.projectId, action: promptId, metadata: { promptId } },
    runCompletion,
  )
  if (!completion.text.trim()) {
    throw new Error(`EDIT_SCRIPT_PROMPT_EMPTY:${promptId}`)
  }
  return safeParseJsonObject(completion.text)
}

export async function mergeProjectEditScriptVideoBlocks(
  input: MergeEditScriptVideoBlocksInput,
): Promise<EditScriptPayload> {
  assertConsecutiveBlockIndexes(input.leftBlockIndex, input.rightBlockIndex)

  const script = await prisma.projectEditScript.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      id: input.editScriptId,
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

  const structure = buildStructureFromPersistedScript(script)
  const styleBible = parseStyleBibleJson(script.styleBibleJson)
  const leftBlock = structure.videoBlocks[input.leftBlockIndex]
  const rightBlock = structure.videoBlocks[input.rightBlockIndex]
  if (!leftBlock || !rightBlock) throw new ApiError('INVALID_PARAMS')

  const mergedShotNumbers = [...leftBlock.shotNumbers, ...rightBlock.shotNumbers]
  assertContinuousShotNumbers(mergedShotNumbers)
  const gridMode = inferVideoGridModeForShotCount(mergedShotNumbers.length)
  const mergedDraftBlock: EditScriptVideoBlock = {
    kind: 'group',
    shotNumbers: mergedShotNumbers,
    gridMode,
    reason: `${leftBlock.reason}\n${rightBlock.reason}`,
    prompt: `${leftBlock.prompt}\n${rightBlock.prompt}`,
  }
  const mergedShots = blockShots(structure, mergedDraftBlock)
  const durationSec = totalVideoGroupDuration(mergedShots)
  assertMergeDurationSupported(durationSec)

  await assertNoRunningVideoGroupOverlap({
    projectId: input.projectId,
    episodeId: input.episodeId,
    errorCode: 'EDIT_SCRIPT_VIDEO_BLOCK_MERGE_RUNNING_VIDEO_GROUP',
    shotNumbers: mergedShotNumbers,
  })

  const [project, config] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        videoRatio: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!project) throw new ApiError('NOT_FOUND')
  const model = resolveTextModel(config)
  const raw = await runMergePromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale: input.locale,
    variables: {
      user_request: script.userPrompt,
      screenplay_text: script.screenplayText ?? '',
      merged_video_block_json: stringifyForPrompt({
        ...mergedDraftBlock,
        durationSec,
      }),
      source_video_blocks_json: stringifyForPrompt([
        { sourceVideoBlockIndex: input.leftBlockIndex, videoBlock: leftBlock },
        { sourceVideoBlockIndex: input.rightBlockIndex, videoBlock: rightBlock },
      ]),
      merged_block_shots_json: stringifyForPrompt(mergedShots),
      asset_context_json: buildVideoPromptAssetContext(persistedRequirementsForPrompt(script)),
      adjacent_blocks_json: stringifyForPrompt(mergedAdjacentVideoBlocks(structure, input.leftBlockIndex, input.rightBlockIndex)),
      aspect_ratio: project.videoRatio ?? '',
      style_bible_json: stringifyForPrompt(styleBible),
    },
  })
  const parsed = editScriptVideoBlockMergeSchema.parse(raw)
  if (!sameShotNumbers(parsed.shotNumbers, mergedShotNumbers)) {
    throw new Error(`EDIT_SCRIPT_VIDEO_BLOCK_MERGE_SHOTS_MISMATCH:${mergedShotNumbers.join(',')}`)
  }

  const mergedBlock: EditScriptVideoBlock = {
    kind: 'group',
    shotNumbers: mergedShotNumbers,
    gridMode,
    reason: parsed.reason.trim(),
    prompt: parsed.prompt.trim(),
  }
  const nextBlocks = normalizeMergedVideoBlocks({
    blocks: structure.videoBlocks,
    leftBlockIndex: input.leftBlockIndex,
    rightBlockIndex: input.rightBlockIndex,
    mergedBlock,
    shots: structure.shots,
  })

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

  return mapPersistedEditScript(updated)
}
