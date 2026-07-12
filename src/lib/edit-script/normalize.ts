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
        visibility: character.visibility,
        role: character.role,
        performance: character.performance.trim(),
      })),
      keyObjects: shot.keyObjects.map((object) => ({
        name: object.name.trim(),
        role: object.role.trim(),
      })),
      dialogue: shot.dialogue.map((line) => ({
        characterId: line.characterId.trim(),
        line: line.line.trim(),
      })),
      sound: shot.sound.trim(),
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

function normalizedNames(values: readonly { readonly name: string }[]): Set<string> {
  return new Set(values.map((value) => value.name.trim().toLocaleLowerCase()))
}

function assertPromptContainsDialogueLines(input: {
  readonly coreShotById: ReadonlyMap<string, EditScriptShot>
  readonly executionShots: readonly EditShotExecution[]
  readonly generationSegmentExecutions: readonly EditGenerationSegmentExecution[]
}): void {
  for (const shot of input.executionShots) {
    const coreShot = input.coreShotById.get(shot.shotId)
    if (!coreShot) continue
    for (const dialogue of coreShot.dialogue) {
      if (!shot.videoPrompt.includes(dialogue.line)) {
        throw new Error(`EDIT_SHOT_EXECUTION_DIALOGUE_MISSING:${shot.shotNumber}:${dialogue.characterId}`)
      }
    }
  }
  for (const segment of input.generationSegmentExecutions) {
    const dialogueLines = segment.shotIds.flatMap((shotId) => input.coreShotById.get(shotId)?.dialogue ?? [])
    for (const dialogue of dialogueLines) {
      if (!segment.continuousVideoPrompt.includes(dialogue.line)) {
        throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_DIALOGUE_MISSING:${segment.shotIds.join(',')}:${dialogue.characterId}`)
      }
    }
  }
}

function validateEditShotExecutionPlan(
  shots: readonly EditShotExecution[],
  generationSegmentExecutions: readonly EditGenerationSegmentExecution[],
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): void {
  assertContinuousShotNumbers(shots)
  if (shots.length !== coreShots.length) {
    throw new Error(`EDIT_SHOT_EXECUTION_PLAN_COVERAGE_INVALID:${shots.length}:${coreShots.length}`)
  }
  shots.forEach((shot, index) => {
    const coreShot = coreShots[index]
    if (!coreShot || shot.shotId !== coreShot.shotId || shot.shotNumber !== coreShot.shotNumber) {
      throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_MISMATCH:${shot.shotId}:${coreShot?.shotId ?? 'missing'}`)
    }
    const coreCharacters = new Set(coreShot.characters.map((character) => character.characterId))
    const executionCharacters = new Set(shot.blocking.characters.map((character) => character.characterId))
    coreCharacters.forEach((characterId) => {
      if (!executionCharacters.has(characterId)) throw new Error(`EDIT_SHOT_EXECUTION_CHARACTER_MISSING:${shot.shotNumber}:${characterId}`)
    })
    executionCharacters.forEach((characterId) => {
      if (!coreCharacters.has(characterId)) throw new Error(`EDIT_SHOT_EXECUTION_CHARACTER_UNKNOWN:${shot.shotNumber}:${characterId}`)
    })
    const executionObjects = normalizedNames(shot.blocking.objects)
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
  assertPromptContainsDialogueLines({
    coreShotById: new Map(coreShots.map((shot) => [shot.shotId, shot])),
    executionShots: shots,
    generationSegmentExecutions,
  })
}

export function normalizeEditShotExecutionPlan(
  raw: unknown,
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): Omit<EditShotExecutionPlanPayload, 'id' | 'projectId' | 'episodeId' | 'chapterId' | 'editScriptId' | 'status'> {
  const parsed = rawEditShotExecutionPlanSchema.parse(raw)
  const coreShotByRef = new Map(coreShots.map((shot) => [editShotModelRef(shot.shotNumber), shot]))
  const shots = parsed.shots.map((shot): EditShotExecution => {
    const coreShot = coreShotByRef.get(shot.shotRef)
    if (!coreShot) throw new Error(`EDIT_SHOT_EXECUTION_PLAN_SHOT_REF_UNKNOWN:${shot.shotRef}`)
    const characterByName = new Map(coreShot.characters.map((character) => [character.name, character]))
    return {
      shotId: coreShot.shotId,
      shotNumber: coreShot.shotNumber,
      camera: shot.camera,
      blocking: {
        axis: shot.blocking.axis,
        characters: shot.blocking.characters.map(({ characterName, ...character }) => {
          const coreCharacter = characterByName.get(characterName)
          if (!coreCharacter) {
            throw new Error(`EDIT_SHOT_EXECUTION_CHARACTER_NAME_UNKNOWN:${coreShot.shotNumber}:${characterName}`)
          }
          return { characterId: coreCharacter.characterId, ...character }
        }),
        objects: shot.blocking.objects,
        spatialNote: shot.blocking.spatialNote,
      },
      videoPrompt: shot.videoPrompt,
    }
  }).sort((left, right) => left.shotNumber - right.shotNumber)
  const segmentByRef = new Map(coreGenerationSegments.map((segment, index) => [editSegmentModelRef(index), segment]))
  const generationSegmentExecutions = parsed.generationSegmentExecutions.map((segment): EditGenerationSegmentExecution => {
    const coreSegment = segmentByRef.get(segment.segmentRef)
    if (!coreSegment) throw new Error(`EDIT_SHOT_EXECUTION_SEGMENT_REF_UNKNOWN:${segment.segmentRef}`)
    return {
      shotIds: [...coreSegment.shotIds],
      continuousVideoPrompt: segment.continuousVideoPrompt,
    }
  })
  validateEditShotExecutionPlan(shots, generationSegmentExecutions, coreShots, coreGenerationSegments)
  return { shots, generationSegmentExecutions }
}

export function parsePersistedEditShotExecutionPlan(
  value: unknown,
  coreShots: readonly EditScriptShot[],
  coreGenerationSegments: readonly EditGenerationSegment[],
): Omit<EditShotExecutionPlanPayload, 'id' | 'projectId' | 'episodeId' | 'chapterId' | 'editScriptId' | 'status'> {
  const parsed = editShotExecutionPlanSchema.parse(value)
  const shots = [...parsed.shots].sort((left, right) => left.shotNumber - right.shotNumber)
  const generationSegmentExecutions = parsed.generationSegmentExecutions.map((segment) => ({
    shotIds: [...segment.shotIds],
    continuousVideoPrompt: segment.continuousVideoPrompt,
  }))
  validateEditShotExecutionPlan(shots, generationSegmentExecutions, coreShots, coreGenerationSegments)
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
