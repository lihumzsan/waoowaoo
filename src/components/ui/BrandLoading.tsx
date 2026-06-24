'use client'

import { useTranslations } from 'next-intl'
import { BrandLogoMark } from '@/components/ui/icons'

type BrandLoadingProps = {
  className?: string
  imageClassName?: string
  imageSize?: number
}

function joinClassNames(classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function BrandLoading({
  className,
  imageClassName,
  imageSize = 80,
}: BrandLoadingProps) {
  const t = useTranslations('common')

  return (
    <div className={joinClassNames(['flex items-center justify-center', className])}>
      <BrandLogoMark
        title={t('appName')}
        width={imageSize}
        height={imageSize}
        motion="loading"
        className={joinClassNames(['object-contain', imageClassName])}
      />
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}

export function BrandPageLoading() {
  return (
    <div className="glass-page flex min-h-screen items-center justify-center">
      <BrandLoading />
    </div>
  )
}
