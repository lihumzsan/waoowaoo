import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('free voice query contract', () => {
  it('uses its own project cache and endpoints', () => {
    const keys = fs.readFileSync('src/lib/query/keys.ts', 'utf8')
    const query = fs.readFileSync('src/lib/query/hooks/useFreeVoices.ts', 'utf8')
    const mutations = fs.readFileSync('src/lib/query/mutations/useFreeVoiceMutations.ts', 'utf8')
    expect(keys).toContain('freeVoices:')
    expect(keys).toContain("['free-voices', projectId]")
    expect(query).toContain('/free-voices`')
    expect(mutations).toContain('/keep-version`')
    expect(mutations).not.toContain('queryKeys.voiceLines')
    expect(mutations).not.toContain('queryKeys.storyboards')
  })
})
