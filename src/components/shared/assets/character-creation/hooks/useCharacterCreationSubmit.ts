'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { shouldShowError } from '@/lib/error-utils'
import {
  useCreateAssetHubCharacter,
  useCreateProjectCharacter,
  useCreateProjectCharacterAppearance,
} from '@/lib/query/hooks'

type Mode = 'asset-hub' | 'project'

interface UseCharacterCreationSubmitParams {
  mode: Mode
  folderId?: string | null
  projectId?: string
  name: string
  description: string
  isSubAppearance: boolean
  selectedCharacterId: string
  changeReason: string
  onSuccess: () => void
  onClose: () => void
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function useCharacterCreationSubmit({
  mode,
  folderId,
  projectId,
  name,
  description,
  isSubAppearance,
  selectedCharacterId,
  changeReason,
  onSuccess,
  onClose,
}: UseCharacterCreationSubmitParams) {
  const t = useTranslations('assetModal')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const createAssetHubCharacter = useCreateAssetHubCharacter()
  const createProjectCharacter = useCreateProjectCharacter(projectId ?? '')
  const createProjectAppearance = useCreateProjectCharacterAppearance(projectId ?? '')

  const handleSubmit = useCallback(async () => {
    if (isSubAppearance) {
      if (!selectedCharacterId.trim() || !changeReason.trim() || !description.trim()) return
      try {
        setIsSubmitting(true)
        await createProjectAppearance.mutateAsync({
          characterId: selectedCharacterId,
          changeReason: changeReason.trim(),
          description: description.trim(),
        })
        onSuccess()
        onClose()
      } catch (error: unknown) {
        if (shouldShowError(error)) {
          alert(getErrorMessage(error, t('errors.addSubAppearanceFailed')))
        }
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    if (!name.trim() || !description.trim()) return
    try {
      setIsSubmitting(true)
      if (mode === 'asset-hub') {
        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
          folderId: folderId ?? null,
        })
      } else {
        await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
        })
      }
      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    changeReason,
    createAssetHubCharacter,
    createProjectAppearance,
    createProjectCharacter,
    description,
    folderId,
    isSubAppearance,
    mode,
    name,
    onClose,
    onSuccess,
    selectedCharacterId,
    t,
  ])

  return {
    isSubmitting,
    handleSubmit,
  }
}
