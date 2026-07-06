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

function normalizeShots(shots: readonly EditScriptShot[]): readonly EditScriptShot[] {
  const normalized = shots
    .map((shot): EditScriptShot => ({
      shotId: shot.shotId.trim(),
      shotNumber: shot.shotNumber,
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
  const shotIds = new Set<string>()
  normalized.forEach((shot) => {
    if (shotIds.has(shot.shotId)) throw new Error(`EDIT_SCRIPT_SHOT_ID_DUPLICATE:${shot.shotId}`)
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
    return {
      shotIds: [...segment.shotIds],
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
): Omit<EditShotExecutionPlanPayload, 'id' | 'projectId' | 'episodeId' | 'chapterId' | 'editScriptId' | 'status'> {
  const parsed = editShotExecutionPlanSchema.parse(raw)
  const shots = parsed.shots
    .map((shot): EditShotExecution => ({
      shotId: shot.shotId.trim(),
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
    shotIds: [...segment.shotIds],
    continuousVideoPrompt: segment.continuousVideoPrompt.trim(),
  }))
  assertContinuousShotNumbers(shots)
  if (shots.length !== coreShots.length) {
    throw new Error(`EDIT_SHOT_EXECUTION_PLAN_COVERAGE_INVALID:${shots.length}:${coreShots.length}`)
  }
  shots.forEach((shot, index) => {
    const coreShot = coreShots[index]
    if (!coreShot || shot.shotId !== coreShot.shotId || shot.shotNumber !== coreShot.shotNumber) {
      throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_MISMATCH:${shot.shotId}:${coreShot?.shotId ?? 'missing'}`)
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
      segmentExecution.shotIds.length !== coreSegment.shotIds.length ||
      segmentExecution.shotIds.some((shotId, shotIndex) => shotId !== coreSegment.shotIds[shotIndex])
    ) {
      throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_SHOTS_MISMATCH:${index}:${segmentExecution.shotIds.join(',')}:${coreSegment.shotIds.join(',')}`)
    }
  })
  return { shots, generationSegmentExecutions }
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
