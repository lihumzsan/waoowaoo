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

    for (const page of pages) {
      expect(page).toContain("export const dynamic = 'force-dynamic'")
    }

    expect(pages[0]).toContain('PricingGlassPageContent')
    expect(pages[1]).toContain('requireOfficialCloudLegalPage()')
    expect(pages[2]).toContain('requireOfficialCloudLegalPage()')
    expect(pages[3]).toContain('requireOfficialCloudLegalPage()')
    expect(pages[4]).toContain('requireOfficialCloudPublicPage()')
    const pricingGlassPageContent = readRepoFile('src/app/[locale]/_pricing-glass/page-content.tsx')
    expect(pricingGlassPageContent).toContain('requireOfficialCloudPricingPage()')
    expect(pricingGlassPageContent).toContain('readOfficialPricingPage')
    expect(pricingGlassPageContent).toContain('readOfficialContactPage')
    expect(pricingGlassPageContent).toContain("readOfficialLegalPage('terms'")
    expect(pricingGlassPageContent).toContain("readOfficialLegalPage('privacy'")
    expect(pricingGlassPageContent).toContain("readOfficialLegalPage('refund-policy'")
    expect(pages[1]).toContain("readOfficialLegalPage('terms'")
    expect(pages[2]).toContain("readOfficialLegalPage('privacy'")
    expect(pages[3]).toContain("readOfficialLegalPage('refund-policy'")
    expect(pages[4]).toContain('readOfficialContactPage')
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

  it('keeps official public links and content private by default', () => {
    const footer = readRepoFile('src/components/PublicFooter.tsx')
    const navbar = readRepoFile('src/components/Navbar.tsx')
    const contactZh = JSON.parse(readRepoFile('messages/zh/contact.json')) as {
      publicInfo: {
        fields: {
          companyName: { value: string }
          registrationRegion: { value: string }
          registrationNumber: { value: string }
          supportEmail: { value: string }
        }
      }
      portalOnly: { items: Record<string, string> }
    }
    const legalZh = JSON.parse(readRepoFile('messages/zh/legal.json')) as {
      publicFooter: { brand: string }
    }

    expect(footer).toContain("href: '/pricing'")
    expect(footer).toContain("href: '/terms'")
    expect(footer).toContain("href: '/privacy'")
    expect(footer).toContain("href: '/refund-policy'")
    expect(footer).toContain("href: '/contact'")
    expect(footer).toContain('fetchPublicDeploymentFeatures')
    expect(navbar).toContain('fetchPublicDeploymentFeatures')
    expect(navbar).toContain("href={{ pathname: '/pricing' }}")
    expect(legalZh.publicFooter.brand).toBe('waoowaoo')
    expect(contactZh.publicInfo.fields.companyName.value).toContain('待提供')
    expect(contactZh.publicInfo.fields.registrationRegion.value).toBe('Hong Kong')
    expect(contactZh.publicInfo.fields.registrationNumber.value).toBe('待提供')
    expect(contactZh.publicInfo.fields.supportEmail.value).toContain('待提供')
    expect(Object.keys(contactZh.portalOnly.items)).toEqual([
      'certificate',
      'businessRegistration',
      'directors',
      'owners',
      'bank',
    ])
  })

  it('keeps private official content outside git and docker build contexts', () => {
    const gitignore = readRepoFile('.gitignore')
    const dockerignore = readRepoFile('.dockerignore')
    const envExample = readRepoFile('.env.example')

    expect(gitignore).toContain('.official-content/')
    expect(dockerignore).toContain('.official-content')
    expect(envExample).toContain('OFFICIAL_CONTENT_DIR=.official-content')
  })

  it('keeps localized message files valid JSON', () => {
    for (const path of MESSAGE_FILES) {
      expect(() => JSON.parse(readRepoFile(path))).not.toThrow()
    }
  })
})
