import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildVoiceDesignDraftStorageKey,
  readVoiceDesignDraft,
  writeVoiceDesignDraft,
} from '@/components/voice/voice-design-draft'

describe('voice design draft storage helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and writes per-scope draft values from localStorage', () => {
    const storageState = new Map<string, string>()
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value)
      }),
    }

    vi.stubGlobal('window', { localStorage: localStorageMock })

    writeVoiceDesignDraft('project:demo:character:char-1', {
      voicePrompt: 'mature male voice',
      previewText: 'hello there',
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      buildVoiceDesignDraftStorageKey('project:demo:character:char-1'),
      JSON.stringify({
        voicePrompt: 'mature male voice',
        previewText: 'hello there',
      }),
    )

    expect(readVoiceDesignDraft('project:demo:character:char-1')).toEqual({
      voicePrompt: 'mature male voice',
      previewText: 'hello there',
    })
  })

  it('returns null for invalid stored payloads', () => {
    const localStorageMock = {
      getItem: vi.fn(() => '{bad json'),
      setItem: vi.fn(),
    }

    vi.stubGlobal('window', { localStorage: localStorageMock })

    expect(readVoiceDesignDraft('asset-hub:character:char-1')).toBeNull()
  })
})
