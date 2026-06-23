export const workspaceNodeId = {
  analysis: (episodeId: string): string => `analysis:${episodeId}`,
  editScreenplay: (screenplayId: string): string => `edit-screenplay:${screenplayId}`,
  editStyleBible: (sourceId: string): string => `edit-style-bible:${sourceId}`,
  editDirectorDecoupage: (screenplayId: string): string => `edit-director-decoupage:screenplay:${screenplayId}`,
  editProcessGroup: (episodeId: string): string => `edit-process:${episodeId}`,
  editScript: (episodeId: string): string => `edit-script:${episodeId}`,
  editAssetGroup: (editScriptId: string): string => `edit-asset-group:${editScriptId}`,
  editCinematographyShotPlan: (editScriptId: string): string => `edit-cinematography-shot-plan:edit-script:${editScriptId}`,
  clip: (clipId: string): string => `clip:${clipId}`,
  shot: (panelId: string): string => `shot:${panelId}`,
  spaceConsistency: (storyboardId: string): string => `space-consistency:${storyboardId}`,
  pendingSpaceConsistencyForEditScript: (editScriptId: string): string => `space-consistency:edit-script:${editScriptId}`,
  videoPlan: (editScriptId: string, blockNumber: number): string => `video-plan:${editScriptId}:${blockNumber}`,
  bgmScore: (episodeId: string): string => `bgm-score:${episodeId}`,
  finalTimeline: (episodeId: string): string => `final:${episodeId}`,
} as const

export function workspaceEditDirectorDecoupageNodeId(screenplayId: string): string {
  return workspaceNodeId.editDirectorDecoupage(screenplayId)
}

export function workspaceEditCinematographyShotPlanNodeId(editScriptId: string): string {
  return workspaceNodeId.editCinematographyShotPlan(editScriptId)
}
