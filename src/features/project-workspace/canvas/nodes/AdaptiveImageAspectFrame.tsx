'use client'

import React, { useEffect, useMemo, useState, type ReactEventHandler, type ReactNode } from 'react'

export const IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO = '16 / 9'

export function imageThumbnailAspectRatio(image: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight'>): string | null {
  const { naturalWidth, naturalHeight } = image
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null
  if (naturalWidth <= 0 || naturalHeight <= 0) return null
  return `${naturalWidth} / ${naturalHeight}`
}

export function resolveImageFrameAspectRatio(value: number | string | null | undefined): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? String(value) : IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO
}

export function AdaptiveImageAspectFrame({
  sourceKey,
  initialAspectRatio,
  className,
  children,
}: {
  readonly sourceKey?: string | null
  readonly initialAspectRatio?: number | string | null
  readonly className: string
  readonly children: (image: {
    readonly aspectRatio: string
    readonly onImageLoad: ReactEventHandler<HTMLImageElement>
  }) => ReactNode
}) {
  const initialFrameAspectRatio = useMemo(
    () => resolveImageFrameAspectRatio(initialAspectRatio),
    [initialAspectRatio],
  )
  const [frameAspectRatio, setFrameAspectRatio] = useState(initialFrameAspectRatio)

  useEffect(() => {
    setFrameAspectRatio(initialFrameAspectRatio)
  }, [initialFrameAspectRatio, sourceKey])

  const handleImageLoad: ReactEventHandler<HTMLImageElement> = (event) => {
    const nextAspectRatio = imageThumbnailAspectRatio(event.currentTarget)
    if (!nextAspectRatio) return
    setFrameAspectRatio(nextAspectRatio)
  }

  return (
    <div className={className} style={{ aspectRatio: frameAspectRatio }}>
      {children({ aspectRatio: frameAspectRatio, onImageLoad: handleImageLoad })}
    </div>
  )
}
