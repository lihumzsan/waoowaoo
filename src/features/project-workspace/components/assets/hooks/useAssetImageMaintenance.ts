'use client'

import { useCallback } from 'react'
import { isAbortError } from '@/lib/error-utils'
import {
  useUndoProjectCharacterImage,
  useUndoProjectLocationImage,
  useUpdateProjectAppearanceDescription,
  useUpdateProjectLocationDescription,
} from '@/lib/query/hooks'

type ToastType = 'success' | 'warning' | 'error'
type ShowToast = (message: string, type?: ToastType, duration?: number) => void
type TranslateValues = Record<string, string | number | Date>
type Translate = (key: string, values?: TranslateValues) => string

interface EditingAppearanceState {
  characterId: string
  appearanceId: string
  descriptionIndex?: number
}

interface EditingLocationState {
  locationId: string
}

interface UseAssetImageMaintenanceParams {
  projectId: string
  t: Translate
  showToast: ShowToast
  onRefresh: () => void | Promise<void>
  editingAppearance: EditingAppearanceState | null
  editingLocation: EditingLocationState | null
  closeEditingAppearance: () => void
  closeEditingLocation: () => void
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function useAssetImageMaintenance({
  projectId,
  t,
  showToast,
  onRefresh,
  editingAppearance,
  editingLocation,
  closeEditingAppearance,
  closeEditingLocation,
}: UseAssetImageMaintenanceParams) {
  const undoCharacterImage = useUndoProjectCharacterImage(projectId)
  const undoLocationImage = useUndoProjectLocationImage(projectId)
  const updateAppearanceDescription = useUpdateProjectAppearanceDescription(projectId)
  const updateLocationDescription = useUpdateProjectLocationDescription(projectId)

  const handleUndoCharacter = useCallback(async (characterId: string, appearanceId: string) => {
    if (!confirm(t('image.undoConfirm'))) return
    try {
      await undoCharacterImage.mutateAsync({ characterId, appearanceId })
      showToast(t('image.undoSuccess'), 'success')
      await Promise.resolve(onRefresh())
    } catch (error: unknown) {
      if (isAbortError(error)) {
        await Promise.resolve(onRefresh())
        return
      }
      showToast(`${t('image.undoFailed')}: ${getErrorMessage(error)}`, 'error')
    }
  }, [onRefresh, showToast, t, undoCharacterImage])

  const handleUndoLocation = useCallback(async (locationId: string) => {
    if (!confirm(t('image.undoConfirm'))) return
    try {
      await undoLocationImage.mutateAsync(locationId)
      showToast(t('image.undoSuccess'), 'success')
      await Promise.resolve(onRefresh())
    } catch (error: unknown) {
      if (isAbortError(error)) {
        await Promise.resolve(onRefresh())
        return
      }
      showToast(`${t('image.undoFailed')}: ${getErrorMessage(error)}`, 'error')
    }
  }, [onRefresh, showToast, t, undoLocationImage])

  const handleUpdateAppearanceDescription = useCallback(async (newDescription: string) => {
    if (!editingAppearance) return
    const { characterId, appearanceId, descriptionIndex } = editingAppearance
    try {
      await updateAppearanceDescription.mutateAsync({
        characterId,
        appearanceId,
        description: newDescription,
        descriptionIndex,
      })
      closeEditingAppearance()
      await Promise.resolve(onRefresh())
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        alert(`${t('character.updateFailed')}: ${getErrorMessage(error)}`)
      }
    }
  }, [closeEditingAppearance, editingAppearance, onRefresh, t, updateAppearanceDescription])

  const handleUpdateLocationDescription = useCallback(async (newDescription: string) => {
    if (!editingLocation) return
    try {
      await updateLocationDescription.mutateAsync({
        locationId: editingLocation.locationId,
        description: newDescription,
      })
      closeEditingLocation()
      await Promise.resolve(onRefresh())
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        alert(`${t('location.updateFailed')}: ${getErrorMessage(error)}`)
      }
    }
  }, [closeEditingLocation, editingLocation, onRefresh, t, updateLocationDescription])

  return {
    handleUndoCharacter,
    handleUndoLocation,
    handleUpdateAppearanceDescription,
    handleUpdateLocationDescription,
  }
}
