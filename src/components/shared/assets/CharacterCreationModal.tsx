'use client'

import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectAssets } from '@/lib/query/hooks'
import CharacterCreationForm from './character-creation/CharacterCreationForm'
import { useCharacterCreationSubmit } from './character-creation/hooks/useCharacterCreationSubmit'
import { AppIcon } from '@/components/ui/icons'

export interface CharacterCreationModalProps {
  mode: 'asset-hub' | 'project'
  folderId?: string | null
  projectId?: string
  onClose: () => void
  onSuccess: () => void
}

const XMarkIcon = ({ className }: { className?: string }) => (
  <AppIcon name="close" className={className} />
)

export function CharacterCreationModal({
  mode,
  folderId,
  projectId,
  onClose,
  onSuccess,
}: CharacterCreationModalProps) {
  const t = useTranslations('assetModal')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSubAppearance, setIsSubAppearance] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [changeReason, setChangeReason] = useState('')

  const projectAssets = useProjectAssets(mode === 'project' ? (projectId ?? null) : null)
  const availableCharacters = useMemo(() => {
    if (mode !== 'project') return []
    return (projectAssets.data?.characters || []).map((character) => ({
      id: character.id,
      name: character.name,
      appearances: character.appearances || [],
    }))
  }, [mode, projectAssets.data?.characters])

  const {
    isSubmitting,
    handleSubmit,
  } = useCharacterCreationSubmit({
    mode,
    folderId,
    projectId,
    name,
    description,
    isSubAppearance,
    selectedCharacterId,
    changeReason,
    onSuccess,
    onClose,
  })

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isSubmitting) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="glass-surface-modal max-w-lg w-full max-h-[85vh] flex flex-col">
        <div className="p-6 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
              {t('character.title')}
            </h3>
            <button
              onClick={onClose}
              className="glass-btn-base glass-btn-soft w-8 h-8 rounded-full flex items-center justify-center text-[var(--glass-text-tertiary)]"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <CharacterCreationForm
            mode={mode}
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            isSubAppearance={isSubAppearance}
            setIsSubAppearance={setIsSubAppearance}
            selectedCharacterId={selectedCharacterId}
            setSelectedCharacterId={setSelectedCharacterId}
            changeReason={changeReason}
            setChangeReason={setChangeReason}
            availableCharacters={availableCharacters}
          />
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-xl flex-shrink-0">
          <button
            onClick={onClose}
            className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm"
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => { void handleSubmit() }}
            disabled={isSubmitting || (isSubAppearance
              ? !selectedCharacterId.trim() || !changeReason.trim() || !description.trim()
              : !name.trim() || !description.trim())}
            className="glass-btn-base glass-btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? t('common.adding') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
