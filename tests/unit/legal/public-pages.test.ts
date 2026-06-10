import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PUBLIC_PAGE_PATHS = [
  'src/app/[locale]/pricing/page.tsx',
  'src/app/[locale]/terms/page.tsx',
  'src/app/[locale]/privacy/page.tsx',
  'src/app/[locale]/refund-policy/page.tsx',
  'src/app/[locale]/contact/page.tsx',
] as const

const MESSAGE_FILES = [
  'messages/zh/legal.json',
  'messages/en/legal.json',
  'messages/zh/pricing.json',
  'messages/en/pricing.json',
  'messages/zh/contact.json',
  'messages/en/contact.json',
] as const

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('public payment-readiness pages', () => {
  it('keeps pricing, policy, refund, and contact routes present', () => {
    const pages = PUBLIC_PAGE_PATHS.map((path) => readRepoFile(path))

    expect(pages[0]).toContain("getTranslations('pricing')")
    expect(pages[1]).toContain("getTranslations('legal.terms')")
    expect(pages[2]).toContain("getTranslations('legal.privacy')")
    expect(pages[3]).toContain("getTranslations('legal.refund')")
    expect(pages[4]).toContain("getTranslations('contact')")
  })

  it('loads public legal namespaces through the i18n request config', () => {
    const i18n = readRepoFile('src/i18n.ts')

    expect(i18n).toContain("import(`../messages/${locale}/legal.json`)")
    expect(i18n).toContain("import(`../messages/${locale}/pricing.json`)")
    expect(i18n).toContain("import(`../messages/${locale}/contact.json`)")
    expect(i18n).toContain('legal: legal.default')
    expect(i18n).toContain('pricing: pricing.default')
    expect(i18n).toContain('contact: contact.default')
  })

  it('exposes public footer links and placeholder merchant disclosure content', () => {
    const footer = readRepoFile('src/components/PublicFooter.tsx')
    const contactZh = JSON.parse(readRepoFile('messages/zh/contact.json')) as {
      publicInfo: { fields: { registrationRegion: { value: string } } }
      portalOnly: { items: Record<string, string> }
    }

    expect(footer).toContain("href: '/pricing'")
    expect(footer).toContain("href: '/terms'")
    expect(footer).toContain("href: '/privacy'")
    expect(footer).toContain("href: '/refund-policy'")
    expect(footer).toContain("href: '/contact'")
    expect(contactZh.publicInfo.fields.registrationRegion.value).toBe('Hong Kong')
    expect(Object.keys(contactZh.portalOnly.items)).toEqual([
      'certificate',
      'businessRegistration',
      'directors',
      'owners',
      'bank',
    ])
  })

  it('keeps localized message files valid JSON', () => {
    for (const path of MESSAGE_FILES) {
      expect(() => JSON.parse(readRepoFile(path))).not.toThrow()
    }
  })
})
