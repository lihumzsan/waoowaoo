import type {
  EditAssetRequirement,
  EditScriptPayload,
  EditScriptShot,
} from './types'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import {
  editDirectorDecoupageSchema,
  editAssetExtractionSchema,
  editScriptCoreSchema,
  editScriptStructureSchema,
  editScriptVideoPromptSchema,
} from './types'

function uniquePositiveNumbers(values: readonly number[]): number[] {
  const seen = new Set<number>()
  const output: number[] = []
  values.forEach((value) => {
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) return
    seen.add(value)
    output.push(value)
  })
  return output.sort((left, right) => left - right)
}

export function normalizeEditScriptCore(raw: unknown): Omit<EditScriptPayload, 'requirements' | 'styleBible' | 'assetReviewStatus'> {
  const parsed = editScriptCoreSchema.parse(raw)

  const shots: EditScriptShot[] = parsed.shots
    .map((shot) => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      dramaticPurpose: shot.dramaticPurpose.trim(),
      visibleAction: shot.visibleAction.trim(),
      audienceFocus: shot.audienceFocus.trim(),
      viewpoint: shot.viewpoint.trim(),
      revealPlan: shot.revealPlan.trim(),
      performanceBeat: shot.performanceBeat.trim(),
      continuityIn: shot.continuityIn.trim(),
      continuityOut: shot.continuityOut.trim(),
      charactersAndScene: shot.charactersAndScene.trim(),
      sound: shot.sound.trim(),
    }))
    .sort((left, right) => left.shotNumber - right.shotNumber)

  shots.forEach((shot, index) => {
    const expectedNumber = index + 1
    if (shot.shotNumber !== expectedNumber) {
      throw new Error(`EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS:${shot.shotNumber}:${expectedNumber}`)
    }
  })

  const durationSec = shots.reduce((total, shot) => total + shot.durationSec, 0)
  const videoBlocks = normalizeVideoBlockPlanResponse({
    response: { items: parsed.videoBlocks },
    allShotNumbers: shots.map((shot) => shot.shotNumber),
    shots,
  }).items
  return {
    title: parsed.title.trim(),
    logline: parsed.logline?.trim() || null,
    durationSec,
    shotCount: shots.length,
    shots,
    videoBlocks,
  }
}

export function normalizeEditScriptStructure(raw: unknown): Omit<EditScriptPayload, 'requirements' | 'styleBible' | 'assetReviewStatus'> {
  const parsed = editScriptStructureSchema.parse(raw)

  const shots: EditScriptShot[] = parsed.shots
    .map((shot) => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      dramaticPurpose: shot.dramaticPurpose.trim(),
      visibleAction: shot.visibleAction.trim(),
      audienceFocus: shot.audienceFocus.trim(),
      viewpoint: shot.viewpoint.trim(),
      revealPlan: shot.revealPlan.trim(),
      performanceBeat: shot.performanceBeat.trim(),
      continuityIn: shot.continuityIn.trim(),
      continuityOut: shot.continuityOut.trim(),
      charactersAndScene: shot.charactersAndScene.trim(),
      sound: shot.sound.trim(),
    }))
    .sort((left, right) => left.shotNumber - right.shotNumber)

  shots.forEach((shot, index) => {
    const expectedNumber = index + 1
    if (shot.shotNumber !== expectedNumber) {
      throw new Error(`EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS:${shot.shotNumber}:${expectedNumber}`)
    }
  })

  const durationSec = shots.reduce((total, shot) => total + shot.durationSec, 0)
  const videoBlocks = normalizeVideoBlockPlanResponse({
    response: {
      items: parsed.videoBlocks.map((block) => ({
        ...block,
        prompt: 'Pending final video prompt.',
      })),
    },
    allShotNumbers: shots.map((shot) => shot.shotNumber),
    shots,
  }).items

  return {
    title: parsed.title.trim(),
    logline: parsed.logline?.trim() || null,
    durationSec,
    shotCount: shots.length,
    shots,
    videoBlocks,
  }
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

export function applyEditScriptVideoPrompts(
  structure: Omit<EditScriptPayload, 'requirements' | 'styleBible' | 'assetReviewStatus'>,
  raw: unknown,
): Omit<EditScriptPayload, 'requirements' | 'styleBible' | 'assetReviewStatus'> {
  const parsed = editScriptVideoPromptSchema.parse(raw)
  const expectedShotNumbers = structure.shots.map((shot) => shot.shotNumber)
  const providedShotNumbers = parsed.shots.map((shot) => shot.shotNumber).sort((left, right) => left - right)
  if (!sameShotNumbers(providedShotNumbers, expectedShotNumbers)) {
    throw new Error('EDIT_SCRIPT_VIDEO_PROMPT_SHOT_COVERAGE_INVALID')
  }
  if (parsed.videoBlocks.length !== structure.videoBlocks.length) {
    throw new Error('EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_COUNT_INVALID')
  }

  const remainingBlockIndexes = new Set(structure.videoBlocks.map((_, index) => index))
  const nextBlocks = structure.videoBlocks.map((block) => {
    const matchIndex = parsed.videoBlocks.findIndex((candidate, index) =>
      remainingBlockIndexes.has(index) && sameShotNumbers(candidate.shotNumbers, block.shotNumbers),
    )
    if (matchIndex < 0) {
      throw new Error(`EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_MISSING:${block.shotNumbers.join(',')}`)
    }
    remainingBlockIndexes.delete(matchIndex)
    const matched = parsed.videoBlocks[matchIndex]
    if (!matched) throw new Error(`EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_MISSING:${block.shotNumbers.join(',')}`)
    return {
      ...block,
      prompt: matched.prompt.trim(),
    }
  })
  if (remainingBlockIndexes.size > 0) {
    throw new Error('EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_COUNT_INVALID')
  }

  return {
    ...structure,
    shots: structure.shots,
    videoBlocks: nextBlocks,
  }
}

export function normalizeDirectorDecoupage(raw: unknown) {
  const parsed = editDirectorDecoupageSchema.parse(raw)
  const shots = parsed.shots
    .map((shot): EditScriptShot => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      dramaticPurpose: shot.dramaticPurpose.trim(),
      visibleAction: shot.visibleAction.trim(),
      audienceFocus: shot.audienceFocus.trim(),
      viewpoint: shot.viewpoint.trim(),
      revealPlan: shot.revealPlan.trim(),
      performanceBeat: shot.performanceBeat.trim(),
      continuityIn: shot.continuityIn.trim(),
      continuityOut: shot.continuityOut.trim(),
      charactersAndScene: shot.charactersAndScene.trim(),
      sound: shot.sound.trim(),
    }))
    .sort((left, right) => left.shotNumber - right.shotNumber)
  shots.forEach((shot, index) => {
    const expectedNumber = index + 1
    if (shot.shotNumber !== expectedNumber) {
      throw new Error(`EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS:${shot.shotNumber}:${expectedNumber}`)
    }
  })
  return {
    strategy: parsed.strategy,
    schemaVersion: parsed.schemaVersion,
    shots,
    hardBans: parsed.hardBans.map((item) => item.trim()),
  }
}

export function normalizeEditAssetRequirements(
  raw: unknown,
  shots: readonly EditScriptShot[],
): EditAssetRequirement[] {
  const parsed = editAssetExtractionSchema.parse(raw)
  const validShotNumbers = new Set(shots.map((shot) => shot.shotNumber))
  const seen = new Set<string>()
  const assets: EditAssetRequirement[] = []

  parsed.assets.forEach((asset) => {
    const name = asset.name.trim()
    const key = `${asset.kind}:${name.toLocaleLowerCase()}`
    if (seen.has(key)) return
    const shotNumbers = uniquePositiveNumbers(asset.shotNumbers)
      .filter((shotNumber) => validShotNumbers.has(shotNumber))
    if (shotNumbers.length === 0) {
      throw new Error(`EDIT_SCRIPT_ASSET_HAS_NO_VALID_SHOTS:${asset.kind}:${name}`)
    }
    seen.add(key)
    assets.push({
      kind: asset.kind,
      name,
      description: asset.description.trim(),
      shotNumbers,
      status: 'pending',
      targetId: null,
      errorMessage: null,
    })
  })

  if (assets.length === 0) {
    throw new Error('EDIT_SCRIPT_ASSET_EXTRACTION_EMPTY')
  }

  return assets
}
