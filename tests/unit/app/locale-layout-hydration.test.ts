import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('locale root layout hydration', () => {
  it('suppresses html hydration warnings from browser extension attributes', () => {
    const layoutSource = readFileSync(
      resolve(process.cwd(), 'src/app/[locale]/layout.tsx'),
      'utf8',
    )

    expect(layoutSource).toMatch(/<html\s+lang=\{locale\}\s+suppressHydrationWarning>/)
  })
})
