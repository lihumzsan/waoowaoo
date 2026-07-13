'use client'

import { useCallback, useMemo, useState } from 'react'
import { useProjectAssets } from '@/lib/query/hooks'

export function useAssetGenerationActivity(projectId: string) {
  const { data: assets } = useProjectAssets(projectId)
  const [submittingTaskKeys, setSubmittingTaskKeys] = useState<Set<string>>(new Set())

  const clearSubmittingTaskKey = useCallback((key: string) => {
    setSubmittingTaskKeys((previous) => {
      if (!previous.has(key)) return previous
      const next = new Set(previous)
      next.delete(key)
      return next
    })
  }, [])

  const registerSubmittingTaskKey = useCallback((key: string) => {
    setSubmittingTaskKeys((previous) => new Set([...previous, key]))
  }, [])

  const activeTaskKeys = useMemo(() => {
    const active = new Set(submittingTaskKeys)
    for (const character of assets?.characters ?? []) {
      for (const appearance of character.appearances ?? []) {
        if (!appearance.imageTaskRunning) continue
        active.add(`character-${character.id}-${appearance.appearanceIndex}-group`)
        const imageCount = Math.max(1, appearance.imageUrls?.length ?? 0)
        for (let index = 0; index < imageCount; index += 1) {
          active.add(`character-${character.id}-${appearance.appearanceIndex}-${index}`)
        }
      }
    }
    for (const location of assets?.locations ?? []) {
      if (!location.images?.some((image) => image.imageTaskRunning)) continue
      active.add(`location-${location.id}-group`)
      for (const image of location.images ?? []) {
        if (image.imageTaskRunning) active.add(`location-${location.id}-${image.imageIndex}`)
      }
    }
    return active
  }, [assets?.characters, assets?.locations, submittingTaskKeys])

  return {
    activeTaskKeys,
    registerSubmittingTaskKey,
    clearSubmittingTaskKey,
  }
}
