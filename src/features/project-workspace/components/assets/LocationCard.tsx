'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Location } from '@/types/project'
import { shouldShowError } from '@/lib/error-utils'
import { useUploadProjectLocationImage } from '@/lib/query/mutations'
import { useAssetActions } from '@/lib/query/hooks'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'
import LocationCardHeader from './location-card/LocationCardHeader'
import LocationImageList from './location-card/LocationImageList'
import LocationCardActions from './location-card/LocationCardActions'
import { useToast } from '@/contexts/ToastContext'

interface LocationCardProps {
  location: Location
  assetType?: 'location' | 'prop'
  onEdit: () => void
  onDelete: () => void
  onUndo?: () => void
  onImageClick: (imageUrl: string) => void
  onSelectImage?: (locationId: string, imageIndex: number | null) => void
  onCopyFromGlobal?: () => void
  projectId: string
  onConfirmSelection?: (locationId: string) => Promise<void> | void
}

export default function LocationCard({
  location,
  assetType = 'location',
  onEdit,
  onDelete,
  onUndo,
  onImageClick,
  onSelectImage,
  onCopyFromGlobal,
  projectId,
  onConfirmSelection,
}: LocationCardProps) {
  const uploadImage = useUploadProjectLocationImage(projectId)
  const propActions = useAssetActions({ scope: 'project', projectId, kind: 'prop' })
  const t = useTranslations('assets')
  const { showError, showToast } = useToast()
  const assetKey = assetType === 'prop' ? 'prop' : 'location'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadIndex, setPendingUploadIndex] = useState<number | undefined>()
  const [isConfirmingSelection, setIsConfirmingSelection] = useState(false)

  const orderedImages = [...(location.images || [])].sort((left, right) => left.imageIndex - right.imageIndex)
  const imagesWithUrl = orderedImages.filter((image) => Boolean(image.imageUrl))
  const selectedImage = location.selectedImageId
    ? orderedImages.find((image) => image.id === location.selectedImageId)
    : orderedImages.find((image) => image.isSelected)
  const selectedIndex = selectedImage?.imageIndex ?? null
  const currentImageUrl = selectedImage?.imageUrl || imagesWithUrl[0]?.imageUrl || null
  const hasMultipleImages = imagesWithUrl.length > 1
  const hasPreviousVersion = orderedImages.some((image) => Boolean(image.previousImageUrl))
  const singleImageAspectClassName = assetType === 'prop' ? 'aspect-[3/2]' : 'aspect-square'

  const triggerUpload = (imageIndex?: number) => {
    setPendingUploadIndex(imageIndex)
    fileInputRef.current?.click()
  }

  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    const resetInput = () => {
        setPendingUploadIndex(undefined)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }
    if (assetType === 'prop') {
      void propActions.uploadRender(location.id, file, pendingUploadIndex)
        .then(() => showToast(t('image.uploadSuccess'), 'success'))
        .catch((error: unknown) => {
          if (shouldShowError(error)) {
            showError(error, t('image.uploadFailed'))
          }
        })
        .finally(resetInput)
      return
    }
    uploadImage.mutate({ file, locationId: location.id, imageIndex: pendingUploadIndex }, {
      onSuccess: () => showToast(t('image.uploadSuccess'), 'success'),
      onError: (error) => {
        if (shouldShowError(error)) showError(error, t('image.uploadFailed'))
      },
      onSettled: resetInput,
    })
  }

  const uploadPendingState = uploadImage.isPending
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: Boolean(currentImageUrl),
    })
    : null
  const confirmingSelectionState = isConfirmingSelection
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: Boolean(currentImageUrl),
    })
    : null

  const sharedInput = (
    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
  )

  if (hasMultipleImages) {
    const statusText = selectedIndex !== null
      ? t('image.optionSelected', { number: selectedIndex + 1 })
      : t('image.selectFirst')
    const selectionHeaderActions = (
      <>
        <button onClick={() => triggerUpload()} disabled={uploadImage.isPending} className="w-6 h-6 rounded hover:bg-[var(--glass-tone-success-bg)] flex items-center justify-center disabled:opacity-50" title={t('image.upload')}>
          <AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" />
        </button>
        {onUndo && hasPreviousVersion && (
          <button onClick={onUndo} className="w-6 h-6 rounded hover:bg-[var(--glass-tone-warning-bg)] flex items-center justify-center" title={t('image.undo')}>
            <AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" />
          </button>
        )}
        <button onClick={onDelete} className="w-6 h-6 rounded hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center" title={t(`${assetKey}.delete`)}>
          <AppIcon name="trash" className="w-4 h-4 text-[var(--glass-tone-danger-fg)]" />
        </button>
      </>
    )
    return (
      <div className="col-span-3 glass-surface-elevated p-4">
        {sharedInput}
        <LocationCardHeader mode="selection" locationName={location.name} summary={location.summary} selectedIndex={selectedIndex} statusText={statusText} actions={selectionHeaderActions} />
        <LocationImageList
          mode="selection"
          locationId={location.id}
          locationName={location.name}
          images={imagesWithUrl}
          selectedImageId={location.selectedImageId}
          selectedIndex={selectedIndex}
          onImageClick={onImageClick}
          onSelectImage={onSelectImage}
        />
        <LocationCardActions
          selectedIndex={selectedIndex}
          isConfirmingSelection={isConfirmingSelection}
          confirmingSelectionState={confirmingSelectionState}
          onConfirmSelection={selectedIndex !== null && onConfirmSelection ? () => {
            setIsConfirmingSelection(true)
            void Promise.resolve(onConfirmSelection(location.id))
              .finally(() => setIsConfirmingSelection(false))
          } : undefined}
        />
      </div>
    )
  }

  const singleOverlayActions = (
    <>
      <button onClick={() => triggerUpload(selectedIndex ?? 0)} disabled={uploadImage.isPending} className="w-7 h-7 rounded-full bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-tone-success-fg)] flex items-center justify-center shadow-sm disabled:opacity-50" title={currentImageUrl ? t('image.uploadReplace') : t('image.upload')}>
        {uploadImage.isPending
          ? <TaskStatusInline state={uploadPendingState} className="[&_span]:sr-only [&_svg]:text-current" />
          : <AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" />}
      </button>
      {currentImageUrl && onUndo && hasPreviousVersion && (
        <button onClick={onUndo} className="w-7 h-7 rounded-full bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-tone-warning-bg)] flex items-center justify-center shadow-sm" title={t('image.undo')}>
          <AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" />
        </button>
      )}
    </>
  )
  const compactHeaderActions = (
    <>
      {onCopyFromGlobal && <button onClick={onCopyFromGlobal} className="w-5 h-5 rounded hover:bg-[var(--glass-tone-info-bg)] flex items-center justify-center" title={t('character.copyFromGlobal')}><AppIcon name="arrowDownCircle" className="w-3.5 h-3.5 text-[var(--glass-tone-info-fg)]" /></button>}
      <button onClick={onEdit} className="w-5 h-5 rounded hover:bg-[var(--glass-bg-muted)] flex items-center justify-center" title={t(`${assetKey}.edit`)}><AppIcon name="edit" className="w-3.5 h-3.5 text-[var(--glass-text-secondary)]" /></button>
      <button onClick={onDelete} className="w-5 h-5 rounded hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center" title={t(`${assetKey}.delete`)}><AppIcon name="trash" className="w-3.5 h-3.5 text-[var(--glass-tone-danger-fg)]" /></button>
    </>
  )

  return (
    <div className="flex flex-col gap-2 glass-surface-elevated p-3">
      {sharedInput}
      <LocationImageList
        mode="single"
        locationName={location.name}
        aspectClassName={singleImageAspectClassName}
        currentImageUrl={currentImageUrl}
        selectedIndex={selectedIndex}
        hasMultipleImages={false}
        onImageClick={onImageClick}
        overlayActions={singleOverlayActions}
      />
      <LocationCardHeader mode="compact" locationName={location.name} summary={location.summary} actions={compactHeaderActions} />
    </div>
  )
}
