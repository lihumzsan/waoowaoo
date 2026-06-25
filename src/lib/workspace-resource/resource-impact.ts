import { TASK_EVENT_TYPE, TASK_TYPE, type WorkspaceResourceName, type WorkspaceResourceRef } from '@/lib/task/types'

type UnknownRecord = Record<string, unknown>

export const WORKSPACE_RESOURCE_KIND = {
  EDIT_SCREENPLAY: 'editScreenplay',
  EDIT_DIRECTOR_DECOUPAGE: 'editDirectorDecoupage',
  EDIT_SCRIPT: 'editScript',
  EDIT_CINEMATOGRAPHY_SHOT_PLAN: 'editCinematographyShotPlan',
  STORYBOARDS: 'storyboards',
  PROJECT_ASSETS: 'projectAssets',
  GLOBAL_ASSETS: 'globalAssets',
  VIDEOS: 'videos',
  EPISODE_DATA: 'episodeData',
  PROJECT_DATA: 'projectData',
  PROJECT_CONTEXT: 'projectContext',
} as const satisfies Record<string, WorkspaceResourceName>

const WORKSPACE_RESOURCE_NAMES = new Set<WorkspaceResourceName>(Object.values(WORKSPACE_RESOURCE_KIND))

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

export function isWorkspaceResourceName(value: string): value is WorkspaceResourceName {
  return WORKSPACE_RESOURCE_NAMES.has(value as WorkspaceResourceName)
}

function resourceRef(
  kind: WorkspaceResourceName,
  projectId: string,
  episodeId?: string | null,
): WorkspaceResourceRef {
  return episodeId === undefined
    ? { kind, projectId }
    : { kind, projectId, episodeId }
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

export function readWorkspaceResourceRefs(value: unknown): WorkspaceResourceRef[] {
  if (!Array.isArray(value)) return []
  const refs: WorkspaceResourceRef[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const kind = readString(item.kind)
    const projectId = readString(item.projectId)
    if (!kind || !projectId || !isWorkspaceResourceName(kind)) continue
    const hasEpisodeId = Object.prototype.hasOwnProperty.call(item, 'episodeId')
    const episodeId = readString(item.episodeId)
    refs.push(hasEpisodeId ? resourceRef(kind, projectId, episodeId) : resourceRef(kind, projectId))
  }
  return dedupeWorkspaceResourceRefs(refs)
}

function editPipelineRefs(projectId: string, episodeId: string): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.STORYBOARDS, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function editStylePreviewRefs(projectId: string, episodeId: string): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function storyboardRefs(projectId: string, episodeId: string): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.STORYBOARDS, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function mediaRefs(projectId: string, episodeId: string): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.VIDEOS, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.STORYBOARDS, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function musicRefs(projectId: string, episodeId: string): WorkspaceResourceRef[] {
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
          resourceRef(WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT, projectId, episodeId),
          resourceRef(WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId, episodeId),
          resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId, episodeId),
        ]
      : []),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function globalAssetRefs(projectId: string): WorkspaceResourceRef[] {
  return [
    resourceRef(WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS, projectId),
    resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId),
  ]
}

function isEditPipelineTaskType(taskType: string | null): boolean {
  return taskType === TASK_TYPE.EDIT_SCREENPLAY_GENERATE ||
    taskType === TASK_TYPE.EDIT_SCREENPLAY_REVISE ||
    taskType === TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE ||
    taskType === TASK_TYPE.EDIT_SCRIPT_GENERATE ||
    taskType === TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE
}

function isEditStylePreviewTaskType(taskType: string | null): boolean {
  return taskType === TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE ||
    taskType === TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE
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

function isGlobalAssetTaskType(taskType: string | null): boolean {
  return taskType === TASK_TYPE.ASSET_HUB_IMAGE ||
    taskType === TASK_TYPE.ASSET_HUB_MODIFY ||
    taskType === TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER ||
    taskType === TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION ||
    taskType === TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER ||
    taskType === TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION ||
    taskType === TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP ||
    taskType === TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER
}

function isStoryboardTaskType(taskType: string | null): boolean {
  return taskType === TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE ||
    taskType === TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN ||
    taskType === TASK_TYPE.INSERT_PANEL ||
    taskType === TASK_TYPE.IMAGE_PANEL ||
    taskType === TASK_TYPE.PANEL_VARIANT ||
    taskType === TASK_TYPE.REGENERATE_GROUP ||
    taskType === TASK_TYPE.AI_MODIFY_SHOT_PROMPT ||
    taskType === TASK_TYPE.ANALYZE_SHOT_VARIANTS
}

function isMediaTaskType(taskType: string | null): boolean {
  return taskType === TASK_TYPE.VIDEO_PANEL ||
    taskType === TASK_TYPE.VIDEO_GROUP ||
    taskType === TASK_TYPE.FINAL_VIDEO_RENDER ||
    taskType === TASK_TYPE.BGM_SCORE_GENERATE
}

function isStoryboardTargetType(targetType: string | null): boolean {
  return targetType === 'ProjectPanel' ||
    targetType === 'ProjectStoryboard'
}

function isProjectAssetTargetType(targetType: string | null): boolean {
  return targetType === 'CharacterAppearance' ||
    targetType === 'LocationImage' ||
    targetType === 'ProjectCharacter' ||
    targetType === 'ProjectLocation' ||
    targetType === 'ProjectAsset' ||
    targetType === 'ProjectProp'
}

function isGlobalAssetTargetType(targetType: string | null): boolean {
  return Boolean(targetType?.startsWith('GlobalCharacter') || targetType?.startsWith('GlobalLocation'))
}

function isMediaTargetType(targetType: string | null): boolean {
  return targetType === 'ProjectVideoGroup'
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

function isEditScreenplayRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.screenplayText)
      && readString(value.status),
  )
}

function isEditScriptRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && Array.isArray(value.shots)
      && Array.isArray(value.videoBlocks),
  )
}

function readEditScriptRecord(value: unknown): UnknownRecord | null {
  if (isEditScriptRecord(value)) return value
  if (!isRecord(value)) return null
  return isEditScriptRecord(value.editScript) ? value.editScript : null
}

function isEditDirectorDecoupageRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.screenplayId)
      && Array.isArray(value.shots),
  )
}

function isEditCinematographyShotPlanRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.editScriptId)
      && Array.isArray(value.shots),
  )
}

export function extractWorkspaceResourceRefsFromWriteResult(params: {
  result: unknown
  fallbackProjectId: string
  fallbackEpisodeId?: string | null
}): WorkspaceResourceRef[] {
  const refs: WorkspaceResourceRef[] = []
  for (const data of readWriteResultData(params.result)) {
    if (isEditScreenplayRecord(data) || isEditDirectorDecoupageRecord(data) || isEditCinematographyShotPlanRecord(data)) {
      const projectId = readString(data.projectId) ?? params.fallbackProjectId
      const episodeId = readString(data.episodeId)
      if (!episodeId) continue
      refs.push(...editPipelineRefs(projectId, episodeId))
      continue
    }
    const editScript = readEditScriptRecord(data)
    if (editScript) {
      const projectId = readString(editScript.projectId) ?? params.fallbackProjectId
      const episodeId = readString(editScript.episodeId)
      if (!episodeId) continue
      refs.push(
        ...editPipelineRefs(projectId, episodeId),
        resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, projectId, episodeId),
      )
    }
  }
  return dedupeWorkspaceResourceRefs(refs)
}

export function extractWorkspaceResourceRefsFromTaskLifecycleEvent(params: {
  taskType: string | null
  lifecycleType: string | null
  projectId: string
  targetType: string | null
  targetId: string | null
  episodeId: string | null
  payload?: Record<string, unknown> | null
}): WorkspaceResourceRef[] {
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

  if (isGlobalAssetTaskType(taskType) || isGlobalAssetTargetType(targetType) || params.projectId === 'global-asset-hub') {
    return dedupeWorkspaceResourceRefs(globalAssetRefs(params.projectId))
  }

  if (isEditPipelineTaskType(taskType)) {
    return episodeId ? editPipelineRefs(params.projectId, episodeId) : []
  }

  if (isEditStylePreviewTaskType(taskType) || targetType === 'ProjectEditStylePreview') {
    return episodeId ? editStylePreviewRefs(params.projectId, episodeId) : []
  }

  if (isMediaTaskType(taskType) || isMediaTargetType(targetType)) {
    return episodeId ? mediaRefs(params.projectId, episodeId) : []
  }

  if (taskType === TASK_TYPE.MUSIC_GENERATE) {
    return episodeId ? musicRefs(params.projectId, episodeId) : []
  }

  if (isStoryboardTaskType(taskType) || isStoryboardTargetType(targetType)) {
    return episodeId ? storyboardRefs(params.projectId, episodeId) : []
  }

  if (isAssetTaskType(taskType) || isProjectAssetTargetType(targetType)) {
    return projectAssetRefs(params.projectId, episodeId)
  }

  if (targetType === 'ProjectEpisode') {
    return episodeId
      ? dedupeWorkspaceResourceRefs([
          ...editPipelineRefs(params.projectId, episodeId),
          ...projectAssetRefs(params.projectId, episodeId),
        ])
      : [
          resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, params.projectId, null),
          resourceRef(WORKSPACE_RESOURCE_KIND.PROJECT_DATA, params.projectId),
        ]
  }

  return []
}
