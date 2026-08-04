'use client'

import { CharacterEditModal as SharedCharacterEditModal } from '@/components/shared/assets/CharacterEditModal'

interface CharacterEditModalProps {
    characterId: string
    characterName: string
    appearanceIndex: number
    changeReason: string
    description: string
    onClose: () => void
}

export function CharacterEditModal({
    characterId,
    characterName,
    appearanceIndex,
    changeReason,
    description,
    onClose,
}: CharacterEditModalProps) {
    return (
        <SharedCharacterEditModal
            characterId={characterId}
            characterName={characterName}
            description={description}
            appearanceIndex={appearanceIndex}
            changeReason={changeReason}
            onClose={onClose}
        />
    )
}

export default CharacterEditModal
