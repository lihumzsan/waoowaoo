import { describe, expect, it } from 'vitest'

import {
  findArchitectureMatches,
  parseGitStatusPorcelainZ,
} from '../../../scripts/architecture-impact-lib.mjs'

describe('architecture impact router', () => {
  it('enumerates tracked, staged, untracked, renamed, copied and deleted paths from one Git snapshot', () => {
    expect(parseGitStatusPorcelainZ('', '/repo')).toEqual([])

    const raw = [
      ' M src/modified.ts',
      'M  src/staged.ts',
      '?? src/untracked.ts',
      'R  src/renamed.ts',
      'src/previous-name.ts',
      'C  src/copied.ts',
      'src/copy-source.ts',
      ' D src/deleted.ts',
      '',
    ].join('\0')

    expect(parseGitStatusPorcelainZ(raw, '/repo')).toEqual([
      'src/modified.ts',
      'src/staged.ts',
      'src/untracked.ts',
      'src/renamed.ts',
      'src/previous-name.ts',
      'src/copied.ts',
      'src/copy-source.ts',
      'src/deleted.ts',
    ])
  })

  it('keeps per-file module matches and reports the exact routing path', () => {
    const modules = [
      {
        id: 'prompt',
        title: 'Prompt',
        document: 'docs/architecture/modules/prompt.md',
        sourcePaths: ['src/lib/ai-prompts'],
      },
      {
        id: 'canvas',
        title: 'Canvas',
        document: 'docs/architecture/modules/canvas.md',
        sourcePaths: ['src/features/canvas'],
      },
    ]

    const promptMatches = findArchitectureMatches(
      'src/lib/ai-prompts/templates/example.txt',
      modules,
      '/repo',
    )
    expect(promptMatches).toHaveLength(1)
    expect(promptMatches[0]?.architectureModule.id).toBe('prompt')
    expect(promptMatches[0]?.sourcePaths).toEqual(['src/lib/ai-prompts'])

    const documentMatches = findArchitectureMatches(
      'docs/architecture/modules/canvas.md',
      modules,
      '/repo',
    )
    expect(documentMatches).toHaveLength(1)
    expect(documentMatches[0]?.architectureModule.id).toBe('canvas')
    expect(documentMatches[0]?.sourcePaths).toEqual(['docs/architecture/modules/canvas.md'])

    expect(findArchitectureMatches('src/lib/unmapped/file.ts', modules, '/repo')).toEqual([])
  })
})
