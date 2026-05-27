import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('spatial text blocking regression', () => {
  it('uses only spatial text context in panel image generation', () => {
    const handler = readFileSync('src/lib/workers/handlers/panel-image-task-handler.ts', 'utf8')
    const zhPrompt = readFileSync('src/lib/ai-prompts/templates/image/panel-generate/panel-image-generate.zh.txt', 'utf8')
    const enPrompt = readFileSync('src/lib/ai-prompts/templates/image/panel-generate/panel-image-generate.en.txt', 'utf8')

    expect(enPrompt).toContain('shot_blocking')
    expect(zhPrompt).toContain('spatial_profile')
  })
})
