'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { isAbortError } from '@/lib/error-utils'
import { useCopyProjectAssetFromGlobal } from '@/lib/query/hooks'

type ToastType = 'success' | 'warning' | 'error'

type ShowToast = (message: string, type?: ToastType, duration?: number) => void

export type GlobalCopyTarget = {
  type: 'character' | 'location' | 'prop'
  targetId: string
}

interface UseAssetsCopyFromHubParams {
  projectId: string
  showToast: ShowToast
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

function resolveCopySuccessMessage(
  t: ReturnType<typeof useTranslations>,
  type: GlobalCopyTarget['type'],
): string {
  if (type === 'character') return t('assetLibrary.copySuccessCharacter')
  if (type === 'location') return t('assetLibrary.copySuccessLocation')
  return t('assetLibrary.copySuccessProp')
}

export function useAssetsCopyFromHub({ projectId, showToast }: UseAssetsCopyFromHubParams) {
  const t = useTranslations('assets')
  const copyFromGlobalAsset = useCopyProjectAssetFromGlobal(projectId)
  const [copyFromGlobalTarget, setCopyFromGlobalTarget] = useState<GlobalCopyTarget | null>(null)
  const [isGlobalCopyInFlight, setIsGlobalCopyInFlight] = useState(false)

  const handleCopyFromGlobal = useCallback((characterId: string) => {
    setCopyFromGlobalTarget({ type: 'character', targetId: characterId })
  }, [])

  const handleCopyLocationFromGlobal = useCallback((locationId: string) => {
    setCopyFromGlobalTarget({ type: 'location', targetId: locationId })
  }, [])

  const handleCopyPropFromGlobal = useCallback((propId: string) => {
    setCopyFromGlobalTarget({ type: 'prop', targetId: propId })
  }, [])

  const handleCloseCopyPicker = useCallback(() => {
    setCopyFromGlobalTarget(null)
  }, [])

  const handleConfirmCopyFromGlobal = useCallback(async (globalAssetId: string) => {
    if (!copyFromGlobalTarget) return

    setIsGlobalCopyInFlight(true)
    try {
      await copyFromGlobalAsset.mutateAsync({
        type: copyFromGlobalTarget.type,
        targetId: copyFromGlobalTarget.targetId,
        globalAssetId,
      })

      showToast(resolveCopySuccessMessage(t, copyFromGlobalTarget.type), 'success')
      setCopyFromGlobalTarget(null)
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        showToast(t('assetLibrary.copyFailed', { error: getErrorMessage(error) }), 'error')
      }
    } finally {
      setIsGlobalCopyInFlight(false)
    }
  }, [copyFromGlobalAsset, copyFromGlobalTarget, showToast, t])

  return {
    copyFromGlobalTarget,
    isGlobalCopyInFlight,
    handleCopyFromGlobal,
    handleCopyLocationFromGlobal,
    handleCopyPropFromGlobal,
    handleConfirmCopyFromGlobal,
    handleCloseCopyPicker,
  }
}
