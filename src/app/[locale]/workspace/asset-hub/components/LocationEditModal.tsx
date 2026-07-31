'use client'

import { LocationEditModal as SharedLocationEditModal } from '@/components/shared/assets/LocationEditModal'

interface LocationEditModalProps {
    locationId: string
    locationName: string
    summary: string
    imageIndex: number
    description: string
    onClose: () => void
}

export function LocationEditModal({
    locationId,
    locationName,
    summary,
    imageIndex,
    description,
    onClose,
}: LocationEditModalProps) {
    return (
        <SharedLocationEditModal
            mode="asset-hub"
            locationId={locationId}
            locationName={locationName}
            description={description}
            summary={summary}
            imageIndex={imageIndex}
            onClose={onClose}
        />
    )
}

export default LocationEditModal
