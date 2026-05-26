import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('spatial text blocking regression', () => {
  it('does not inject coordinate overlay references into panel image generation', () => {
    const handler = readFileSync('src/lib/workers/handlers/panel-image-task-handler.ts', 'utf8')
    const zhPrompt = readFileSync('src/lib/ai-prompts/templates/image/panel-generate/panel-image-generate.zh.txt', 'utf8')
    const enPrompt = readFileSync('src/lib/ai-prompts/templates/image/panel-generate/panel-image-generate.en.txt', 'utf8')

    expect(handler).not.toContain('collectCoordinateOverlayReferenceItems')
    expect(handler).not.toContain("role: 'coordinate_overlay'")
    expect(zhPrompt).not.toContain('coordinate anchor map')
    expect(zhPrompt).not.toContain('坐标锚点图')
    expect(enPrompt).not.toContain('coordinate anchor map')
    expect(enPrompt).toContain('shot_blocking')
    expect(zhPrompt).toContain('spatial_profile')
  })
})
