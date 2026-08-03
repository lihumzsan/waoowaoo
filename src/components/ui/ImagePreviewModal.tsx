'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { resolveOriginalImageUrl, toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'

interface ImagePreviewModalProps {
  imageUrl: string | null
  onClose: () => void
}

export default function ImagePreviewModal({ imageUrl, onClose }: ImagePreviewModalProps) {
  const t = useTranslations('common')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!imageUrl || !mounted) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [imageUrl, mounted, onClose])

  if (!imageUrl || !mounted) return null
  const displayImageUrl = toDisplayImageUrl(imageUrl)
  const originalImageUrl = resolveOriginalImageUrl(imageUrl) || displayImageUrl
  if (!displayImageUrl) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--glass-overlay)] backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{ margin: 0, padding: 0 }}
    >
      <div
        className="relative inline-block"
        onClick={(event) => event.stopPropagation()}
      >
        <MediaImageWithLoading
          src={displayImageUrl}
          alt={t('preview')}
          containerClassName="max-w-[calc(100vw-3rem)] max-h-[90vh] !bg-transparent"
          className="block max-w-[calc(100vw-3rem)] max-h-[90vh] object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        {/* 操作按钮贴着图片右上角,随图片实际比例走 */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          {originalImageUrl && (
            <a
              href={originalImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-9 items-center rounded-full bg-black/45 px-3 text-sm text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            >
              {t('viewOriginal')}
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
