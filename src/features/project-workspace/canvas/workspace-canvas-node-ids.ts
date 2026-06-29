export const workspaceNodeId = {
  analysis: (episodeId: string): string => `analysis:${episodeId}`,
  editScreenplay: (screenplayId: string): string => `edit-screenplay:${screenplayId}`,
  editStyleBible: (sourceId: string): string => `edit-style-bible:${sourceId}`,
  editProcessGroup: (episodeId: string): string => `edit-process:${episodeId}`,
  editScript: (episodeId: string): string => `edit-script:${episodeId}`,
  editAssetGroup: (editScriptId: string): string => `edit-asset-group:${editScriptId}`,
  editShotExecutionPlan: (editScriptId: string): string => `edit-shot-execution-plan:edit-script:${editScriptId}`,
  shot: (panelId: string): string => `shot:${panelId}`,
  storyboardPanelGeneration: (storyboardId: string): string => `storyboard-panel-generation:${storyboardId}`,
  imagePromptComposer: (editScriptId: string): string => `image-prompt-composer:${editScriptId}`,
  videoPromptComposer: (editScriptId: string): string => `video-prompt-composer:${editScriptId}`,
  videoPlan: (editScriptId: string, blockNumber: number): string => `video-plan:${editScriptId}:${blockNumber}`,
  bgmScore: (episodeId: string): string => `bgm-score:${episodeId}`,
  finalTimeline: (episodeId: string): string => `final:${episodeId}`,
} as const

export function workspaceEditShotExecutionPlanNodeId(editScriptId: string): string {
  return workspaceNodeId.editShotExecutionPlan(editScriptId)
}
