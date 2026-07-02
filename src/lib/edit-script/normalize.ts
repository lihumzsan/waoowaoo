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
} from './types'
import { assertEditGenerationSegmentDurationsSupported } from './generation-segment-constraints'

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

function assertContinuousShotNumbers(shots: readonly { readonly shotNumber: number }[]): void {
  shots.forEach((shot, index) => {
    const expectedNumber = index + 1
    if (shot.shotNumber !== expectedNumber) {
      throw new Error(`EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS:${shot.shotNumber}:${expectedNumber}`)
    }
  })
}

function normalizeShots(shots: readonly EditScriptShot[]): readonly EditScriptShot[] {
  const normalized = shots
    .map((shot): EditScriptShot => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      scene: { name: shot.scene.name.trim() },
      action: shot.action.trim(),
      characters: shot.characters.map((character) => ({
        name: character.name.trim(),
        visibility: character.visibility,
        role: character.role,
        performance: character.performance.trim(),
      })),
      keyObjects: shot.keyObjects.map((object) => ({
        name: object.name.trim(),
        role: object.role.trim(),
      })),
      sound: shot.sound.trim(),
    }))
    .sort((left, right) => left.shotNumber - right.shotNumber)
  assertContinuousShotNumbers(normalized)
  return normalized
}

function assertGenerationSegments(
  segments: readonly EditGenerationSegment[],
  shots: readonly EditScriptShot[],
): readonly EditGenerationSegment[] {
  const shotNumbers = shots.map((shot) => shot.shotNumber)
  const flattened = segments.flatMap((segment) => segment.shotNumbers)
  if (flattened.length !== shotNumbers.length) {
    throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_COVERAGE_INVALID:${flattened.length}:${shotNumbers.length}`)
  }
  flattened.forEach((shotNumber, index) => {
    if (shotNumber !== shotNumbers[index]) {
      throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID:${shotNumber}:${shotNumbers[index]}`)
    }
  })
  const normalized = segments.map((segment) => {
    segment.shotNumbers.forEach((shotNumber, index) => {
      if (index > 0 && shotNumber !== segment.shotNumbers[index - 1] + 1) {
        throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_NOT_CONTINUOUS:${segment.shotNumbers.join(',')}`)
      }
    })
    return {
      shotNumbers: [...segment.shotNumbers],
      continuity: segment.continuity.trim(),
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

function names(values: readonly { readonly name: string }[]): Set<string> {
  return new Set(values.map((value) => value.name.trim().toLocaleLowerCase()))
}

export function normalizeEditShotExecutionPlan(
  raw: unknown,
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): Omit<EditShotExecutionPlanPayload, 'id' | 'projectId' | 'episodeId' | 'editScriptId' | 'status'> {
  const parsed = editShotExecutionPlanSchema.parse(raw)
  const shots = parsed.shots
    .map((shot): EditShotExecution => ({
      shotNumber: shot.shotNumber,
      camera: {
        shotScale: shot.camera.shotScale.trim(),
        lens: shot.camera.lens.trim(),
        focus: shot.camera.focus.trim(),
        height: shot.camera.height.trim(),
        angle: shot.camera.angle.trim(),
        movement: shot.camera.movement.trim(),
        composition: shot.camera.composition.trim(),
        lighting: shot.camera.lighting.trim(),
      },
      blocking: {
        axis: {
          type: shot.blocking.axis.type.trim(),
          subjects: shot.blocking.axis.subjects.map((subject) => subject.trim()),
          screenDirection: shot.blocking.axis.screenDirection.trim(),
        },
        characters: shot.blocking.characters.map((character) => ({
          name: character.name.trim(),
          visibility: character.visibility,
          position: character.position.trim(),
          screenPosition: character.screenPosition.trim(),
          facing: character.facing.trim(),
          eyeline: character.eyeline.trim(),
        })),
        objects: shot.blocking.objects.map((object) => ({
          name: object.name.trim(),
          position: object.position.trim(),
          screenPosition: object.screenPosition.trim(),
        })),
        spatialNote: shot.blocking.spatialNote.trim(),
      },
      videoPrompt: shot.videoPrompt.trim(),
    }))
    .sort((left, right) => left.shotNumber - right.shotNumber)
  const generationSegmentExecutions = parsed.generationSegmentExecutions.map((segment): EditGenerationSegmentExecution => ({
    shotNumbers: [...segment.shotNumbers],
    continuousVideoPrompt: segment.continuousVideoPrompt.trim(),
  }))
  assertContinuousShotNumbers(shots)
  if (shots.length !== coreShots.length) {
    throw new Error(`EDIT_SHOT_EXECUTION_PLAN_COVERAGE_INVALID:${shots.length}:${coreShots.length}`)
  }
  shots.forEach((shot, index) => {
    const coreShot = coreShots[index]
    if (!coreShot || shot.shotNumber !== coreShot.shotNumber) {
      throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_MISMATCH:${shot.shotNumber}:${coreShot?.shotNumber ?? 'missing'}`)
    }
    const coreCharacters = names(coreShot.characters)
    const executionCharacters = names(shot.blocking.characters)
    coreCharacters.forEach((name) => {
      if (!executionCharacters.has(name)) throw new Error(`EDIT_SHOT_EXECUTION_CHARACTER_MISSING:${shot.shotNumber}:${name}`)
    })
    executionCharacters.forEach((name) => {
      if (!coreCharacters.has(name)) throw new Error(`EDIT_SHOT_EXECUTION_CHARACTER_UNKNOWN:${shot.shotNumber}:${name}`)
    })
    const executionObjects = names(shot.blocking.objects)
    coreShot.keyObjects.forEach((object) => {
      if (!executionObjects.has(object.name.trim().toLocaleLowerCase())) {
        throw new Error(`EDIT_SHOT_EXECUTION_OBJECT_MISSING:${shot.shotNumber}:${object.name}`)
      }
    })
  })
  if (generationSegmentExecutions.length !== coreGenerationSegments.length) {
    throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_COVERAGE_INVALID:${generationSegmentExecutions.length}:${coreGenerationSegments.length}`)
  }
  generationSegmentExecutions.forEach((segmentExecution, index) => {
    const coreSegment = coreGenerationSegments[index]
    if (!coreSegment) throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_MISSING:${index}`)
    if (
      segmentExecution.shotNumbers.length !== coreSegment.shotNumbers.length ||
      segmentExecution.shotNumbers.some((shotNumber, shotIndex) => shotNumber !== coreSegment.shotNumbers[shotIndex])
    ) {
      throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_SHOTS_MISMATCH:${index}:${segmentExecution.shotNumbers.join(',')}:${coreSegment.shotNumbers.join(',')}`)
    }
  })
  return { shots, generationSegmentExecutions }
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
