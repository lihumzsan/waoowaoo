'use client'

import { LocationCreationModal } from '@/components/shared/assets/LocationCreationModal'

interface AddLocationModalProps {
    folderId: string | null
    onClose: () => void
    onSuccess: () => void
}

export function AddLocationModal({ folderId, onClose, onSuccess }: AddLocationModalProps) {
    return (
        <LocationCreationModal
            mode="asset-hub"
            folderId={folderId}
            onClose={onClose}
            onSuccess={onSuccess}
        />
    )
}
