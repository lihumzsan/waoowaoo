'use client'

import { useCallback } from 'react'
import { isAbortError } from '@/lib/error-utils'
import {
  useUndoProjectCharacterImage,
  useUndoProjectLocationImage,
} from '@/lib/query/hooks'

type ToastType = 'success' | 'warning' | 'error'
type ShowToast = (message: string, type?: ToastType, duration?: number) => void
type TranslateValues = Record<string, string | number | Date>
type Translate = (key: string, values?: TranslateValues) => string

interface UseAssetImageMaintenanceParams {
  projectId: string
  t: Translate
  showToast: ShowToast
  onRefresh: () => void | Promise<void>
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function useAssetImageMaintenance({
  projectId,
  t,
  showToast,
  onRefresh,
}: UseAssetImageMaintenanceParams) {
  const undoCharacterImage = useUndoProjectCharacterImage(projectId)
  const undoLocationImage = useUndoProjectLocationImage(projectId)

  const handleUndoCharacter = useCallback(async (characterId: string, appearanceId: string) => {
    if (!confirm(t('image.undoConfirm'))) return
    try {
      await undoCharacterImage.mutateAsync({ characterId, appearanceId })
      showToast(t('image.undoSuccess'), 'success')
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
    } catch (error: unknown) {
      if (isAbortError(error)) {
        await Promise.resolve(onRefresh())
        return
      }
      showToast(`${t('image.undoFailed')}: ${getErrorMessage(error)}`, 'error')
    }
  }, [onRefresh, showToast, t, undoLocationImage])

  return {
    handleUndoCharacter,
    handleUndoLocation,
  }
}
