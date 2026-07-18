import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(
  process.cwd(),
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx',
), 'utf8')

describe('free voice panel styling', () => {
  it('uses visible semantic borders in the composer', () => {
    expect(source).toContain('glass-surface-soft rounded-xl border border-[var(--glass-stroke-strong)]')
    expect(source.match(/className="glass-select-base w-full px-3 py-2\.5/g)).toHaveLength(2)
    expect(source).toContain('className="glass-textarea-base w-full px-3 py-2.5 resize-y"')
    expect(source).not.toContain('className="glass-input w-full')
  })
})
