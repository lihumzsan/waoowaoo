'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'

type SelectionImage = {
  id: string
  imageIndex: number
  imageUrl: string | null
  isSelected?: boolean
}

type LocationImageListProps =
  | {
    mode: 'selection'
    locationId: string
    locationName: string
    images: SelectionImage[]
    selectedImageId?: string | null
    selectedIndex: number | null
    onImageClick: (imageUrl: string) => void
    onSelectImage?: (locationId: string, imageIndex: number | null) => void
  }
  | {
    mode: 'single'
    locationName: string
    aspectClassName: string
    currentImageUrl: string | null | undefined
    selectedIndex: number | null
    hasMultipleImages: boolean
    onImageClick: (imageUrl: string) => void
    overlayActions: ReactNode
  }

export default function LocationImageList(props: LocationImageListProps) {
  const t = useTranslations('assets')

  if (props.mode === 'selection') {
    return (
      <div className="grid grid-cols-3 gap-3">
        {props.images.map((image) => {
          if (!image.imageUrl) return null
          const isSelected = props.selectedImageId
            ? image.id === props.selectedImageId
            : image.isSelected
          return (
            <div key={image.id} className="relative group/thumb">
              <div onClick={() => props.onImageClick(image.imageUrl!)} className={`rounded-lg overflow-hidden border-2 cursor-pointer relative ${isSelected ? 'border-[var(--glass-stroke-success)] ring-2 ring-[var(--glass-focus-ring)]' : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'}`}>
                <MediaImageWithLoading src={image.imageUrl} alt={t('image.optionAlt', { name: props.locationName, number: image.imageIndex + 1 })} containerClassName="w-full min-h-[88px]" className="w-full h-auto object-contain" />
                <div className={`absolute bottom-2 left-2 flex items-center gap-1 text-white text-xs px-2 py-0.5 rounded ${isSelected ? 'bg-[var(--glass-tone-success-fg)]' : 'bg-[var(--glass-overlay)]'}`}>
                  <span>{t('image.optionNumber', { number: image.imageIndex + 1 })}</span>
                  {isSelected && <AppIcon name="checkTiny" className="h-3 w-3" />}
                </div>
                <button onClick={(event) => { event.stopPropagation(); props.onSelectImage?.(props.locationId, isSelected ? null : image.imageIndex) }} className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center ${isSelected ? 'bg-[var(--glass-tone-success-fg)] text-white' : 'bg-[var(--glass-bg-surface-strong)]'}`} title={isSelected ? t('image.cancelSelection') : t('image.useThis')}>
                  <AppIcon name="check" className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border-2 border-[var(--glass-stroke-base)] ${props.aspectClassName}`}>
      {props.currentImageUrl ? (
        <div className="relative h-full w-full">
          <MediaImageWithLoading src={props.currentImageUrl} alt={props.locationName} containerClassName="h-full w-full" className="h-full w-full object-contain cursor-pointer hover:opacity-90" onClick={() => props.onImageClick(props.currentImageUrl!)} />
          {props.selectedIndex !== null && props.hasMultipleImages && <div className="absolute bottom-2 left-2 bg-[var(--glass-tone-success-fg)] text-white text-xs px-2 py-0.5 rounded">{t('image.optionNumber', { number: props.selectedIndex + 1 })}</div>}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[var(--glass-bg-muted)]">
          <AppIcon name="image" className="w-8 h-8 text-[var(--glass-text-tertiary)]" />
        </div>
      )}
      <div className="absolute top-2 left-2 flex gap-1">{props.overlayActions}</div>
    </div>
  )
}
