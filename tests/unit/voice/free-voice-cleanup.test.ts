import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('project free voice cleanup', () => {
  it('collects every generated free voice audio before project deletion', () => {
    const source = fs.readFileSync('src/app/api/projects/[projectId]/route.ts', 'utf8')
    expect(source).toContain('freeVoiceRecords')
    expect(source).toMatch(/freeVoiceRecords[\s\S]*versions/)
    expect(source).toMatch(/version\.audioUrl/)
    expect(source).toMatch(/resolveStorageKeyFromMediaValue\(version\.audioUrl\)/)
  })
})
