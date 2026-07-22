'use client'

import {
  CharacterEditModal as SharedCharacterEditModal,
} from '@/components/shared/assets/CharacterEditModal'

interface CharacterEditModalProps {
  characterId: string
  characterName: string
  appearanceId: number
  description: string
  introduction?: string | null
  descriptionIndex?: number
  projectId: string
  onClose: () => void
  onUpdate: (newDescription: string) => void
  onIntroductionUpdate?: (newIntroduction: string) => void
  onNameUpdate?: (newName: string) => void
}

export default function CharacterEditModal({
  characterId,
  characterName,
  appearanceId,
  description,
  introduction,
  descriptionIndex,
  projectId,
  onClose,
  onUpdate,
  onIntroductionUpdate,
  onNameUpdate,
}: CharacterEditModalProps) {
  return (
    <SharedCharacterEditModal
      mode="project"
      characterId={characterId}
      characterName={characterName}
      appearanceId={String(appearanceId)}
      description={description}
      introduction={introduction}
      descriptionIndex={descriptionIndex}
      projectId={projectId}
      onClose={onClose}
      onUpdate={onUpdate}
      onIntroductionUpdate={onIntroductionUpdate}
      onNameUpdate={onNameUpdate}
    />
  )
}
