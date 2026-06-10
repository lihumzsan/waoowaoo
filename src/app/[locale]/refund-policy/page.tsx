import { getTranslations } from 'next-intl/server'
import LegalPageShell from '@/components/legal/LegalPageShell'

const SECTION_KEYS = [
  'beta',
  'paidCredits',
  'usedCredits',
  'abuse',
  'process',
  'chargebacks',
] as const

export default async function RefundPolicyPage() {
  const t = await getTranslations('legal.refund')

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
