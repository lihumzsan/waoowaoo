'use client'

import { useCallback } from 'react'
import { isAbortError } from '@/lib/error-utils'
import {
  useUndoProjectCharacterImage,
  useUndoProjectLocationImage,
} from '@/lib/query/hooks'
import { useToast } from '@/contexts/ToastContext'

type TranslateValues = Record<string, string | number | Date>
type Translate = (key: string, values?: TranslateValues) => string

interface UseAssetImageMaintenanceParams {
  projectId: string
  t: Translate
  onRefresh: () => void | Promise<void>
}

export function useAssetImageMaintenance({
  projectId,
  t,
  onRefresh,
}: UseAssetImageMaintenanceParams) {
  const { showError, showToast } = useToast()
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
      showError(error, t('image.undoFailed'))
    }
  }, [onRefresh, showError, showToast, t, undoCharacterImage])

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
      showError(error, t('image.undoFailed'))
    }
  }, [onRefresh, showError, showToast, t, undoLocationImage])

  return {
    handleUndoCharacter,
    handleUndoLocation,
  }
}
