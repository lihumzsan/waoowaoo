export interface VoiceDesignDraft {
  voicePrompt: string
  previewText: string
}

const STORAGE_PREFIX = 'waoowaoo:voice-design:draft:'

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

export function buildVoiceDesignDraftStorageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope.trim()}`
}

export function readVoiceDesignDraft(scope: string): VoiceDesignDraft | null {
  const storage = getBrowserStorage()
  const normalizedScope = scope.trim()
  if (!storage || !normalizedScope) return null

  const raw = storage.getItem(buildVoiceDesignDraftStorageKey(normalizedScope))
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<VoiceDesignDraft> | null
    if (!parsed || typeof parsed !== 'object') return null

    const voicePrompt = typeof parsed.voicePrompt === 'string' ? parsed.voicePrompt : ''
    const previewText = typeof parsed.previewText === 'string' ? parsed.previewText : ''
    return { voicePrompt, previewText }
  } catch {
    return null
  }
}

export function writeVoiceDesignDraft(scope: string, draft: VoiceDesignDraft): void {
  const storage = getBrowserStorage()
  const normalizedScope = scope.trim()
  if (!storage || !normalizedScope) return

  storage.setItem(
    buildVoiceDesignDraftStorageKey(normalizedScope),
    JSON.stringify({
      voicePrompt: draft.voicePrompt,
      previewText: draft.previewText,
    }),
  )
}
