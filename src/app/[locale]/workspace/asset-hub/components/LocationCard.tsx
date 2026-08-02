'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSelectLocationImage, useUndoLocationImage, useUploadLocationImage, useDeleteLocation } from '@/lib/query/mutations'
import { useAssetActions } from '@/lib/query/hooks'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'
import { useToast } from '@/contexts/ToastContext'

interface LocationImage {
  id: string
  imageIndex: number
  description: string | null
  imageUrl: string | null
  previousImageUrl: string | null
  isSelected: boolean
}

interface Location {
  id: string
  name: string
  summary: string | null
  folderId: string | null
  images: LocationImage[]
}

interface LocationCardProps {
  location: Location
  assetType?: 'location' | 'prop'
  onImageClick?: (url: string) => void
  onEdit?: (location: Location, imageIndex: number) => void
}

export function LocationCard({ location, assetType = 'location', onImageClick, onEdit }: LocationCardProps) {
  const selectImage = useSelectLocationImage()
  const undoImage = useUndoLocationImage()
  const uploadImage = useUploadLocationImage()
  const deleteLocation = useDeleteLocation()
  const propActions = useAssetActions({ kind: 'prop' })
  const t = useTranslations('assetHub')
  const tAssets = useTranslations('assets')
  const { showError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const latestSelectRequestRef = useRef(0)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const orderedImages = [...(location.images || [])].sort((left, right) => left.imageIndex - right.imageIndex)
  const imagesWithUrl = orderedImages.filter((image): image is LocationImage & { imageUrl: string } => Boolean(image.imageUrl))
  const selectedImage = orderedImages.find((image) => image.isSelected)
  const selectedIndex = selectedImage?.imageIndex ?? null
  const currentImageUrl = selectedImage?.imageUrl || imagesWithUrl[0]?.imageUrl || null
  const currentImageIndex = selectedIndex ?? imagesWithUrl[0]?.imageIndex ?? 0
  const hasPreviousVersion = orderedImages.some((image) => Boolean(image.previousImageUrl))
  const assetLabel = assetType === 'prop' ? t('propLabel') : t('locationLabel')
  const aspectClassName = assetType === 'prop' ? 'aspect-[3/2]' : 'aspect-square'

  const handleSelectImage = (imageIndex: number | null, confirm = false) => {
    if (assetType === 'prop') {
      void propActions.selectRender({ id: location.id, imageIndex, confirm })
      return
    }
    const requestId = latestSelectRequestRef.current + 1
    latestSelectRequestRef.current = requestId
    selectImage.mutate({ locationId: location.id, imageIndex, confirm }, {
      onError: (error) => {
        if (latestSelectRequestRef.current === requestId) showError(error, t('selectFailed'))
      },
    })
  }

  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    uploadImage.mutate({
      file,
      locationId: location.id,
      labelText: location.name,
      imageIndex: currentImageIndex,
      assetType,
    }, {
      onError: (error) => showError(error, t('uploadFailed')),
      onSettled: () => { if (fileInputRef.current) fileInputRef.current.value = '' },
    })
  }
  const selectionState = selectImage.isPending
    ? resolveTaskPresentationState({ phase: 'processing', intent: 'process', resource: 'image', hasOutput: Boolean(currentImageUrl) })
    : null
  const handleUndo = () => {
    if (assetType === 'prop') void propActions.revertRender({ id: location.id })
    else undoImage.mutate(location.id)
  }
  const handleDelete = () => {
    if (assetType === 'prop') {
      void propActions.remove(location.id).finally(() => setShowDeleteConfirm(false))
    } else {
      deleteLocation.mutate(location.id, { onSettled: () => setShowDeleteConfirm(false) })
    }
  }

  return (
    <div className={`glass-surface relative ${imagesWithUrl.length > 1 ? 'col-span-3 p-4' : 'overflow-hidden group'}`}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
      {imagesWithUrl.length > 1 ? (
        <>
          <div className="flex items-start justify-between mb-4">
            <div><div className="text-sm font-semibold">{location.name}</div>{location.summary && <div className="text-xs text-[var(--glass-text-secondary)] line-clamp-2">{location.summary}</div>}</div>
            <div className="flex gap-1">
              <button onClick={() => fileInputRef.current?.click()} disabled={uploadImage.isPending} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md"><AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" /></button>
              {hasPreviousVersion && <button onClick={handleUndo} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md"><AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" /></button>}
              <button onClick={() => setShowDeleteConfirm(true)} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md"><AppIcon name="trash" className="w-4 h-4 text-[var(--glass-tone-danger-fg)]" /></button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {imagesWithUrl.map((image) => {
              const isSelected = image.imageIndex === selectedIndex
              return <div key={image.id} className="relative"><MediaImageWithLoading src={image.imageUrl} alt={`${location.name} ${image.imageIndex + 1}`} containerClassName={`min-h-[88px] rounded-lg overflow-hidden border-2 ${isSelected ? 'border-[var(--glass-stroke-success)]' : 'border-[var(--glass-stroke-base)]'}`} className="w-full h-auto object-contain cursor-zoom-in" onClick={() => onImageClick?.(image.imageUrl)} /><button onClick={() => handleSelectImage(isSelected ? null : image.imageIndex)} className={`absolute top-2 right-2 glass-btn-base h-7 w-7 rounded-full ${isSelected ? 'glass-btn-tone-success' : 'glass-btn-secondary'}`}><AppIcon name="check" className="w-4 h-4" /></button></div>
            })}
          </div>
          {selectedIndex !== null && <div className="mt-4 flex justify-end"><button onClick={() => handleSelectImage(selectedIndex, true)} disabled={selectImage.isPending} className="glass-btn-base glass-btn-tone-success px-4 py-2 rounded-lg flex items-center gap-2 text-sm">{selectImage.isPending ? <TaskStatusInline state={selectionState} className="[&>span]:sr-only" /> : <AppIcon name="check" className="w-4 h-4" />}{tAssets('image.confirmOption', { number: selectedIndex + 1 })}</button></div>}
        </>
      ) : (
        <>
          <div className={`relative bg-[var(--glass-bg-muted)] ${aspectClassName}`}>
            {currentImageUrl ? <MediaImageWithLoading src={currentImageUrl} alt={location.name} containerClassName="h-full w-full" className="h-full w-full object-contain cursor-zoom-in" onClick={() => onImageClick?.(currentImageUrl)} /> : <button onClick={() => fileInputRef.current?.click()} className="h-full w-full flex flex-col items-center justify-center text-[var(--glass-text-tertiary)]"><AppIcon name="upload" className="w-10 h-10 mb-2" />{tAssets('image.upload')}</button>}
            {currentImageUrl && <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100"><button onClick={() => fileInputRef.current?.click()} className="glass-btn-base glass-btn-secondary h-7 w-7 rounded-full"><AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" /></button>{hasPreviousVersion && <button onClick={handleUndo} className="glass-btn-base glass-btn-secondary h-7 w-7 rounded-full"><AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" /></button>}</div>}
          </div>
          <div className="p-3"><div className="flex items-center justify-between"><div><h3 className="font-medium text-sm truncate">{location.name}</h3><p className="text-[10px] text-[var(--glass-text-tertiary)]">{assetLabel}</p></div><div className="flex gap-1"><button onClick={() => onEdit?.(location, currentImageIndex)} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md"><AppIcon name="edit" className="w-4 h-4" /></button><button onClick={() => setShowDeleteConfirm(true)} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md text-[var(--glass-tone-danger-fg)]"><AppIcon name="trash" className="w-4 h-4" /></button></div></div>{location.summary && <p className="mt-1 text-xs text-[var(--glass-text-secondary)] line-clamp-2">{location.summary}</p>}</div>
        </>
      )}
      {showDeleteConfirm && <div className="absolute inset-0 glass-overlay flex items-center justify-center z-20"><div className="glass-surface-modal p-4 m-4"><p className="mb-4 text-sm">{assetType === 'prop' ? t('confirmDeleteProp') : t('confirmDeleteLocation')}</p><div className="flex gap-2 justify-end"><button onClick={() => setShowDeleteConfirm(false)} className="glass-btn-base glass-btn-secondary px-3 py-1.5 rounded-lg text-sm">{t('cancel')}</button><button onClick={handleDelete} className="glass-btn-base glass-btn-danger px-3 py-1.5 rounded-lg text-sm">{t('delete')}</button></div></div></div>}
    </div>
  )
}
