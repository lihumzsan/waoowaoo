export interface LocationSpatialProfileCandidate {
  readonly targetId: string | null
  readonly selectedImage: {
    readonly imageUrl: string | null
    readonly imageMediaId?: string | null
    readonly spatialProfileStatus: string | null
    readonly spatialProfileJson: unknown | null
  } | null
}

export interface LocationSpatialProfileReadiness {
  readonly requiredCount: number
  readonly readyCount: number
  readonly missingCount: number
}

export interface StoryboardImageReadiness {
  readonly panelCount: number
  readonly readyCount: number
  readonly missingCount: number
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function isStoryboardSpatialProfileStageReady(stage: string | null | undefined): boolean {
  return stage === 'spatial_profile_ready' || stage === 'panel_prompts_ready'
}

export function resolveLocationSpatialProfileReadiness(
  candidates: readonly LocationSpatialProfileCandidate[],
): LocationSpatialProfileReadiness {
  const requiredCount = candidates.length
  const readyCount = candidates.filter((candidate) => {
    const image = candidate.selectedImage
    if (!candidate.targetId || !image) return false
    return (hasNonEmptyText(image.imageUrl) || hasNonEmptyText(image.imageMediaId))
      && image.spatialProfileStatus === 'ready'
      && image.spatialProfileJson !== null
      && image.spatialProfileJson !== undefined
  }).length

  return {
    requiredCount,
    readyCount,
    missingCount: Math.max(0, requiredCount - readyCount),
  }
}

export function resolveStoryboardImageReadiness(
  panels: readonly {
    readonly imageUrl: string | null
    readonly imageMediaId?: string | null
  }[],
): StoryboardImageReadiness {
  const panelCount = panels.length
  const readyCount = panels.filter((panel) => hasNonEmptyText(panel.imageUrl) || hasNonEmptyText(panel.imageMediaId)).length
  return {
    panelCount,
    readyCount,
    missingCount: Math.max(0, panelCount - readyCount),
  }
}
