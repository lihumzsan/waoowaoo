import type { WorkspaceResourceName, WorkspaceResourceRef } from '@/lib/task/types'

export const GLOBAL_ASSET_PROJECT_ID = 'global-asset-hub'

export const WORKSPACE_RESOURCE_IMPACT = {
  NONE: 'none',
  GLOBAL_ASSETS: 'global_assets',
  PROJECT_DATA: 'project_data',
  WORKSPACE_RESOURCES: 'workspace_resources',
} as const

export type WorkspaceResourceImpact =
  (typeof WORKSPACE_RESOURCE_IMPACT)[keyof typeof WORKSPACE_RESOURCE_IMPACT]

const RESOURCE_NAMES = new Set<WorkspaceResourceName>([
  'globalAssets',
  'projectData',
  'workspaceResources',
])

export function isWorkspaceResourceName(value: string): value is WorkspaceResourceName {
  return RESOURCE_NAMES.has(value as WorkspaceResourceName)
}

export function dedupeWorkspaceResourceRefs(
  refs: readonly WorkspaceResourceRef[],
): WorkspaceResourceRef[] {
  return Array.from(new Map(refs.map((ref) => [`${ref.kind}:${ref.projectId}`, ref])).values())
}

export function requireWorkspaceResourceRefs(value: unknown): WorkspaceResourceRef[] {
  if (!Array.isArray(value)) throw new Error('WORKSPACE_RESOURCE_REFS_REQUIRED')
  const refs = value.map((entry): WorkspaceResourceRef => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.kind !== 'string'
      || !isWorkspaceResourceName(record.kind)
      || typeof record.projectId !== 'string'
      || !record.projectId.trim()
      || Object.keys(record).some((key) => key !== 'kind' && key !== 'projectId')
    ) {
      throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
    }
    return { kind: record.kind, projectId: record.projectId }
  })
  if (dedupeWorkspaceResourceRefs(refs).length !== refs.length) {
    throw new Error('WORKSPACE_RESOURCE_REFS_INVALID')
  }
  return refs
}

export function resolveWorkspaceResourceRefs(params: {
  impact: WorkspaceResourceImpact
  projectId: string
}): WorkspaceResourceRef[] {
  switch (params.impact) {
    case WORKSPACE_RESOURCE_IMPACT.NONE:
      return []
    case WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS:
      return [{ kind: 'globalAssets', projectId: params.projectId }]
    case WORKSPACE_RESOURCE_IMPACT.PROJECT_DATA:
      return [{ kind: 'projectData', projectId: params.projectId }]
    case WORKSPACE_RESOURCE_IMPACT.WORKSPACE_RESOURCES:
      return [{ kind: 'workspaceResources', projectId: params.projectId }]
  }
}
