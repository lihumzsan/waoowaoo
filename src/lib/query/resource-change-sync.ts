import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './keys'
import { TASK_EVENT_TYPE, TASK_TYPE, type WorkspaceResourceName } from '@/lib/task/types'
import type {
  ProjectEditCinematographyShotPlan,
  ProjectEditDirectorDecoupage,
  ProjectEditScreenplay,
  ProjectEditScript,
} from '@/types/project'

type UnknownRecord = Record<string, unknown>

export const WORKSPACE_RESOURCE_KIND = {
  EDIT_SCREENPLAY: 'editScreenplay',
  EDIT_DIRECTOR_DECOUPAGE: 'editDirectorDecoupage',
  EDIT_SCRIPT: 'editScript',
  EDIT_CINEMATOGRAPHY_SHOT_PLAN: 'editCinematographyShotPlan',
  STORYBOARDS: 'storyboards',
  PROJECT_ASSETS: 'projectAssets',
  VIDEOS: 'videos',
  EPISODE_DATA: 'episodeData',
  PROJECT_DATA: 'projectData',
  PROJECT_CONTEXT: 'projectContext',
} as const satisfies Record<string, WorkspaceResourceName>

export type WorkspaceResourceKind = (typeof WORKSPACE_RESOURCE_KIND)[keyof typeof WORKSPACE_RESOURCE_KIND]

const WORKSPACE_RESOURCE_NAMES = new Set<WorkspaceResourceName>(Object.values(WORKSPACE_RESOURCE_KIND))

export function isWorkspaceResourceName(value: string): value is WorkspaceResourceName {
  return WORKSPACE_RESOURCE_NAMES.has(value as WorkspaceResourceName)
}

export type WorkspaceResourceChange =
  | {
      kind: typeof WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY
      projectId: string
      episodeId: string
      data?: ProjectEditScreenplay | null
    }
  | {
      kind: typeof WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE
      projectId: string
      episodeId: string
      data?: ProjectEditDirectorDecoupage | null
    }
  | {
      kind: typeof WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT
      projectId: string
      episodeId: string
      data?: ProjectEditScript | null
    }
  | {
      kind: typeof WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN
      projectId: string
      episodeId: string
      data?: ProjectEditCinematographyShotPlan | null
    }
  | {
      kind:
        | typeof WORKSPACE_RESOURCE_KIND.STORYBOARDS
        | typeof WORKSPACE_RESOURCE_KIND.VIDEOS
        | typeof WORKSPACE_RESOURCE_KIND.EPISODE_DATA
        | typeof WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT
      projectId: string
      episodeId: string
    }
  | {
      kind: typeof WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS
      projectId: string
      episodeId?: string | null
    }
  | {
      kind: typeof WORKSPACE_RESOURCE_KIND.PROJECT_DATA
      projectId: string
    }

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readPayloadRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null
}

function normalizeTaskType(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null
}

function isAssetTaskType(taskType: string | null): boolean {
  return taskType === TASK_TYPE.IMAGE_CHARACTER ||
    taskType === TASK_TYPE.IMAGE_LOCATION ||
    taskType === TASK_TYPE.MODIFY_ASSET_IMAGE ||
    taskType === TASK_TYPE.AI_MODIFY_APPEARANCE ||
    taskType === TASK_TYPE.AI_MODIFY_LOCATION ||
    taskType === TASK_TYPE.AI_MODIFY_PROP ||
    taskType === TASK_TYPE.AI_CREATE_CHARACTER ||
    taskType === TASK_TYPE.AI_CREATE_LOCATION ||
    taskType === TASK_TYPE.REFERENCE_TO_CHARACTER
}

function isProjectAssetTargetType(targetType: string | null): boolean {
  return targetType === 'CharacterAppearance' ||
    targetType === 'LocationImage' ||
    targetType === 'ProjectCharacter' ||
    targetType === 'ProjectLocation' ||
    targetType === 'ProjectAsset' ||
    targetType === 'ProjectProp'
}

function episodeScopedChange(
  kind: Extract<WorkspaceResourceKind, (
    | typeof WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY
    | typeof WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE
    | typeof WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT
    | typeof WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN
    | typeof WORKSPACE_RESOURCE_KIND.STORYBOARDS
    | typeof WORKSPACE_RESOURCE_KIND.VIDEOS
    | typeof WORKSPACE_RESOURCE_KIND.EPISODE_DATA
    | typeof WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT
  )>,
  projectId: string,
  episodeId: string,
): WorkspaceResourceChange {
  return { kind, projectId, episodeId }
}

function projectScopedChange(
  kind: typeof WORKSPACE_RESOURCE_KIND.PROJECT_DATA | typeof WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS,
  projectId: string,
  episodeId?: string | null,
): WorkspaceResourceChange {
  if (kind === WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS) return { kind, projectId, episodeId }
  return { kind, projectId }
}

function editPipelineResourceChanges(projectId: string, episodeId: string): WorkspaceResourceChange[] {
  return [
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.STORYBOARDS, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function storyboardResourceChanges(projectId: string, episodeId: string): WorkspaceResourceChange[] {
  return [
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.STORYBOARDS, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function mediaResourceChanges(projectId: string, episodeId: string): WorkspaceResourceChange[] {
  return [
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.VIDEOS, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.STORYBOARDS, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    episodeScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function assetResourceChanges(projectId: string, episodeId: string | null): WorkspaceResourceChange[] {
  return [
    projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, projectId, episodeId),
    ...(episodeId
      ? [
          episodeScopedChange(WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT, projectId, episodeId),
          episodeScopedChange(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
          episodeScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
        ]
      : []),
    projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function dedupeResourceChanges(changes: readonly WorkspaceResourceChange[]): WorkspaceResourceChange[] {
  const seen = new Set<string>()
  const deduped: WorkspaceResourceChange[] = []
  for (const change of changes) {
    const key = 'episodeId' in change
      ? `${change.kind}:${change.projectId}:${change.episodeId}`
      : `${change.kind}:${change.projectId}`
    if (seen.has(key)) {
      const existingIndex = deduped.findIndex((item) => {
        const existingKey = 'episodeId' in item
          ? `${item.kind}:${item.projectId}:${item.episodeId}`
          : `${item.kind}:${item.projectId}`
        return existingKey === key
      })
      const hasIncomingData = 'data' in change && change.data !== undefined
      const hasExistingData = existingIndex >= 0 && 'data' in deduped[existingIndex] && deduped[existingIndex].data !== undefined
      if (existingIndex >= 0 && hasIncomingData && !hasExistingData) {
        deduped[existingIndex] = change
      }
      continue
    }
    seen.add(key)
    deduped.push(change)
  }
  return deduped
}

function isEditScreenplayRecord(value: unknown): value is ProjectEditScreenplay {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.id)
      && readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.screenplayText)
      && readString(value.status),
  )
}

function isEditScriptRecord(value: unknown): value is ProjectEditScript {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.id)
      && readString(value.projectId)
      && readString(value.episodeId)
      && Array.isArray(value.shots)
      && Array.isArray(value.videoBlocks),
  )
}

function isEditDirectorDecoupageRecord(value: unknown): value is ProjectEditDirectorDecoupage {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.id)
      && readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.screenplayId)
      && Array.isArray(value.shots),
  )
}

function isEditCinematographyShotPlanRecord(value: unknown): value is ProjectEditCinematographyShotPlan {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.id)
      && readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.editScriptId)
      && Array.isArray(value.shots),
  )
}

function readEditScriptChangePayload(value: unknown): ProjectEditScript | null {
  if (isEditScriptRecord(value)) return value
  if (!isRecord(value)) return null
  return isEditScriptRecord(value.editScript) ? value.editScript : null
}

function appendEditScriptChanges(
  changes: WorkspaceResourceChange[],
  data: ProjectEditScript,
): void {
  changes.push(
    ...editPipelineResourceChanges(data.projectId, data.episodeId),
    {
      kind: WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      projectId: data.projectId,
      episodeId: data.episodeId,
      data,
    },
    projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, data.projectId, data.episodeId),
  )
}

function readWriteResultData(value: unknown): unknown[] {
  if (!isRecord(value)) return []
  const candidates: unknown[] = []
  if (value.ok === true && 'data' in value) candidates.push(value.data)
  if (value.success === true && 'result' in value) candidates.push(value.result)
  if ('result' in value && isRecord(value.result)) {
    const nested = readWriteResultData(value.result)
    if (nested.length > 0) candidates.push(...nested)
  }
  return candidates.length > 0 ? candidates : [value]
}

export function extractWorkspaceResourceChangesFromWriteResult(params: {
  result: unknown
  projectId: string
  fallbackEpisodeId?: string | null
}): WorkspaceResourceChange[] {
  const changes: WorkspaceResourceChange[] = []
  for (const data of readWriteResultData(params.result)) {
    if (isEditScreenplayRecord(data)) {
      changes.push(
        ...editPipelineResourceChanges(data.projectId, data.episodeId),
      )
      changes.push({
        kind: WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY,
        projectId: data.projectId,
        episodeId: data.episodeId,
        data,
      })
      continue
    }
    if (isEditDirectorDecoupageRecord(data)) {
      changes.push(
        ...editPipelineResourceChanges(data.projectId, data.episodeId),
        {
          kind: WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE,
          projectId: data.projectId,
          episodeId: data.episodeId,
          data,
        },
      )
      continue
    }
    const editScript = readEditScriptChangePayload(data)
    if (editScript) {
      appendEditScriptChanges(changes, editScript)
      continue
    }
    if (isEditCinematographyShotPlanRecord(data)) {
      changes.push(
        ...editPipelineResourceChanges(data.projectId, data.episodeId),
        {
          kind: WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN,
          projectId: data.projectId,
          episodeId: data.episodeId,
          data,
        },
      )
    }
  }

  if (changes.length > 0) return dedupeResourceChanges(changes)
  const fallbackEpisodeId = params.fallbackEpisodeId?.trim()
  if (!fallbackEpisodeId) return []
  return []
}

export function extractWorkspaceResourceChangesFromTaskLifecycleEvent(params: {
  taskType: string | null
  lifecycleType: string | null
  projectId: string
  targetType: string | null
  targetId: string | null
  episodeId: string | null
  payload?: Record<string, unknown> | null
}): WorkspaceResourceChange[] {
  if (
    params.lifecycleType !== TASK_EVENT_TYPE.COMPLETED
    && params.lifecycleType !== TASK_EVENT_TYPE.FAILED
  ) {
    return []
  }

  const payload = readPayloadRecord(params.payload)
  const episodeId = readString(params.episodeId) ?? readString(payload?.episodeId)
  const taskType = normalizeTaskType(params.taskType)
  const targetType = readString(params.targetType)

  if (
    taskType === TASK_TYPE.EDIT_SCREENPLAY_GENERATE ||
    taskType === TASK_TYPE.EDIT_SCREENPLAY_REVISE ||
    taskType === TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE ||
    taskType === TASK_TYPE.EDIT_SCRIPT_GENERATE ||
    taskType === TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE
  ) {
    return episodeId ? editPipelineResourceChanges(params.projectId, episodeId) : []
  }

  if (
    taskType === TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE ||
    taskType === TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN ||
    taskType === TASK_TYPE.REGENERATE_STORYBOARD_TEXT ||
    taskType === TASK_TYPE.INSERT_PANEL ||
    taskType === TASK_TYPE.IMAGE_PANEL ||
    taskType === TASK_TYPE.PANEL_VARIANT
  ) {
    return episodeId ? storyboardResourceChanges(params.projectId, episodeId) : []
  }

  if (
    taskType === TASK_TYPE.VIDEO_PANEL ||
    taskType === TASK_TYPE.VIDEO_GROUP ||
    taskType === TASK_TYPE.FINAL_VIDEO_RENDER ||
    taskType === TASK_TYPE.BGM_SCORE_GENERATE
  ) {
    return episodeId ? mediaResourceChanges(params.projectId, episodeId) : []
  }

  if (isAssetTaskType(taskType) || isProjectAssetTargetType(targetType)) {
    return assetResourceChanges(params.projectId, episodeId)
  }

  return []
}

export function workspaceResourceChangeFromName(params: {
  kind: WorkspaceResourceName
  projectId: string
  episodeId: string | null
}): WorkspaceResourceChange | null {
  if (params.kind === WORKSPACE_RESOURCE_KIND.PROJECT_DATA) {
    return projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, params.projectId)
  }
  if (params.kind === WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS) {
    return projectScopedChange(WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, params.projectId, params.episodeId)
  }
  if (!params.episodeId) return null
  return episodeScopedChange(params.kind, params.projectId, params.episodeId)
}

export async function syncWorkspaceResourceChanges(params: {
  queryClient: QueryClient
  changes: readonly WorkspaceResourceChange[]
}) {
  const changes = dedupeResourceChanges(params.changes)
  const invalidations: Promise<unknown>[] = []
  const activeRefetchKeys = new Set<string>()

  const refetchActiveOnce = (queryKey: QueryKey) => {
    const key = JSON.stringify(queryKey)
    if (activeRefetchKeys.has(key)) return
    activeRefetchKeys.add(key)
    invalidations.push(params.queryClient.refetchQueries({
      queryKey,
      type: 'active',
    }))
  }

  for (const change of changes) {
    if (change.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY) {
      if (change.data !== undefined) {
        params.queryClient.setQueryData(
          queryKeys.project.editScreenplay(change.projectId, change.episodeId),
          change.data,
        )
      }
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.project.editScreenplay(change.projectId, change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE) {
      if (change.data !== undefined) {
        params.queryClient.setQueryData(
          queryKeys.project.editDirectorDecoupage(change.projectId, change.episodeId),
          change.data,
        )
      }
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.project.editDirectorDecoupage(change.projectId, change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT) {
      const queryKey = queryKeys.project.editScript(change.projectId, change.episodeId)
      if (change.data !== undefined) {
        params.queryClient.setQueryData(
          queryKey,
          change.data,
        )
      }
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey,
      }))
      refetchActiveOnce(queryKey)
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN) {
      if (change.data !== undefined) {
        params.queryClient.setQueryData(
          queryKeys.project.editCinematographyShotPlan(change.projectId, change.episodeId),
          change.data,
        )
      }
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.project.editCinematographyShotPlan(change.projectId, change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.STORYBOARDS) {
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.storyboards.all(change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.VIDEOS) {
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.videos.all(change.episodeId),
      }))
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.videos.panels(change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.EPISODE_DATA) {
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.episodeData(change.projectId, change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT) {
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.project.context(change.projectId, change.episodeId),
      }))
      continue
    }

    if (change.kind === WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS) {
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.assets.all('project', change.projectId),
      }))
      invalidations.push(params.queryClient.invalidateQueries({
        queryKey: queryKeys.projectAssets.all(change.projectId),
      }))
      if (change.episodeId) {
        const editScriptQueryKey = queryKeys.project.editScript(change.projectId, change.episodeId)
        invalidations.push(params.queryClient.invalidateQueries({
          queryKey: editScriptQueryKey,
        }))
        refetchActiveOnce(editScriptQueryKey)
      }
      continue
    }

    invalidations.push(params.queryClient.invalidateQueries({
      queryKey: queryKeys.projectData(change.projectId),
    }))
  }

  await Promise.all(invalidations)
}

export async function syncWorkspaceResourceChangesFromWriteResult(params: {
  queryClient: QueryClient
  result: unknown
  projectId: string
  fallbackEpisodeId?: string | null
}) {
  const changes = extractWorkspaceResourceChangesFromWriteResult({
    result: params.result,
    projectId: params.projectId,
    fallbackEpisodeId: params.fallbackEpisodeId,
  })
  if (changes.length === 0) return
  await syncWorkspaceResourceChanges({
    queryClient: params.queryClient,
    changes,
  })
}
