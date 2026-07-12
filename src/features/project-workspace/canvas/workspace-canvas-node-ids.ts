export const workspaceNodeId = {
  editSourceScript: (episodeId: string): string => `edit-source-script:episode:${episodeId}`,
  editBible: (episodeId: string): string => `edit-bible:episode:${episodeId}`,
  editStyleBible: (sourceId: string): string => `edit-style-bible:${sourceId}`,
  editProcessGroup: (episodeId: string): string => `edit-process:${episodeId}`,
  editScript: (episodeId: string, chapterId?: string | null): string => `edit-script:${episodeId}:${chapterId?.trim() || 'episode'}`,
  editAssetGroup: (editScriptId: string): string => `edit-asset-group:${editScriptId}`,
  editShotExecutionPlan: (editScriptId: string): string => `edit-shot-execution-plan:edit-script:${editScriptId}`,
  shot: (panelId: string): string => `shot:${panelId}`,
  videoPlan: (editScriptId: string, blockNumber: number): string => `video-plan:${editScriptId}:${blockNumber}`,
  bgmScore: (episodeId: string): string => `bgm-score:${episodeId}`,
  soundscape: (episodeId: string): string => `soundscape:${episodeId}`,
  finalTimeline: (episodeId: string): string => `final:${episodeId}`,
} as const

export function workspaceEditShotExecutionPlanNodeId(editScriptId: string): string {
  return workspaceNodeId.editShotExecutionPlan(editScriptId)
}
