import { z } from 'zod'
import {
  editBibleCharacterVoiceProfileSchema,
  type EditBibleCharacterVoiceProfile,
} from '@/lib/edit-bible/voice-profile'
import type { EditScriptShot } from './types'

export interface EditScriptCharacterVoiceProfile {
  readonly characterId: string
  readonly name: string
  readonly voiceProfile: EditBibleCharacterVoiceProfile
}

export interface EditScriptDialogueVoiceLine extends EditScriptCharacterVoiceProfile {
  readonly line: string
}

export interface EditScriptShotDialogueVoiceContext {
  readonly shotId: string
  readonly shotNumber: number
  readonly dialogue: readonly EditScriptDialogueVoiceLine[]
}

export interface EditScriptDialogueVoiceContext {
  readonly characters: readonly EditScriptCharacterVoiceProfile[]
  readonly shots: readonly EditScriptShotDialogueVoiceContext[]
}

function voiceKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

const voiceProfileBibleSchema = z.object({
  characters: z.array(z.object({
    name: z.string().trim().min(1),
    aliases: z.array(z.string().trim().min(1)).default([]),
    voiceProfile: editBibleCharacterVoiceProfileSchema,
  }).passthrough()).default([]),
}).passthrough()

function buildVoiceProfileLookup(storyBibleJson: unknown): ReadonlyMap<string, EditBibleCharacterVoiceProfile> {
  const bible = voiceProfileBibleSchema.parse(storyBibleJson)
  const lookup = new Map<string, EditBibleCharacterVoiceProfile>()
  for (const character of bible.characters) {
    const names = Array.from(new Set([character.name, ...character.aliases].map(voiceKey).filter(Boolean)))
    for (const name of names) {
      if (lookup.has(name)) {
        throw new Error(`EDIT_SCRIPT_VOICE_PROFILE_NAME_DUPLICATE:${name}`)
      }
      lookup.set(name, character.voiceProfile)
    }
  }
  return lookup
}

export function resolveEditScriptDialogueVoiceContext(input: {
  readonly storyBibleJson: unknown
  readonly shots: readonly EditScriptShot[]
}): EditScriptDialogueVoiceContext {
  const voiceProfilesByName = buildVoiceProfileLookup(input.storyBibleJson)
  const charactersById = new Map<string, EditScriptCharacterVoiceProfile>()
  const shots = input.shots
    .map((shot): EditScriptShotDialogueVoiceContext => {
      const shotCharactersById = new Map(shot.characters.map((character) => [character.characterId, character]))
      const dialogue = shot.dialogue.map((line): EditScriptDialogueVoiceLine => {
        const character = shotCharactersById.get(line.characterId)
        if (!character) {
          throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
        }
        const voiceProfile = voiceProfilesByName.get(voiceKey(character.name))
        if (!voiceProfile) {
          throw new Error(`EDIT_SCRIPT_DIALOGUE_VOICE_PROFILE_MISSING:${shot.shotNumber}:${character.name}`)
        }
        const voiceCharacter = {
          characterId: character.characterId,
          name: character.name,
          voiceProfile,
        }
        charactersById.set(character.characterId, voiceCharacter)
        return {
          ...voiceCharacter,
          line: line.line,
        }
      })
      return {
        shotId: shot.shotId,
        shotNumber: shot.shotNumber,
        dialogue,
      }
    })
    .filter((shot) => shot.dialogue.length > 0)
  return {
    characters: [...charactersById.values()],
    shots,
  }
}
