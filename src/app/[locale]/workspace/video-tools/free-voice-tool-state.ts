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
