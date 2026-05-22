import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const promptDir = join(process.cwd(), 'lib', 'prompts', 'novel-promotion')

function readPrompt(filename: string) {
  return readFileSync(join(promptDir, filename), 'utf8')
}

describe('episode split prompt', () => {
  it('does not include stale examples above the 400 word product limit', () => {
    const prompts = [
      readPrompt('episode_split.zh.txt'),
      readPrompt('episode_split.en.txt'),
    ]

    for (const prompt of prompts) {
      expect(prompt).toContain('400')
      expect(prompt).not.toMatch(/maxWords["：:\s]+720/)
      expect(prompt).not.toMatch(/allowedRange["：:\s]+["“”]?590-720/)
    }
  })
})
