import { TASK_TYPE, type TaskType } from './types'

export type TaskRuntimePhase = 'idle' | 'queued' | 'processing' | 'completed' | 'failed'

export type TaskRuntimeTarget = {
  readonly targetType: string
  readonly targetId: string
  readonly types?: readonly string[]
}

export type TaskRuntimeStateLike = {
  readonly targetType?: string | null
  readonly targetId?: string | null
  readonly phase: TaskRuntimePhase | string | null | undefined
  readonly runningTaskId?: string | null
  readonly runningTaskType?: string | null
  readonly progressGroupId?: string | null
  readonly progress?: number | null
  readonly stage?: string | null
  readonly stageLabel?: string | null
  readonly updatedAt?: string | null
  readonly lastError?: {
    readonly code?: string | null
    readonly message?: string | null
  } | null
}

export function taskTargetPairKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`
}

export function taskRuntimeTargetPairKey(target: TaskRuntimeTarget): string {
  return taskTargetPairKey(target.targetType, target.targetId)
}

export function taskRuntimeTargetQueryKey(target: TaskRuntimeTarget): string {
  const types = (target.types || []).filter(Boolean).slice().sort()
  return `${target.targetType}:${target.targetId}:${types.join(',')}`
}

export function isTaskRuntimeRunningPhase(
  phase: string | null | undefined,
): phase is 'queued' | 'processing' {
  return phase === 'queued' || phase === 'processing'
}

export function isTaskRuntimeStateRunning(
  state: TaskRuntimeStateLike | null | undefined,
): boolean {
  return isTaskRuntimeRunningPhase(state?.phase)
    && typeof state?.runningTaskId === 'string'
    && state.runningTaskId.trim().length > 0
}

export function taskRuntimeStateMapSignature(
  map: ReadonlyMap<string, TaskRuntimeStateLike>,
): string {
  return Array.from(map.entries())
    .map(([key, state]) => [
      key,
      state.phase ?? '',
      state.runningTaskId ?? '',
      state.runningTaskType ?? '',
      state.progressGroupId ?? '',
      state.lastError?.code ?? '',
      state.lastError?.message ?? '',
    ].join(':'))
    .sort()
    .join('|')
}

function target(
  targetType: string,
  targetId: string | null | undefined,
  types: readonly TaskType[],
): TaskRuntimeTarget | null {
  const normalizedTargetId = typeof targetId === 'string' ? targetId.trim() : ''
  if (!normalizedTargetId) return null
  return {
    targetType,
    targetId: normalizedTargetId,
    types,
  }
}

export const TASK_RUNTIME_TARGETS = {
  projectEpisodeEditScriptGeneration(episodeId: string | null | undefined) {
    return target('ProjectEpisode', episodeId, [TASK_TYPE.EDIT_SCRIPT_GENERATE])
  },
  projectEditChapterScriptGeneration(chapterId: string | null | undefined) {
    return target('ProjectEditChapter', chapterId, [TASK_TYPE.EDIT_SCRIPT_GENERATE])
  },
  projectEditSourceScript(bibleId: string | null | undefined) {
    return target('ProjectEditSourceScript', bibleId, [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE])
  },
  projectEditBible(bibleId: string | null | undefined) {
    return target('ProjectEditBible', bibleId, [TASK_TYPE.EDIT_BIBLE_GENERATE])
  },
  projectEditStylePreviews(bibleId: string | null | undefined) {
    return target('ProjectEditBible', bibleId, [TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE])
  },
  projectEditShotExecutionPlan(editScriptId: string | null | undefined) {
    return target('ProjectEditScript', editScriptId, [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE])
  },
  projectEditStylePreviewImage(stylePreviewId: string | null | undefined) {
    return target('ProjectEditStylePreview', stylePreviewId, [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE])
  },
  projectEpisodeFinalRender(episodeId: string | null | undefined) {
    return target('ProjectEpisode', episodeId, [TASK_TYPE.FINAL_VIDEO_RENDER])
  },
  projectEpisodeBgmScore(episodeId: string | null | undefined) {
    return target('ProjectEpisode', episodeId, [TASK_TYPE.MUSIC_SCORE_PLAN])
  },
  projectEpisodeSoundscape(episodeId: string | null | undefined) {
    return target('ProjectEpisode', episodeId, [
      TASK_TYPE.SOUNDSCAPE_PLAN,
      TASK_TYPE.SOUNDSCAPE_GENERATE,
    ])
  },
  projectEditChapterRender(chapterId: string | null | undefined) {
    return target('ProjectEditChapter', chapterId, [TASK_TYPE.CHAPTER_RENDER])
  },
  projectPanelImage(panelId: string | null | undefined) {
    return target('ProjectPanel', panelId, [TASK_TYPE.IMAGE_PANEL])
  },
  projectPanelImageOperations(panelId: string | null | undefined) {
    return target('ProjectPanel', panelId, [
      TASK_TYPE.IMAGE_PANEL,
      TASK_TYPE.MODIFY_ASSET_IMAGE,
    ])
  },
  projectEditAssetImage(
    targetType: 'CharacterAppearance' | 'LocationImage' | null | undefined,
    targetId: string | null | undefined,
  ) {
    if (targetType === 'CharacterAppearance') {
      return target('CharacterAppearance', targetId, [
        TASK_TYPE.IMAGE_CHARACTER,
        TASK_TYPE.MODIFY_ASSET_IMAGE,
      ])
    }
    if (targetType === 'LocationImage') {
      return target('LocationImage', targetId, [
        TASK_TYPE.IMAGE_LOCATION,
        TASK_TYPE.MODIFY_ASSET_IMAGE,
      ])
    }
    return null
  },
  projectPanelVideo(panelId: string | null | undefined) {
    return target('ProjectPanel', panelId, [TASK_TYPE.VIDEO_PANEL])
  },
  projectVideoGroup(groupId: string | null | undefined) {
    return target('ProjectVideoGroup', groupId, [TASK_TYPE.VIDEO_GROUP])
  },
} as const
