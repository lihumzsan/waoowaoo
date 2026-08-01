'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Character, CharacterAppearance } from '@/types/project'
import { shouldShowError } from '@/lib/error-utils'
import { useUploadProjectCharacterImage } from '@/lib/query/mutations'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'
import CharacterCardHeader from './character-card/CharacterCardHeader'
import CharacterCardGallery from './character-card/CharacterCardGallery'
import CharacterCardActions from './character-card/CharacterCardActions'
import { useToast } from '@/contexts/ToastContext'

interface CharacterCardProps {
  character: Character
  appearance: CharacterAppearance
  onEdit: () => void
  onDelete: () => void
  onDeleteAppearance?: () => void
  onUndo?: () => void
  onImageClick: (imageUrl: string) => void
  showDeleteButton: boolean
  appearanceCount?: number
  onSelectImage?: (characterId: string, appearanceId: string, imageIndex: number | null) => void
  isPrimaryAppearance?: boolean
  projectId: string
  onConfirmSelection?: (characterId: string, appearanceId: string) => Promise<void> | void
}

export default function CharacterCard({
  character,
  appearance,
  onEdit,
  onDelete,
  onDeleteAppearance,
  onUndo,
  onImageClick,
  showDeleteButton,
  appearanceCount = 1,
  onSelectImage,
  isPrimaryAppearance = false,
  projectId,
  onConfirmSelection,
}: CharacterCardProps) {
  const uploadImage = useUploadProjectCharacterImage(projectId)
  const t = useTranslations('assets')
  const { showError, showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadIndex, setPendingUploadIndex] = useState<number | undefined>()
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [isConfirmingSelection, setIsConfirmingSelection] = useState(false)

  const rawImageUrls = appearance.imageUrls || []
  const imageUrlsWithIndex = rawImageUrls
    .map((url, originalIndex) => ({ url, originalIndex }))
    .filter((item): item is { url: string; originalIndex: number } => Boolean(item.url))
  const hasMultipleImages = imageUrlsWithIndex.length > 1
  const selectedIndex = appearance.selectedIndex ?? null
  const currentImageUrl = appearance.imageUrl
    || (selectedIndex !== null ? rawImageUrls[selectedIndex] : null)
    || imageUrlsWithIndex[0]?.url
  const hasPreviousVersion = Boolean(
    appearance.previousImageUrl || appearance.previousImageUrls.length > 0,
  )

  const triggerUpload = (imageIndex?: number) => {
    setPendingUploadIndex(imageIndex)
    fileInputRef.current?.click()
  }

  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    uploadImage.mutate({
      file,
      characterId: character.id,
      appearanceId: appearance.id,
      imageIndex: pendingUploadIndex,
    }, {
      onSuccess: () => showToast(t('image.uploadSuccess'), 'success'),
      onError: (error) => {
        if (shouldShowError(error)) showError(error, t('image.uploadFailed'))
      },
      onSettled: () => {
        setPendingUploadIndex(undefined)
        if (fileInputRef.current) fileInputRef.current.value = ''
      },
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
  const confirmSelectionState = isConfirmingSelection
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: Boolean(currentImageUrl),
    })
    : null

  const handleDeleteClick = () => {
    if (appearanceCount <= 1) onDelete()
    else setShowDeleteMenu((current) => !current)
  }

  const sharedInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      onChange={handleUpload}
      className="hidden"
    />
  )

  if (hasMultipleImages) {
    const selectionActions = (
      <>
        <button
          onClick={() => triggerUpload()}
          disabled={uploadImage.isPending}
          className="w-6 h-6 rounded hover:bg-[var(--glass-tone-success-bg)] flex items-center justify-center disabled:opacity-50"
          title={t('image.upload')}
        >
          <AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" />
        </button>
        {onUndo && hasPreviousVersion && (
          <button onClick={onUndo} className="w-6 h-6 rounded hover:bg-[var(--glass-tone-warning-bg)] flex items-center justify-center" title={t('image.undo')}>
            <AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" />
          </button>
        )}
        {showDeleteButton && (
          <button onClick={onDelete} className="w-6 h-6 rounded hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center" title={t('character.delete')}>
            <AppIcon name="trash" className="w-4 h-4 text-[var(--glass-tone-danger-fg)]" />
          </button>
        )}
      </>
    )

    return (
      <div className="col-span-3 bg-[var(--glass-bg-surface)] rounded-lg border-2 border-[var(--glass-stroke-base)] p-4 shadow-sm">
        {sharedInput}
        <CharacterCardHeader
          mode="selection"
          characterName={character.name}
          changeReason={appearance.changeReason}
          isPrimaryAppearance={isPrimaryAppearance}
          selectedIndex={selectedIndex}
          actions={selectionActions}
        />
        <CharacterCardGallery
          mode="selection"
          characterId={character.id}
          appearanceId={appearance.id}
          characterName={character.name}
          imageUrlsWithIndex={imageUrlsWithIndex}
          selectedIndex={selectedIndex}
          onImageClick={onImageClick}
          onSelectImage={onSelectImage}
        />
        <CharacterCardActions
          selectedIndex={selectedIndex}
          isConfirmingSelection={isConfirmingSelection}
          confirmSelectionState={confirmSelectionState}
          onConfirmSelection={onConfirmSelection ? () => {
            setIsConfirmingSelection(true)
            void Promise.resolve(onConfirmSelection(character.id, appearance.id))
              .finally(() => setIsConfirmingSelection(false))
          } : undefined}
        />
      </div>
    )
  }

  const overlayActions = (
    <>
      <button
        onClick={() => triggerUpload(selectedIndex ?? 0)}
        disabled={uploadImage.isPending}
        className="w-7 h-7 rounded-full bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-tone-success-fg)] flex items-center justify-center shadow-sm disabled:opacity-50"
        title={currentImageUrl ? t('image.uploadReplace') : t('image.upload')}
      >
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
      <button onClick={onEdit} className="w-5 h-5 rounded hover:bg-[var(--glass-bg-muted)] flex items-center justify-center" title={t('image.editPrompt')}>
        <AppIcon name="edit" className="w-3.5 h-3.5 text-[var(--glass-text-secondary)]" />
      </button>
      {showDeleteButton && (
        <div className="relative">
          <button onClick={handleDeleteClick} className="w-5 h-5 rounded hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center" title={appearanceCount <= 1 ? t('character.delete') : t('character.deleteOptions')}>
            <AppIcon name="trash" className="w-3.5 h-3.5 text-[var(--glass-tone-danger-fg)]" />
          </button>
          {showDeleteMenu && appearanceCount > 1 && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowDeleteMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-base)] rounded-lg shadow-lg py-1 min-w-[100px]">
                <button onClick={() => { setShowDeleteMenu(false); onDeleteAppearance?.() }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--glass-bg-muted)] whitespace-nowrap">{t('image.deleteThis')}</button>
                <button onClick={() => { setShowDeleteMenu(false); onDelete() }} className="w-full px-3 py-1.5 text-left text-xs text-[var(--glass-tone-danger-fg)] hover:bg-[var(--glass-tone-danger-bg)] whitespace-nowrap">{t('character.deleteWhole')}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="flex flex-col gap-2">
      {sharedInput}
      <CharacterCardGallery
        mode="single"
        characterName={character.name}
        changeReason={appearance.changeReason}
        aspectClassName="aspect-[3/2]"
        currentImageUrl={currentImageUrl}
        selectedIndex={selectedIndex}
        hasMultipleImages={false}
        onImageClick={onImageClick}
        overlayActions={overlayActions}
      />
      <CharacterCardHeader
        mode="compact"
        characterName={character.name}
        changeReason={appearance.changeReason}
        actions={compactHeaderActions}
      />
    </div>
  )
}
