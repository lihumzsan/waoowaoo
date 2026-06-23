'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'

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
      <Image
        src="/logo-small.png"
        alt={t('appName')}
        width={imageSize}
        height={imageSize}
        className={joinClassNames(['animate-pulse object-contain', imageClassName])}
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
