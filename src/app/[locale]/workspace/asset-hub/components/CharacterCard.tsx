'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  useSelectCharacterImage,
  useUndoCharacterImage,
  useUploadCharacterImage,
  useDeleteCharacter,
  useDeleteCharacterAppearance,
} from '@/lib/query/mutations'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { AppIcon } from '@/components/ui/icons'
import { useToast } from '@/contexts/ToastContext'

interface Appearance {
  id: string
  appearanceIndex: number
  changeReason: string
  description: string | null
  imageUrl: string | null
  imageUrls: string[]
  selectedIndex: number | null
  previousImageUrl: string | null
  previousImageUrls: string[]
}

interface Character {
  id: string
  name: string
  folderId: string | null
  appearances: Appearance[]
}

interface CharacterCardProps {
  character: Character
  onImageClick?: (url: string) => void
  onEdit?: (character: Character, appearance: Appearance) => void
}

function isValidUrl(url: string | null | undefined): url is string {
  if (!url?.trim()) return false
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) return true
  try { new URL(url); return true } catch { return false }
}

export function CharacterCard({ character, onImageClick, onEdit }: CharacterCardProps) {
  const selectImage = useSelectCharacterImage()
  const undoImage = useUndoCharacterImage()
  const uploadImage = useUploadCharacterImage()
  const deleteCharacter = useDeleteCharacter()
  const deleteAppearance = useDeleteCharacterAppearance()
  const t = useTranslations('assetHub')
  const tAssets = useTranslations('assets')
  const { showError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const latestSelectRequestRef = useRef(0)
  const [activeAppearance, setActiveAppearance] = useState(0)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)

  const appearance = character.appearances[activeAppearance] || character.appearances[0]
  if (!appearance) return null
  const imageUrls = appearance.imageUrls || []
  const validImages = imageUrls
    .map((url, index) => ({ url, index }))
    .filter((item): item is { url: string; index: number } => isValidUrl(item.url))
  const selectedIndex = appearance.selectedIndex ?? null
  const currentImageUrl = isValidUrl(appearance.imageUrl)
    ? appearance.imageUrl
    : selectedIndex !== null && isValidUrl(imageUrls[selectedIndex])
      ? imageUrls[selectedIndex]
      : validImages[0]?.url ?? null
  const hasPreviousVersion = Boolean(appearance.previousImageUrl || appearance.previousImageUrls.length)
  const isPrimaryAppearance = appearance.appearanceIndex === PRIMARY_APPEARANCE_INDEX

  const handleSelectImage = (imageIndex: number | null, confirm = false) => {
    const requestId = latestSelectRequestRef.current + 1
    latestSelectRequestRef.current = requestId
    selectImage.mutate({
      characterId: character.id,
      appearanceIndex: appearance.appearanceIndex,
      imageIndex,
      confirm,
    }, {
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
      characterId: character.id,
      appearanceIndex: appearance.appearanceIndex,
      labelText: `${character.name} - ${appearance.changeReason}`,
      imageIndex: selectedIndex ?? undefined,
    }, {
      onError: (error) => showError(error, t('uploadFailed')),
      onSettled: () => { if (fileInputRef.current) fileInputRef.current.value = '' },
    })
  }

  const selectionState = selectImage.isPending
    ? resolveTaskPresentationState({ phase: 'processing', intent: 'process', resource: 'image', hasOutput: Boolean(currentImageUrl) })
    : null

  const deleteOverlay = showDeleteConfirm ? (
    <div className="absolute inset-0 glass-overlay flex items-center justify-center z-20 rounded-xl">
      <div className="glass-surface-modal p-4 m-4">
        <p className="mb-4 text-sm text-[var(--glass-text-primary)]">{t('confirmDeleteCharacter')}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setShowDeleteConfirm(false)} className="glass-btn-base glass-btn-secondary px-3 py-1.5 rounded-lg text-sm">{t('cancel')}</button>
          <button onClick={() => deleteCharacter.mutate(character.id, { onSettled: () => setShowDeleteConfirm(false) })} className="glass-btn-base glass-btn-danger px-3 py-1.5 rounded-lg text-sm">{t('delete')}</button>
        </div>
      </div>
    </div>
  ) : null

  const headerActions = (
    <div className="flex items-center gap-1">
      <button onClick={() => fileInputRef.current?.click()} disabled={uploadImage.isPending} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md" title={tAssets('image.upload')}><AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" /></button>
      {hasPreviousVersion && <button onClick={() => undoImage.mutate({ characterId: character.id, appearanceIndex: appearance.appearanceIndex })} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md" title={tAssets('image.undo')}><AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" /></button>}
      <button onClick={() => character.appearances.length <= 1 ? setShowDeleteConfirm(true) : setShowDeleteMenu((value) => !value)} className="glass-btn-base glass-btn-soft h-6 w-6 rounded-md"><AppIcon name="trash" className="w-4 h-4 text-[var(--glass-tone-danger-fg)]" /></button>
    </div>
  )

  return (
    <div className={`glass-surface relative ${validImages.length > 1 ? 'col-span-3 p-4' : 'overflow-hidden group'}`} data-testid={`global-character-${character.id}`}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{character.name}</span>
          <span className="glass-chip glass-chip-neutral px-2 py-0.5 text-xs">{appearance.changeReason}</span>
          <span className={`glass-chip px-2 py-0.5 text-xs ${isPrimaryAppearance ? 'glass-chip-success' : 'glass-chip-info'}`}>{isPrimaryAppearance ? tAssets('character.primary') : tAssets('character.secondary')}</span>
        </div>
        {headerActions}
      </div>

      {validImages.length > 1 ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {validImages.map(({ url, index }) => {
              const isSelected = selectedIndex === index
              return (
                <div key={index} className="relative">
                  <MediaImageWithLoading src={url} alt={`${character.name} ${index + 1}`} containerClassName={`min-h-[96px] rounded-lg overflow-hidden border-2 ${isSelected ? 'border-[var(--glass-stroke-success)]' : 'border-[var(--glass-stroke-base)]'}`} className="w-full h-auto object-contain cursor-zoom-in" onClick={() => onImageClick?.(url)} />
                  <button onClick={() => handleSelectImage(isSelected ? null : index)} className={`absolute top-2 right-2 glass-btn-base w-7 h-7 rounded-full ${isSelected ? 'glass-btn-tone-success' : 'glass-btn-secondary'}`}><AppIcon name="check" className="w-4 h-4" /></button>
                </div>
              )
            })}
          </div>
          {selectedIndex !== null && <div className="mt-4 flex justify-end"><button onClick={() => handleSelectImage(selectedIndex, true)} disabled={selectImage.isPending} className="glass-btn-base glass-btn-tone-success px-4 py-2 rounded-lg flex items-center gap-2 text-sm">{selectImage.isPending ? <TaskStatusInline state={selectionState} className="[&>span]:sr-only" /> : <AppIcon name="check" className="w-4 h-4" />}{tAssets('image.confirmOption', { number: selectedIndex + 1 })}</button></div>}
        </>
      ) : (
        <div className="relative aspect-square bg-[var(--glass-bg-muted)]">
          {currentImageUrl ? <MediaImageWithLoading src={currentImageUrl} alt={character.name} containerClassName="h-full w-full" className="h-full w-full object-contain cursor-zoom-in" onClick={() => onImageClick?.(currentImageUrl)} /> : <button onClick={() => fileInputRef.current?.click()} className="h-full w-full flex flex-col items-center justify-center text-[var(--glass-text-tertiary)]"><AppIcon name="upload" className="w-10 h-10 mb-2" />{tAssets('image.upload')}</button>}
          {currentImageUrl && <button onClick={() => onEdit?.(character, appearance)} className="absolute top-2 right-2 glass-btn-base glass-btn-secondary h-7 w-7 rounded-full"><AppIcon name="edit" className="w-4 h-4" /></button>}
        </div>
      )}

      {character.appearances.length > 1 && <div className="p-2 flex gap-1 overflow-x-auto">{character.appearances.map((item, index) => <button key={item.id} onClick={() => setActiveAppearance(index)} className={`px-2 py-1 text-xs rounded ${index === activeAppearance ? 'glass-btn-primary' : 'glass-btn-soft'}`}>{item.changeReason}</button>)}</div>}
      {showDeleteMenu && character.appearances.length > 1 && <div className="absolute right-4 top-12 z-20 glass-surface-modal py-1 min-w-[120px]"><button onClick={() => deleteAppearance.mutate({ characterId: character.id, appearanceIndex: appearance.appearanceIndex }, { onSuccess: () => setActiveAppearance(0), onSettled: () => setShowDeleteMenu(false) })} className="glass-btn-base glass-btn-soft w-full justify-start rounded-none px-3 py-1.5 text-xs">{tAssets('image.deleteThis')}</button><button onClick={() => { setShowDeleteMenu(false); setShowDeleteConfirm(true) }} className="glass-btn-base glass-btn-soft w-full justify-start rounded-none px-3 py-1.5 text-xs text-[var(--glass-tone-danger-fg)]">{tAssets('character.deleteWhole')}</button></div>}
      {deleteOverlay}
    </div>
  )
}
