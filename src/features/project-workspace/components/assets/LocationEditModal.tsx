'use client'

import { LocationEditModal as SharedLocationEditModal } from '@/components/shared/assets/LocationEditModal'

interface LocationEditModalProps {
  locationId: string
  locationName: string
  description: string
  projectId: string
  onClose: () => void
  onUpdate: (newDescription: string) => void
  onNameUpdate?: (newName: string) => void
}

export default function LocationEditModal({
  locationId,
  locationName,
  description,
  projectId,
  onClose,
  onUpdate,
  onNameUpdate,
}: LocationEditModalProps) {
  return (
    <SharedLocationEditModal
      mode="project"
      locationId={locationId}
      locationName={locationName}
      description={description}
      projectId={projectId}
      onClose={onClose}
      onUpdate={onUpdate}
      onNameUpdate={onNameUpdate}
    />
  )
}
