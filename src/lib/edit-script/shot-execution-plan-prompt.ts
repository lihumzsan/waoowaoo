import type { EditGenerationSegment, EditScriptShot } from './types'
import { editSegmentModelRef, editShotModelRef } from './model-references'

export interface ShotExecutionPlanPromptGenerationSegment {
  readonly segmentRef: string
  readonly shotRefs: readonly string[]
  readonly continuityReference: string
}

export interface ShotExecutionPlanPromptStructure {
  readonly durationSec: number
  readonly shotCount: number
  readonly sourceText: string | null
  readonly shots: readonly {
    readonly shotRef: string
    readonly shotNumber: number
    readonly shotPurpose: EditScriptShot['shotPurpose']
    readonly durationSec: number
    readonly scene: {
      readonly locationName: string
      readonly subScene: string
    }
    readonly action: string
    readonly characters: readonly {
      readonly characterName: string
      readonly visibility: EditScriptShot['characters'][number]['visibility']
      readonly role: EditScriptShot['characters'][number]['role']
      readonly performance: string
    }[]
    readonly keyObjects: EditScriptShot['keyObjects']
    readonly dialogue: readonly { readonly speakerName: string; readonly line: string }[]
    readonly sound: string
  }[]
  readonly videoGenerationSegments: readonly ShotExecutionPlanPromptGenerationSegment[]
}

export function buildShotExecutionPlanPromptStructure(input: {
  readonly durationSec: number
  readonly shotCount: number
  readonly sourceText: string | null
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly EditGenerationSegment[]
}): ShotExecutionPlanPromptStructure {
  const characterNameById = new Map(input.shots.flatMap((shot) => (
    shot.characters.map((character) => [character.characterId, character.name] as const)
  )))
  return {
    durationSec: input.durationSec,
    shotCount: input.shotCount,
    sourceText: input.sourceText,
    shots: input.shots.map((shot) => ({
      shotRef: editShotModelRef(shot.shotNumber),
      shotNumber: shot.shotNumber,
      shotPurpose: shot.shotPurpose,
      durationSec: shot.durationSec,
      scene: {
        locationName: shot.scene.name,
        subScene: shot.scene.subScene,
      },
      action: shot.action,
      characters: shot.characters.map((character) => ({
        characterName: character.name,
        visibility: character.visibility,
        role: character.role,
        performance: character.performance,
      })),
      keyObjects: shot.keyObjects,
      dialogue: shot.dialogue.map((line) => {
        const speakerName = characterNameById.get(line.characterId)
        if (!speakerName) throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
        return { speakerName, line: line.line }
      }),
      sound: shot.sound,
    })),
    videoGenerationSegments: input.generationSegments.map((segment, index) => ({
      segmentRef: editSegmentModelRef(index),
      shotRefs: segment.shotIds.map((shotId) => {
        const shot = input.shots.find((candidate) => candidate.shotId === shotId)
        if (!shot) throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_SHOT_UNKNOWN:${shotId}`)
        return editShotModelRef(shot.shotNumber)
      }),
      continuityReference: segment.continuity,
    })),
  }
}
