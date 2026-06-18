export function workspaceEditDirectorDecoupageNodeId(screenplayId: string): string {
  return `edit-director-decoupage:screenplay:${screenplayId}`
}

export function workspaceEditCinematographyShotPlanNodeId(editScriptId: string): string {
  return `edit-cinematography-shot-plan:edit-script:${editScriptId}`
}
