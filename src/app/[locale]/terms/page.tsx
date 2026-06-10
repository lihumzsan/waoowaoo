import { getTranslations } from 'next-intl/server'
import LegalPageShell from '@/components/legal/LegalPageShell'

const SECTION_KEYS = [
  'merchant',
  'service',
  'credits',
  'acceptableUse',
  'content',
  'account',
  'payments',
  'liability',
  'law',
] as const

export default async function TermsPage() {
  const t = await getTranslations('legal.terms')

  return (
    <LegalPageShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('description')}
      updatedAt={t('updatedAt')}
      sections={SECTION_KEYS.map((key) => ({
        title: t(`sections.${key}.title`),
        body: t(`sections.${key}.body`),
      }))}
    />
  )
}
