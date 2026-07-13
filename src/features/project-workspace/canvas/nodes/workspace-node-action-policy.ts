import type { AppIconName } from '@/components/ui/icons'
import type { WorkspaceCanvasNodeAction } from '../node-canvas-types'

const WORKSPACE_NODE_ACTION_ICON_BY_TYPE = {
  ingest_script: 'arrowRight',
  generate_edit_script: 'arrowRight',
  generate_edit_shot_execution_plan: 'arrowRight',
  open_asset_library: 'arrowRight',
  update_panel: 'arrowRight',
  delete_panel: 'arrowRight',
  copy_panel: 'arrowRight',
  generate_image: 'image',
  generate_video: 'video',
  update_video_prompt: 'arrowRight',
  update_edit_asset_requirement_description: 'arrowRight',
  update_panel_video_model: 'arrowRight',
  generate_all_videos: 'video',
  generate_video_group: 'video',
  generate_asset_reference_video: 'video',
  render_final_video: 'film',
  plan_bgm_score: 'audioWave',
  generate_bgm_score: 'audioWave',
  plan_soundscape: 'audioWave',
  generate_soundscape: 'audioWave',
  generate_edit_assets: 'package',
  generate_edit_asset: 'package',
  regenerate_edit_asset_image: 'refresh',
} satisfies Record<WorkspaceCanvasNodeAction['type'], AppIconName>

export function nodeActionIconName(action: WorkspaceCanvasNodeAction): AppIconName {
  return WORKSPACE_NODE_ACTION_ICON_BY_TYPE[action.type]
}
