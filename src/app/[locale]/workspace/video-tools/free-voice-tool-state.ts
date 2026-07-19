type ProjectCharacter = {
  id: string
  name: string
  customVoiceUrl?: string | null
}

type FreeVoiceSubmitInput = {
  text: string
  projectId: string
  characterId: string
}

type CharacterPickerState = 'select-project' | 'loading' | 'error' | 'empty' | 'ready'

export function buildProjectCharacterOptions(
  characters: ProjectCharacter[],
  missingReference: string,
) {
  return characters.map((character) => ({
    id: character.id,
    label: character.customVoiceUrl
      ? character.name
      : `${character.name} (${missingReference})`,
    disabled: !character.customVoiceUrl,
  }))
}

export function buildFreeVoiceSubmitInput(input: {
  text: string
  projectId: string
  characterId: string
  characterHasReference: boolean
}): FreeVoiceSubmitInput | null {
  const text = input.text.trim()
  if (!text || !input.projectId || !input.characterId || !input.characterHasReference) return null

  return {
    text,
    projectId: input.projectId,
    characterId: input.characterId,
  }
}

export function resolveCharacterPickerState(input: {
  projectId: string
  isLoading: boolean
  isError: boolean
  characterCount: number
}): CharacterPickerState {
  if (!input.projectId) return 'select-project'
  if (input.isLoading) return 'loading'
  if (input.isError) return 'error'
  if (input.characterCount === 0) return 'empty'
  return 'ready'
}
