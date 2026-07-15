import type { AppIconName } from '@/components/ui/icons'
import type { WorkspaceCanvasNodeAction } from '../node-canvas-types'

const WORKSPACE_NODE_ACTION_ICON_BY_TYPE = {
  ingest_script: 'arrowRight',
  generate_edit_script: 'arrowRight',
  generate_edit_shot_execution_plan: 'arrowRight',
  open_asset_library: 'arrowRight',
  update_edit_asset_requirement_description: 'arrowRight',
  generate_video_segments: 'video',
  render_final_video: 'film',
  plan_bgm_score: 'audioWave',
  generate_bgm_score: 'audioWave',
  generate_edit_assets: 'package',
  generate_edit_asset: 'package',
  regenerate_edit_asset_image: 'refresh',
} satisfies Record<WorkspaceCanvasNodeAction['type'], AppIconName>

export function nodeActionIconName(action: WorkspaceCanvasNodeAction): AppIconName {
  return WORKSPACE_NODE_ACTION_ICON_BY_TYPE[action.type]
}
