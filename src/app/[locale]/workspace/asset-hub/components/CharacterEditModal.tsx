'use client'

import { CharacterEditModal as SharedCharacterEditModal } from '@/components/shared/assets/CharacterEditModal'
import { useRefreshGlobalAssets } from '@/lib/query/hooks'

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
    const onRefresh = useRefreshGlobalAssets()

    return (
        <SharedCharacterEditModal
            mode="asset-hub"
            characterId={characterId}
            characterName={characterName}
            description={description}
            appearanceIndex={appearanceIndex}
            changeReason={changeReason}
            onClose={onClose}
            onRefresh={onRefresh}
        />
    )
}

export default CharacterEditModal
