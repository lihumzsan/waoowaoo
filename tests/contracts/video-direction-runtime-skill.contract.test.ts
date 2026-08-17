import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { materializeCreativeRuntimeConfiguration } from '@/lib/creative-skills/runtime-skills'

describe('video-direction runtime Skill contract', () => {
  it('materializes the H3 duration and vocal-performance rules into the runtime Skill', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-skill-'))
    try {
      await materializeCreativeRuntimeConfiguration(directory)
      const content = await readFile(path.join(directory, 'video-direction', 'SKILL.md'), 'utf8')
      const normalizedContent = content.replace(/\r\n?/gu, '\n')
      expect(normalizedContent).toContain('4–15 秒')
      expect(normalizedContent).toContain('silent_no_lip')
      expect(normalizedContent).toContain('lip_sync_for_replacement')
      expect(normalizedContent).toContain('先建立来源已有的正常基线，再显示原因或证据，最后呈现人物反应')
      expect(normalizedContent).toContain('1–8 张')
      expect(normalizedContent).toContain('<Picture 1>')
      expect(normalizedContent).toContain('<Picture N>')
      expect(normalizedContent).toContain('non_diegetic_music:\nN/A')
      expect(normalizedContent).not.toContain('None. Do not generate background music or musical score.')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
