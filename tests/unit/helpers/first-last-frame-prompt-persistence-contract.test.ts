import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

const variables = {
  first_panel_context: '{"description":"start"}',
  last_panel_context: '{"description":"end"}',
  duration_seconds: '8',
  fps: '24',
  goon_key: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
}

describe('first-last-frame prompt persistence contract', () => {
  it.each(['en', 'zh'] as const)('%s template demands START/END ordered English JSON', (locale) => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.NP_FIRST_LAST_FRAME_TRANSITION,
      locale,
      variables,
    })

    expect(prompt).toMatch(/Image 1[\s\S]*START/i)
    expect(prompt).toMatch(/Image 2[\s\S]*END/i)
    expect(prompt).toContain('transition_prompt')
    expect(prompt).toContain('duration_analysis')
    expect(prompt).toContain('motion_beats')
    expect(prompt).toContain('confidence')
    expect(prompt).toMatch(/English/i)
  })

  it.each(['schema.prisma', 'schema.sqlit.prisma'])('%s stores the source fingerprint', (schemaName) => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', schemaName), 'utf8')
    expect(schema).toContain('firstLastFramePromptSourceFingerprint')
  })

  it('exposes the fingerprint in the server project projection type', () => {
    const projectTypes = fs.readFileSync(path.join(process.cwd(), 'src/types/project.ts'), 'utf8')
    expect(projectTypes).toContain('firstLastFramePromptSourceFingerprint?: string | null')
  })
})
