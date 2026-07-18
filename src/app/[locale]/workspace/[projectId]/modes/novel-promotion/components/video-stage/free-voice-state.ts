export type FreeVoiceDraftVoice = {
  sourceType: 'character' | 'global_voice'
  sourceId: string
  name: string
  referenceAudioUrl: string | null
}

export function selectCharacterDefaultVoice(character: {
  id: string
  name: string
  customVoiceUrl?: string | null
}): FreeVoiceDraftVoice {
  return {
    sourceType: 'character',
    sourceId: character.id,
    name: character.name,
    referenceAudioUrl: character.customVoiceUrl || null,
  }
}

export function canSubmitFreeVoice(draft: {
  text: string
  characterId: string
  voice: FreeVoiceDraftVoice | null
}) {
  return !!draft.text.trim() && !!draft.characterId && !!draft.voice?.referenceAudioUrl
}

function two(value: number) {
  return String(value).padStart(2, '0')
}

export function safeFreeVoiceFilename(
  record: { createdAt: string },
  version: { versionNumber: number; audioUrl: string | null },
) {
  const date = new Date(record.createdAt)
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  const extension = version.audioUrl?.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() || 'mp3'
  return `free-voice-${stamp}-v${version.versionNumber}.${extension}`
}
