import type {
  EditAssetRequirement,
  EditGenerationSegment,
  EditGenerationSegmentExecution,
  EditScriptPayload,
  EditScriptShot,
  EditShotExecution,
  EditShotExecutionPlanPayload,
} from './types'
import {
  editAssetExtractionSchema,
  editScriptCoreSchema,
  editShotExecutionPlanSchema,
  rawEditShotExecutionPlanSchema,
} from './types'
import { assertEditGenerationSegmentDurationsSupported } from './generation-segment-constraints'
import { editSegmentModelRef, editShotModelRef } from './model-references'

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  values.forEach((value) => {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    output.push(normalized)
  })
  return output
}

function assertContinuousShotNumbers(shots: readonly { readonly shotNumber: number }[]): void {
  shots.forEach((shot, index) => {
    const expectedNumber = index + 1
    if (shot.shotNumber !== expectedNumber) {
      throw new Error(`EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS:${shot.shotNumber}:${expectedNumber}`)
    }
  })
}

function assertDialogueSpeakersInShot(shot: EditScriptShot): void {
  const characterIds = new Set(shot.characters.map((character) => character.characterId.trim()))
  shot.dialogue.forEach((line) => {
    if (!characterIds.has(line.characterId.trim())) {
      throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
    }
  })
}

function normalizeShots(shots: readonly EditScriptShot[]): readonly EditScriptShot[] {
  const normalized = shots
    .map((shot): EditScriptShot => ({
      shotId: shot.shotId.trim(),
      shotNumber: shot.shotNumber,
      shotPurpose: shot.shotPurpose,
      durationSec: shot.durationSec,
      scene: {
        locationId: shot.scene.locationId.trim(),
        name: shot.scene.name.trim(),
        subScene: shot.scene.subScene.trim(),
      },
      action: shot.action.trim(),
      characters: shot.characters.map((character) => ({
        characterId: character.characterId.trim(),
        name: character.name.trim(),
        performance: character.performance.trim(),
      })),
      dialogue: shot.dialogue.map((line) => ({
        characterId: line.characterId.trim(),
        line: line.line.trim(),
      })),
      synchronousSound: shot.synchronousSound.trim(),
    }))
    .sort((left, right) => left.shotNumber - right.shotNumber)
  assertContinuousShotNumbers(normalized)
  const shotIds = new Set<string>()
  normalized.forEach((shot) => {
    if (shotIds.has(shot.shotId)) throw new Error(`EDIT_SCRIPT_SHOT_ID_DUPLICATE:${shot.shotId}`)
    assertDialogueSpeakersInShot(shot)
    shotIds.add(shot.shotId)
  })
  return normalized
}

function assertGenerationSegments(
  segments: readonly EditGenerationSegment[],
  shots: readonly EditScriptShot[],
): readonly EditGenerationSegment[] {
  const shotIds = shots.map((shot) => shot.shotId)
  const shotOrder = new Map(shotIds.map((shotId, index) => [shotId, index]))
  const shotsById = new Map(shots.map((shot) => [shot.shotId, shot]))
  const segmentIds = new Set<string>()
  const flattened = segments.flatMap((segment) => segment.shotIds)
  if (flattened.length !== shotIds.length) {
    throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_COVERAGE_INVALID:${flattened.length}:${shotIds.length}`)
  }
  flattened.forEach((shotId, index) => {
    if (shotId !== shotIds[index]) {
      throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID:${shotId}:${shotIds[index]}`)
    }
  })
  const normalized = segments.map((segment) => {
    const segmentId = segment.segmentId.trim()
    if (segmentIds.has(segmentId)) throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_ID_DUPLICATE:${segmentId}`)
    segmentIds.add(segmentId)
    segment.shotIds.forEach((shotId, index) => {
      const order = shotOrder.get(shotId)
      if (order === undefined) throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_UNKNOWN_SHOT:${shotId}`)
      if (index > 0) {
        const previousOrder = shotOrder.get(segment.shotIds[index - 1])
        if (previousOrder === undefined || order !== previousOrder + 1) {
          throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_NOT_CONTINUOUS:${segment.shotIds.join(',')}`)
        }
      }
    })
    const segmentDurationSec = segment.shotIds.reduce((total, shotId) => {
      const shot = shotsById.get(shotId)
      if (!shot) throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_UNKNOWN_SHOT:${shotId}`)
      return total + shot.durationSec
    }, 0)
    const segmentShotIds = new Set(segment.shotIds)
    const soundCues = segment.soundCues.map((cue) => {
      const sourceShotId = cue.sourceShotId?.trim() || null
      if (cue.endSec <= cue.startSec) {
        throw new Error(`EDIT_SCRIPT_SOUND_CUE_RANGE_INVALID:${segmentId}:${cue.startSec}:${cue.endSec}`)
      }
      if (cue.endSec > segmentDurationSec) {
        throw new Error(`EDIT_SCRIPT_SOUND_CUE_OUT_OF_BOUNDS:${segmentId}:${cue.endSec}:${segmentDurationSec}`)
      }
      if (sourceShotId && !segmentShotIds.has(sourceShotId)) {
        throw new Error(`EDIT_SCRIPT_SOUND_CUE_SOURCE_SHOT_NOT_IN_SEGMENT:${segmentId}:${sourceShotId}`)
      }
      if (cue.kind === 'dialogue') {
        const sourceShot = sourceShotId ? shotsById.get(sourceShotId) : undefined
        if (!sourceShotId || !sourceShot?.dialogue.length) {
          throw new Error(`EDIT_SCRIPT_SOUND_CUE_DIALOGUE_SOURCE_INVALID:${segmentId}:${sourceShotId ?? 'missing'}`)
        }
      }
      return {
        kind: cue.kind,
        description: cue.description.trim(),
        startSec: cue.startSec,
        endSec: cue.endSec,
        sourceShotId,
      }
    })
    return {
      segmentId,
      shotIds: [...segment.shotIds],
      continuity: segment.continuity.trim(),
      soundCues,
    }
  })
  assertEditGenerationSegmentDurationsSupported({
    shots,
    segments: normalized,
  })
  return normalized
}

export function normalizeEditScriptCore(
  raw: unknown,
): Omit<EditScriptPayload, 'requirements' | 'styleBible' | 'assetReviewStatus'> {
  const parsed = editScriptCoreSchema.parse(raw)
  const shots = normalizeShots(parsed.shots)
  const generationSegments = assertGenerationSegments(parsed.generationSegments, shots)
  const durationSec = shots.reduce((total, shot) => total + shot.durationSec, 0)
  return {
    durationSec,
    shotCount: shots.length,
    shots,
    generationSegments,
  }
}

export const normalizeEditScriptStructure = normalizeEditScriptCore

function validateEditShotExecutionPlan(
  generationSegments: readonly EditGenerationSegmentExecution[],
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): void {
  const shots = generationSegments.flatMap((segment) => segment.shots)
  assertContinuousShotNumbers(shots)
  if (shots.length !== coreShots.length) {
    throw new Error(`EDIT_SHOT_EXECUTION_PLAN_COVERAGE_INVALID:${shots.length}:${coreShots.length}`)
  }
  shots.forEach((shot, index) => {
    const coreShot = coreShots[index]
    if (!coreShot || shot.shotId !== coreShot.shotId || shot.shotNumber !== coreShot.shotNumber) {
      throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_MISMATCH:${shot.shotId}:${coreShot?.shotId ?? 'missing'}`)
    }
  })
  if (generationSegments.length !== coreGenerationSegments.length) {
    throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_COVERAGE_INVALID:${generationSegments.length}:${coreGenerationSegments.length}`)
  }
  generationSegments.forEach((segmentExecution, index) => {
    const coreSegment = coreGenerationSegments[index]
    if (!coreSegment) throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_MISSING:${index}`)
    if (segmentExecution.segmentId !== coreSegment.segmentId) {
      throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_ID_MISMATCH:${segmentExecution.segmentId}:${coreSegment.segmentId}`)
    }
    const executionShotIds = segmentExecution.shots.map((shot) => shot.shotId)
    if (
      executionShotIds.length !== coreSegment.shotIds.length ||
      executionShotIds.some((shotId, shotIndex) => shotId !== coreSegment.shotIds[shotIndex])
    ) {
      throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_SHOTS_MISMATCH:${index}:${executionShotIds.join(',')}:${coreSegment.shotIds.join(',')}`)
    }
  })
}

export function normalizeEditShotExecutionPlan(
  raw: unknown,
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): Omit<EditShotExecutionPlanPayload, 'id' | 'projectId' | 'episodeId' | 'chapterId' | 'editScriptId' | 'status'> {
  const parsed = rawEditShotExecutionPlanSchema.parse(raw)
  const coreShotByRef = new Map(coreShots.map((shot) => [editShotModelRef(shot.shotNumber), shot]))
  const segmentByRef = new Map(coreGenerationSegments.map((segment, index) => [editSegmentModelRef(index), segment]))
  const generationSegments = parsed.generationSegments.map((segment): EditGenerationSegmentExecution => {
    const coreSegment = segmentByRef.get(segment.segmentRef)
    if (!coreSegment) throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_REF_UNKNOWN:${segment.segmentRef}`)
    const shots = segment.shots.map((shot): EditShotExecution => {
      const coreShot = coreShotByRef.get(shot.shotRef)
      if (!coreShot) throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_REF_UNKNOWN:${shot.shotRef}`)
      if (!coreSegment.shotIds.includes(coreShot.shotId)) {
        throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_SEGMENT_MISMATCH:${segment.segmentRef}:${shot.shotRef}`)
      }
      return {
        shotId: coreShot.shotId,
        shotNumber: coreShot.shotNumber,
        shotScale: shot.shotScale,
        cameraMovement: shot.cameraMovement,
      }
    })
    return {
      segmentId: coreSegment.segmentId,
      shots,
    }
  })
  validateEditShotExecutionPlan(generationSegments, coreShots, coreGenerationSegments)
  return { generationSegments }
}

export function parsePersistedEditShotExecutionPlan(
  value: unknown,
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): Omit<EditShotExecutionPlanPayload, 'id' | 'projectId' | 'episodeId' | 'chapterId' | 'editScriptId' | 'status'> {
  const parsed = editShotExecutionPlanSchema.parse(value)
  const generationSegments = parsed.generationSegments.map((segment) => ({
    segmentId: segment.segmentId,
    shots: [...segment.shots].sort((left, right) => left.shotNumber - right.shotNumber),
  }))
  validateEditShotExecutionPlan(generationSegments, coreShots, coreGenerationSegments)
  return { generationSegments }
}

export function normalizeEditAssetRequirements(
  raw: unknown,
  shots: readonly EditScriptShot[],
): EditAssetRequirement[] {
  const parsed = editAssetExtractionSchema.parse(raw)
  const validShotIds = new Set(shots.map((shot) => shot.shotId))
  const seen = new Set<string>()
  const assets: EditAssetRequirement[] = []

  parsed.assets.forEach((asset) => {
    const name = asset.name.trim()
    const key = `${asset.kind}:${name.toLocaleLowerCase()}`
    if (seen.has(key)) return
    const shotIds = uniqueNonEmptyStrings(asset.shotIds)
      .filter((shotId) => validShotIds.has(shotId))
    if (shotIds.length === 0) {
      throw new Error(`EDIT_SCRIPT_ASSET_HAS_NO_VALID_SHOTS:${asset.kind}:${name}`)
    }
    seen.add(key)
    assets.push({
      kind: asset.kind,
      name,
      description: asset.description.trim(),
      shotIds,
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
