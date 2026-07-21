import type { ProjectPolicyOverrideInput, ProjectPolicySnapshot } from './types'

export function resolveProjectContextPolicy(params: {
  projectId: string
  episodeId?: string | null
  projectPolicy?: Partial<ProjectPolicySnapshot> | null
  commandPolicy?: ProjectPolicyOverrideInput | null
}): ProjectPolicySnapshot {
  const projectPolicy = params.projectPolicy || null
  const commandPolicy = params.commandPolicy || null

  return {
    projectId: params.projectId,
    episodeId: params.episodeId || null,
    videoRatio: commandPolicy?.videoRatio !== undefined
      ? commandPolicy.videoRatio
      : (projectPolicy?.videoRatio ?? null),
    videoRatioConfirmedAt: projectPolicy?.videoRatioConfirmedAt ?? null,
    videoRatioConfirmationVersion: projectPolicy?.videoRatioConfirmationVersion ?? 0,
    analysisModel:
      commandPolicy?.analysisModel !== undefined
        ? commandPolicy.analysisModel
        : (projectPolicy?.analysisModel ?? null),
    overrides: {
      ...(projectPolicy?.overrides || {}),
      ...(commandPolicy?.overrides || {}),
    },
  }
}
