import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildFreeVoiceSubmitInput,
  buildProjectCharacterOptions,
} from '@/app/[locale]/workspace/video-tools/free-voice-tool-state'

describe('free voice tool state', () => {
  it('marks characters without reference audio as disabled', () => {
    expect(buildProjectCharacterOptions([
      { id: 'character-1', name: 'Hero', customVoiceUrl: '/voice/hero.wav' },
      { id: 'character-2', name: 'Silent', customVoiceUrl: null },
    ], 'missingReference')).toEqual([
      { id: 'character-1', label: 'Hero', disabled: false },
      { id: 'character-2', label: 'Silent (missingReference)', disabled: true },
    ])
  })

  it('builds a trimmed request for a selected character with reference audio', () => {
    expect(buildFreeVoiceSubmitInput({
      text: ' hello ',
      projectId: 'project-1',
      characterId: 'character-1',
      characterHasReference: true,
    })).toEqual({ text: 'hello', projectId: 'project-1', characterId: 'character-1' })
  })

  it.each([
    { text: ' ', projectId: 'project-1', characterId: 'character-1', characterHasReference: true },
    { text: 'hello', projectId: '', characterId: 'character-1', characterHasReference: true },
    { text: 'hello', projectId: 'project-1', characterId: '', characterHasReference: true },
    { text: 'hello', projectId: 'project-1', characterId: 'character-1', characterHasReference: false },
  ])('rejects incomplete submit input %#', (input) => {
    expect(buildFreeVoiceSubmitInput(input)).toBeNull()
  })

  it('uses project characters instead of global voices and clears the character on project changes', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/FreeVoiceToolCard.tsx', 'utf8')

    expect(source).toContain('useProjectCharacters')
    expect(source).not.toContain('useGlobalVoices')
    expect(source).toMatch(/onChange=\{\(event\) => \{\s*setProjectId\(event\.target\.value\)\s*setCharacterId\(''\)\s*\}\}/)
  })
})
