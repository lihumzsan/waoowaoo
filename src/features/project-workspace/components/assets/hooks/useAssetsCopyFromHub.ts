'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { isAbortError } from '@/lib/error-utils'
import { useCopyProjectAssetFromGlobal } from '@/lib/query/hooks'
import { useToast } from '@/contexts/ToastContext'

export type GlobalCopyTarget = {
  type: 'character' | 'location' | 'prop'
  targetId: string
}

interface UseAssetsCopyFromHubParams {
  projectId: string
}

function resolveCopySuccessMessage(
  t: ReturnType<typeof useTranslations>,
  type: GlobalCopyTarget['type'],
): string {
  if (type === 'character') return t('assetLibrary.copySuccessCharacter')
  if (type === 'location') return t('assetLibrary.copySuccessLocation')
  return t('assetLibrary.copySuccessProp')
}

export function useAssetsCopyFromHub({ projectId }: UseAssetsCopyFromHubParams) {
  const t = useTranslations('assets')
  const { showError, showToast } = useToast()
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
        showError(error, t('assetLibrary.copyFailed', { error: t('common.unknownError') }))
      }
    } finally {
      setIsGlobalCopyInFlight(false)
    }
  }, [copyFromGlobalAsset, copyFromGlobalTarget, showError, showToast, t])

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
