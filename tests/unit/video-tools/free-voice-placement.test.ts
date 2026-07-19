import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('free voice tool placement', () => {
  it('does not render the free voice panel inside the novel-promotion video stage', () => {
    const source = readFileSync('src/lib/novel-promotion/stages/video-stage-runtime-core.tsx', 'utf8')

    expect(source).not.toContain('FreeVoicePanel')
  })

  it('keeps the standalone free voice tool on the video tools page', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain('FreeVoiceToolCard')
  })
})
