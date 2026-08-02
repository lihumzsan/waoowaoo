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
    description,
    onClose,
}: LocationEditModalProps) {
    return (
        <SharedLocationEditModal
            locationId={locationId}
            locationName={locationName}
            description={description}
            summary={summary}
            onClose={onClose}
        />
    )
}

export default LocationEditModal
