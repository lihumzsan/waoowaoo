/**
 * The persisted relations whose mutations are included in the formal
 * `episodeData` / `editBible` aggregate snapshot. This is a semantic
 * aggregate boundary, not a list of every Prisma model that happens to have
 * an Episode relation. The migration owns the trigger SQL; CI compares every
 * declared relation here against its INSERT/UPDATE/DELETE trigger edges.
 */
export const EPISODE_RESOURCE_REVISION_CHILD_TABLES = [
  { table: 'project_episode_source_documents' },
  { table: 'project_edit_chapters' },
  { table: 'project_edit_bibles' },
  { table: 'project_edit_style_previews' },
  { table: 'project_edit_scripts' },
  { table: 'project_edit_shot_execution_plans' },
  { table: 'project_edit_asset_requirements' },
  { table: 'project_episode_final_outputs' },
  { table: 'project_edit_music_scores' },
  { table: 'project_edit_soundscapes' },
  { table: 'project_video_groups' },
  { table: 'project_storyboards' },
  { table: 'project_panels' },
] as const

export const PROJECT_EPISODE_RESOURCE_REVISION_TRIGGER_COUNT = 1
  + (EPISODE_RESOURCE_REVISION_CHILD_TABLES.length * 3)
