import type { EditGenerationSegment, EditScriptShot } from './types'
import { editSegmentModelRef, editShotModelRef } from './model-references'

export interface ShotExecutionPlanPromptStructure {
  readonly durationSec: number
  readonly shotCount: number
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
      readonly performance: string
    }[]
    readonly dialogue: readonly { readonly speakerName: string; readonly line: string }[]
    readonly synchronousSound: string
  }[]
  readonly generationSegments: readonly {
    readonly segmentRef: string
    readonly shotRefs: readonly string[]
    readonly continuity: string
    readonly soundCues: readonly {
      readonly kind: EditGenerationSegment['soundCues'][number]['kind']
      readonly description: string
      readonly startSec: number
      readonly endSec: number
      readonly sourceShotRef: string | null
    }[]
  }[]
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
  const shotRefById = new Map(input.shots.map((shot) => [shot.shotId, editShotModelRef(shot.shotNumber)]))
  return {
    durationSec: input.durationSec,
    shotCount: input.shotCount,
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
        performance: character.performance,
      })),
      dialogue: shot.dialogue.map((line) => {
        const speakerName = characterNameById.get(line.characterId)
        if (!speakerName) throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
        return { speakerName, line: line.line }
      }),
      synchronousSound: shot.synchronousSound,
    })),
    generationSegments: input.generationSegments.map((segment, index) => {
      const shotRefs = segment.shotIds.map((shotId) => {
        const shot = input.shots.find((candidate) => candidate.shotId === shotId)
        if (!shot) throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_SHOT_UNKNOWN:${shotId}`)
        return editShotModelRef(shot.shotNumber)
      })
      return {
        segmentRef: editSegmentModelRef(index),
        shotRefs,
        continuity: segment.continuity,
        soundCues: segment.soundCues.map((cue) => {
          const sourceShotRef = cue.sourceShotId ? shotRefById.get(cue.sourceShotId) ?? null : null
          if (cue.sourceShotId && !sourceShotRef) {
            throw new Error(`EDIT_SCRIPT_SOUND_CUE_SOURCE_SHOT_UNKNOWN:${cue.sourceShotId}`)
          }
          return {
            kind: cue.kind,
            description: cue.description,
            startSec: cue.startSec,
            endSec: cue.endSec,
            sourceShotRef,
          }
        }),
      }
    }),
  }
}
