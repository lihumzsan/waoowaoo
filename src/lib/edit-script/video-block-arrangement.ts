import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
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
import { editScriptStyleBibleSchema, editScriptVideoBlockArrangementSchema } from './types'
import { assertNoRunningVideoGroupOverlap } from './video-group-running-guard'

interface ArrangeEditScriptVideoBlocksInput {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly blocks: readonly {
    readonly shotNumbers: readonly number[]
  }[]
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
  readonly shotsJson: Prisma.JsonValue
  readonly videoBlocksJson: Prisma.JsonValue | null
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly requirements: readonly PersistedEditScriptRequirement[]
}

interface DraftVideoBlock {
  readonly blockIndex: number
  readonly videoBlock: EditScriptVideoBlock
  readonly durationSec: number
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

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
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
    styleBible: parseStyleBibleJson(script.styleBibleJson),
    shots,
    videoBlocks: parseVideoBlocksJson(script.videoBlocksJson, shots),
    requirements: persistedRequirementsForPrompt(script),
  }
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
    styleBible: parseStyleBibleJson(script.styleBibleJson),
    shots,
    videoBlocks: parseVideoBlocksJson(script.videoBlocksJson, shots),
  }
}

function blockShots(shots: readonly EditScriptShot[], block: EditScriptVideoBlock): readonly EditScriptShot[] {
  return block.shotNumbers.map((shotNumber) => {
    const shot = shots.find((item) => item.shotNumber === shotNumber)
    if (!shot) throw new Error(`EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_SHOT_MISSING:${shotNumber}`)
    return shot
  })
}

function assertArrangementOrder(input: {
  readonly requestedBlocks: readonly { readonly shotNumbers: readonly number[] }[]
  readonly allShotNumbers: readonly number[]
}): void {
  const expected = new Set(input.allShotNumbers)
  const seen = new Set<number>()
  const flattened: number[] = []
  input.requestedBlocks.forEach((block) => {
    if (block.shotNumbers.length === 0 || block.shotNumbers.length > 9) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_BLOCK_SIZE_INVALID',
      })
    }
    block.shotNumbers.forEach((shotNumber) => {
      if (!Number.isInteger(shotNumber) || shotNumber <= 0 || !expected.has(shotNumber)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_SHOT_INVALID',
          shotNumber,
        })
      }
      if (seen.has(shotNumber)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_SHOT_DUPLICATE',
          shotNumber,
        })
      }
      seen.add(shotNumber)
      flattened.push(shotNumber)
    })
  })
  if (flattened.length !== input.allShotNumbers.length) {
    input.allShotNumbers.forEach((shotNumber) => {
      if (!seen.has(shotNumber)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_SHOT_MISSING',
          shotNumber,
        })
      }
    })
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_ORDER_INVALID',
      receivedShotCount: flattened.length,
      expectedShotCount: input.allShotNumbers.length,
    })
  }
  flattened.forEach((shotNumber, index) => {
    const expectedShotNumber = input.allShotNumbers[index]
    if (shotNumber !== expectedShotNumber) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_ORDER_INVALID',
        shotNumber,
        expectedShotNumber,
        position: index,
      })
    }
  })
}

function assertDurationSupported(block: EditScriptVideoBlock, shots: readonly EditScriptShot[]): number {
  const durationSec = totalVideoGroupDuration(blockShots(shots, block))
  if (durationSec > 15) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_DURATION_EXCEEDED',
      durationSec,
      maxDurationSec: 15,
      shotNumbers: block.shotNumbers,
    })
  }
  return durationSec
}

function findReusableBlock(
  blocks: readonly EditScriptVideoBlock[],
  shotNumbers: readonly number[],
): EditScriptVideoBlock | null {
  return blocks.find((block) => sameShotNumbers(block.shotNumbers, shotNumbers)) ?? null
}

function buildDraftVideoBlocks(input: {
  readonly structure: Omit<EditScriptPayload, 'requirements'>
  readonly requestedBlocks: readonly { readonly shotNumbers: readonly number[] }[]
}): readonly DraftVideoBlock[] {
  assertArrangementOrder({
    requestedBlocks: input.requestedBlocks,
    allShotNumbers: input.structure.shots.map((shot) => shot.shotNumber),
  })

  return input.requestedBlocks.map((block, blockIndex) => {
    const reusable = findReusableBlock(input.structure.videoBlocks, block.shotNumbers)
    const kind = block.shotNumbers.length === 1 ? 'single' : 'group'
    const videoBlock: EditScriptVideoBlock = kind === 'single'
      ? {
          kind,
          shotNumbers: [...block.shotNumbers],
          reason: reusable?.reason ?? `Manual single-shot video segment ${blockIndex + 1}`,
          prompt: reusable?.prompt ?? `Shot ${block.shotNumbers[0]} video prompt.`,
        }
      : {
          kind,
          shotNumbers: [...block.shotNumbers],
          gridMode: inferVideoGridModeForShotCount(block.shotNumbers.length),
          reason: reusable?.reason ?? `Manual grouped video segment ${blockIndex + 1}`,
          prompt: reusable?.prompt ?? `Shots ${block.shotNumbers.join(', ')} continuous video prompt.`,
        }
    return {
      blockIndex,
      videoBlock,
      durationSec: assertDurationSupported(videoBlock, input.structure.shots),
    }
  })
}

function changedDraftBlocks(input: {
  readonly previousBlocks: readonly EditScriptVideoBlock[]
  readonly draftBlocks: readonly DraftVideoBlock[]
}): readonly DraftVideoBlock[] {
  return input.draftBlocks.filter((draft) => {
    const previous = input.previousBlocks[draft.blockIndex] ?? null
    return !previous || !sameShotNumbers(previous.shotNumbers, draft.videoBlock.shotNumbers)
  })
}

function affectedShotNumbers(input: {
  readonly previousBlocks: readonly EditScriptVideoBlock[]
  readonly changedBlocks: readonly DraftVideoBlock[]
  readonly draftBlockCount: number
}): readonly number[] {
  const affected = new Set<number>()
  input.changedBlocks.forEach((draft) => {
    draft.videoBlock.shotNumbers.forEach((shotNumber) => affected.add(shotNumber))
    const previous = input.previousBlocks[draft.blockIndex]
    previous?.shotNumbers.forEach((shotNumber) => affected.add(shotNumber))
  })
  input.previousBlocks.slice(input.draftBlockCount).forEach((block) => {
    block.shotNumbers.forEach((shotNumber) => affected.add(shotNumber))
  })
  return [...affected]
}

function resolveTextModel(config: Awaited<ReturnType<typeof getProjectModelConfig>>): string {
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit-first video block arrangement',
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

async function runArrangementPromptStep(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly variables: Record<string, string>
}): Promise<Record<string, unknown>> {
  const promptId = AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT
  const finalPrompt = buildAiPrompt({
    promptId,
    locale: input.locale,
    variables: input.variables,
  })
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPrompt }],
    temperature: 0.4,
    projectId: input.projectId,
    action: promptId,
    meta: {
      stepId: promptId,
      stepTitle: 'Arrange edit video blocks',
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

function rewriteChangedDraftBlocks(input: {
  readonly draftBlocks: readonly DraftVideoBlock[]
  readonly changedBlocks: readonly DraftVideoBlock[]
  readonly raw: Record<string, unknown>
}): readonly EditScriptVideoBlock[] {
  const parsed = editScriptVideoBlockArrangementSchema.parse(input.raw)
  const outputByIndex = new Map(parsed.videoBlocks.map((block) => [block.blockIndex, block]))
  return input.draftBlocks.map((draft) => {
    const shouldRewrite = input.changedBlocks.some((changed) => changed.blockIndex === draft.blockIndex)
    if (!shouldRewrite) return draft.videoBlock

    const output = outputByIndex.get(draft.blockIndex)
    if (!output) throw new Error(`EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_OUTPUT_MISSING:${draft.blockIndex}`)
    if (!sameShotNumbers(output.shotNumbers, draft.videoBlock.shotNumbers)) {
      throw new Error(`EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_SHOTS_MISMATCH:${draft.videoBlock.shotNumbers.join(',')}`)
    }

    return {
      ...draft.videoBlock,
      reason: output.reason.trim(),
      prompt: output.prompt.trim(),
    }
  })
}

function normalizeArrangedVideoBlocks(input: {
  readonly blocks: readonly EditScriptVideoBlock[]
  readonly shots: readonly EditScriptShot[]
}): readonly EditScriptVideoBlock[] {
  return normalizeVideoBlockPlanResponse({
    response: { items: input.blocks },
    allShotNumbers: input.shots.map((shot) => shot.shotNumber),
    shots: input.shots,
    enforceSingleMinDuration: false,
  }).items
}

export async function arrangeProjectEditScriptVideoBlocks(
  input: ArrangeEditScriptVideoBlocksInput,
): Promise<EditScriptPayload> {
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
  const draftBlocks = buildDraftVideoBlocks({
    structure,
    requestedBlocks: input.blocks,
  })
  const changedBlocks = changedDraftBlocks({
    previousBlocks: structure.videoBlocks,
    draftBlocks,
  })
  if (changedBlocks.length === 0 && draftBlocks.length === structure.videoBlocks.length) {
    return mapPersistedEditScript(script)
  }

  await assertNoRunningVideoGroupOverlap({
    projectId: input.projectId,
    episodeId: input.episodeId,
    errorCode: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_RUNNING_VIDEO_GROUP',
    shotNumbers: affectedShotNumbers({
      previousBlocks: structure.videoBlocks,
      changedBlocks,
      draftBlockCount: draftBlocks.length,
    }),
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
  const raw = await runArrangementPromptStep({
    userId: input.userId,
    projectId: input.projectId,
    model,
    locale: input.locale,
    variables: {
      user_request: script.userPrompt,
      screenplay_text: script.screenplayText ?? '',
      previous_video_blocks_json: stringifyForPrompt(structure.videoBlocks.map((block, blockIndex) => ({
        blockIndex,
        ...block,
      }))),
      draft_video_blocks_json: stringifyForPrompt(draftBlocks.map((draft) => ({
        blockIndex: draft.blockIndex,
        durationSec: draft.durationSec,
        ...draft.videoBlock,
      }))),
      changed_video_blocks_json: stringifyForPrompt(changedBlocks.map((draft) => ({
        blockIndex: draft.blockIndex,
        durationSec: draft.durationSec,
        ...draft.videoBlock,
      }))),
      changed_block_shots_json: stringifyForPrompt(changedBlocks.map((draft) => ({
        blockIndex: draft.blockIndex,
        shots: blockShots(structure.shots, draft.videoBlock),
      }))),
      asset_context_json: buildVideoPromptAssetContext(persistedRequirementsForPrompt(script)),
      aspect_ratio: project.videoRatio ?? '',
      style_bible_json: stringifyForPrompt(styleBible),
    },
  })
  const nextBlocks = normalizeArrangedVideoBlocks({
    blocks: rewriteChangedDraftBlocks({ draftBlocks, changedBlocks, raw }),
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
