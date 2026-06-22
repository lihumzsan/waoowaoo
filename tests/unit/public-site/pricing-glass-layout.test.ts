import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('pricing glass layout', () => {
  it('uses the plain glass page canvas without the fixed top gradient wash', () => {
    const pageClient = readRepoFile('src/app/[locale]/_pricing-glass/page-client.tsx')

    expect(pageClient).toContain('glass-page min-h-screen pb-24')
    expect(pageClient).not.toContain('var(--glass-accent-shadow-soft)')
    expect(pageClient).not.toContain('pointer-events-none fixed inset-x-0 top-0')
  })
})
