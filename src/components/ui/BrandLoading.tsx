'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { BrandLogoShape } from '@/components/ui/icons/BrandLogoShape'

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
  const uid = `brand-loading-${useId().replace(/:/g, '')}`

  return (
    <div className={joinClassNames(['flex items-center justify-center', className])}>
      <BrandLogoShape
        uid={uid}
        size={imageSize}
        title={t('appName')}
        className={joinClassNames(['brand-loading-mark object-contain', imageClassName])}
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
