import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('landing page image sources', () => {
  it('uses a stable local logo path during session loading', () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), 'src/app/[locale]/page.tsx'),
      'utf8',
    )

    expect(pageSource).toContain('src="/logo-small.png"')
    expect(pageSource).not.toContain('/logo-small.png?')
    expect(pageSource).toMatch(/src="\/logo-small\.png"[\s\S]*?priority[\s\S]*?\/>/)
  })
})
