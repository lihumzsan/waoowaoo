'use client'

import { useMemo } from 'react'
import type { ProjectWorkspaceProps } from '../types'
import type { CapabilitySelections } from '@/lib/ai-registry/types'

function parseCapabilitySelections(raw: unknown): CapabilitySelections {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as CapabilitySelections
  }
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as CapabilitySelections
  } catch {
    return {}
  }
}

export function useWorkspaceProjectSnapshot({
  project,
  episode,
}: Pick<ProjectWorkspaceProps, 'project' | 'episode'>) {
  return useMemo(() => {
    const capabilityOverrides = parseCapabilitySelections(project.capabilityOverrides)
    return {
      projectData: project,
      projectCharacters: project.characters || [],
      projectLocations: project.locations || [],
      globalAssetText: project.globalAssetText || '',
      novelText: episode?.novelText || '',
      analysisModel: project.analysisModel ?? undefined,
      characterModel: project.characterModel ?? undefined,
      locationModel: project.locationModel ?? undefined,
      editModel: project.editModel ?? undefined,
      videoModel: project.videoModel ?? undefined,
      musicModel: project.musicModel ?? undefined,
      soundEffectModel: project.soundEffectModel ?? undefined,
      videoRatio: project.videoRatio ?? undefined,
      capabilityOverrides,
    }
  }, [episode?.novelText, project])
}
