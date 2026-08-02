'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { shouldShowError } from '@/lib/error-utils'
import {
  useCreateAssetHubCharacter,
} from '@/lib/query/hooks'
import { useToast } from '@/contexts/ToastContext'

interface UseCharacterCreationSubmitParams {
  folderId?: string | null
  name: string
  description: string
  onSuccess: () => void
  onClose: () => void
}

export function useCharacterCreationSubmit({
  folderId,
  name,
  description,
  onSuccess,
  onClose,
}: UseCharacterCreationSubmitParams) {
  const t = useTranslations('assetModal')
  const { showError } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const createAssetHubCharacter = useCreateAssetHubCharacter()

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !description.trim()) return
    try {
      setIsSubmitting(true)
      await createAssetHubCharacter.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        folderId: folderId ?? null,
      })
      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        showError(error, t('errors.createFailed'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    createAssetHubCharacter,
    description,
    folderId,
    name,
    onClose,
    onSuccess,
    showError,
    t,
  ])

  return {
    isSubmitting,
    handleSubmit,
  }
}
