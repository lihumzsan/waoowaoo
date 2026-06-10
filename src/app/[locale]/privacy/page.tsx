import { getTranslations } from 'next-intl/server'
import LegalPageShell from '@/components/legal/LegalPageShell'

const SECTION_KEYS = [
  'controller',
  'dataCollected',
  'userContent',
  'providers',
  'payments',
  'retention',
  'rights',
  'security',
  'contact',
] as const

export default async function PrivacyPage() {
  const t = await getTranslations('legal.privacy')

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
