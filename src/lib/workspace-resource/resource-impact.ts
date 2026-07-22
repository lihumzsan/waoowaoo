import type { WorkspaceResourceName, WorkspaceResourceRef } from '@/lib/task/types'

type UnknownRecord = Record<string, unknown>

export const WORKSPACE_RESOURCE_KIND = {
  EDIT_BIBLE: 'editBible',
  PROJECT_ASSETS: 'projectAssets',
  GLOBAL_ASSETS: 'globalAssets',
  EPISODE_DATA: 'episodeData',
  PROJECT_DATA: 'projectData',
  PROJECT_CONTEXT: 'projectContext',
  CREATIVE_RESOURCES: 'creativeResources',
} as const satisfies Record<string, WorkspaceResourceName>

export const GLOBAL_ASSET_PROJECT_ID = 'global-asset-hub'

export const WORKSPACE_RESOURCE_IMPACT = {
  NONE: 'none',
  PROJECT_ASSETS: 'project_assets',
  SCOPED_ASSETS: 'scoped_assets',
  SCOPED_ASSETS_AND_CREATIVE_RESOURCES: 'scoped_assets_and_creative_resources',
  GLOBAL_ASSETS: 'global_assets',
  EPISODE: 'episode',
  PROJECT_DATA: 'project_data',
  PROJECT_WORKSPACE: 'project_workspace',
  CREATIVE_RESOURCES: 'creative_resources',
} as const

export type WorkspaceResourceImpact = (typeof WORKSPACE_RESOURCE_IMPACT)[keyof typeof WORKSPACE_RESOURCE_IMPACT]

const WORKSPACE_RESOURCE_NAMES = new Set<WorkspaceResourceName>(Object.values(WORKSPACE_RESOURCE_KIND))

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function isWorkspaceResourceName(value: string): value is WorkspaceResourceName {
  return WORKSPACE_RESOURCE_NAMES.has(value as WorkspaceResourceName)
}

function resourceRef(kind: WorkspaceResourceName, projectId: string, episodeId?: string | null): WorkspaceResourceRef {
  return episodeId === undefined ? { kind, projectId } : { kind, projectId, episodeId }
}

export function dedupeWorkspaceResourceRefs(refs: readonly WorkspaceResourceRef[]): WorkspaceResourceRef[] {
  const seen = new Set<string>()
  const deduped: WorkspaceResourceRef[] = []
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.projectId}:${ref.episodeId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(ref)
  }
  return deduped
}

/** Validate explicit wire refs without deriving identity from any other field. */
export function requireWorkspaceResourceRefs(value: unknown): WorkspaceResourceRef[] {
  if (!Array.isArray(value)) throw new Error('WORKSPACE_RESOURCE_REFS_REQUIRED')
  const refs: WorkspaceResourceRef[] = []
  for (const item of value) {
    if (!isRecord(item)) throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
    const kind = readString(item.kind)
    const projectId = readString(item.projectId)
    if (!kind || !projectId || !isWorkspaceResourceName(kind)) {
      throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
    }
    const hasEpisodeId = Object.prototype.hasOwnProperty.call(item, 'episodeId')
    const episodeId = item.episodeId === null ? null : readString(item.episodeId)
    if (hasEpisodeId && item.episodeId !== null && episodeId === null) {
      throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
    }
    refs.push(hasEpisodeId ? resourceRef(kind, projectId, episodeId) : resourceRef(kind, projectId))
  }
  const deduped = dedupeWorkspaceResourceRefs(refs)
  if (deduped.length !== refs.length) throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
  return deduped
}

function requireEpisodeId(impact: WorkspaceResourceImpact, episodeId: string | null): string {
  if (!episodeId) throw new Error(`WORKSPACE_RESOURCE_IMPACT_EPISODE_REQUIRED:${impact}`)
  return episodeId
}

function creativeResourceRefs(projectId: string, episodeId: string | null): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.CREATIVE_RESOURCES, projectId, episodeId),
    ...(episodeId
      ? [
          resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_BIBLE, projectId, episodeId),
          resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
          resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
        ]
      : []),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function episodeRefs(projectId: string, episodeId: string): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function projectAssetRefs(projectId: string, episodeId: string | null): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, projectId, episodeId),
    ...(episodeId
      ? [
          resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
          resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
        ]
      : []),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

/**
 * The sole resolver from a registry-declared resource impact to concrete refs.
 * Callers must choose the impact from an exhaustive Task/Operation registry.
 */
export function resolveWorkspaceResourceRefs(params: {
  impact: WorkspaceResourceImpact
  projectId: string
  episodeId: string | null
}): WorkspaceResourceRef[] {
  const { impact, projectId, episodeId } = params
  switch (impact) {
    case WORKSPACE_RESOURCE_IMPACT.NONE:
      return []
    case WORKSPACE_RESOURCE_IMPACT.PROJECT_ASSETS:
      return projectAssetRefs(projectId, episodeId)
    case WORKSPACE_RESOURCE_IMPACT.SCOPED_ASSETS:
      return projectId === GLOBAL_ASSET_PROJECT_ID
        ? [resourceRef(WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS, projectId)]
        : projectAssetRefs(projectId, episodeId)
    case WORKSPACE_RESOURCE_IMPACT.SCOPED_ASSETS_AND_CREATIVE_RESOURCES:
      return dedupeWorkspaceResourceRefs([
        ...(projectId === GLOBAL_ASSET_PROJECT_ID
          ? [resourceRef(WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS, projectId)]
          : projectAssetRefs(projectId, episodeId)),
        resourceRef(WORKSPACE_RESOURCE_KIND.CREATIVE_RESOURCES, projectId, episodeId),
      ])
    case WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS:
      return [resourceRef(WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS, projectId)]
    case WORKSPACE_RESOURCE_IMPACT.EPISODE:
      return episodeRefs(projectId, requireEpisodeId(impact, episodeId))
    case WORKSPACE_RESOURCE_IMPACT.PROJECT_DATA:
      return [resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId)]
    case WORKSPACE_RESOURCE_IMPACT.PROJECT_WORKSPACE:
      return episodeId
        ? dedupeWorkspaceResourceRefs([
            ...projectAssetRefs(projectId, episodeId),
            ...creativeResourceRefs(projectId, episodeId),
          ])
        : projectAssetRefs(projectId, null)
    case WORKSPACE_RESOURCE_IMPACT.CREATIVE_RESOURCES:
      return creativeResourceRefs(projectId, episodeId)
  }
}
