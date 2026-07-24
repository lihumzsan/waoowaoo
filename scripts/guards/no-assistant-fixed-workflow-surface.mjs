import fs from 'node:fs'
import path from 'node:path'

const roots = [
  'src/lib/command-center',
  'src/lib/operations',
  'src/lib/project-context',
  'src/lib/project-projection',
  'src/lib/project-agent/copy.ts',
  'src/lib/project-agent/runtime.ts',
  'src/lib/project-agent/session-state.ts',
  'src/lib/project-agent/types.ts',
  'src/lib/project-workflow',
  'src/lib/project-agent/router.ts',
  'src/lib/task/types.ts',
  'src/app/api',
  'src/features/project-workspace',
  'prisma/schema.prisma',
]

const banned = [
  'story-to-script',
  'create_workflow_plan',
  'approve_plan',
  'reject_plan',
  'run_workflow_package',
  'workflow_plan_template',
  'workflowType',
  'workflowVersion',
  'workflowId',
  'STORY_TO_SCRIPT_RUN',
  '/api/runs',
  'WORKFLOW.md',
  'WorkflowPackage',
  'WorkflowPackageId',
  'WorkflowPlanTemplate',
  'EditFirstWorkflowView',
  'resolveEditFirstWorkflowView',
  'resolveProjectPhase',
  'mainlineStep',
  'mainlineStatus',
  'mainlineRecommendedOperation',
  'request_script_intake_choice',
  'request_edit_script_review_choice',
  'request_story_canon_review_choice',
  'request_edit_style_choice',
  'request_edit_asset_review_choice',
  'confirmed_screenplay',
  'confirm_script_resource',
  'confirm_edit_style_preview',
  'generate_edit_style_previews',
  'generate_edit_style_preview_images',
  'ingest_script',
  'revise_script',
  'approve_script',
  'generate_bible_from_script',
  'revise_bible',
  'confirm_bible',
  'generate_edit_script',
  'replan_chapter',
  'generate_edit_shot_execution_plan',
  'generate_edit_script_assets',
  'approve_edit_script_assets',
  'revise_edit_script_assets',
  'generate_video_segments',
  'plan_episode_bgm_design',
  'generate_episode_bgm_score',
  'render_chapters',
  'render_final_video',
  'asset_hub_ai_design_',
  'asset_hub_ai_modify_',
]

const bannedPaths = [
  'skills/agent',
  'skills/project-workflow',
  'src/lib/agent-skills',
  'src/lib/operations/domains/agent-skill',
  'src/lib/saved-skills',
  'src/lib/skill-system',
  'src/lib/run-runtime',
  'src/lib/workflow-engine',
  'src/app/api/runs',
  'src/lib/project-workflow/edit-first-view.ts',
  'src/lib/project-workflow/edit-first.ts',
  'src/lib/project-workflow/edit-first-operation-ids.ts',
  'src/lib/project-agent/project-phase.ts',
  'src/lib/project-agent/edit-first-choice-tools.ts',
  'src/lib/project-agent/edit-first-choice-result.ts',
  'src/lib/project-agent/choice-card.ts',
  'src/lib/project-agent/script-intake.ts',
  'src/lib/operations/domains/media/edit-script-ops.ts',
  'src/lib/operations/domains/media/bible-ops.ts',
  'src/lib/operations/domains/asset-hub/asset-hub-llm-ops.ts',
  'src/lib/operations/domains/llm/llm-task-ops.ts',
  'src/lib/operations/domains/video-segments/index.ts',
  'src/lib/operations/domains/render/final-video/final-render-ops.ts',
  'src/lib/operations/domains/extra/extra-ops.ts',
]

export function inspectAssistantFixedWorkflowSurface(filePath, content) {
  return banned
    .filter((term) => content.includes(term))
    .map((term) => `${filePath} contains ${term}`)
}

export function inspectForbiddenFixedWorkflowPath(targetPath, exists) {
  if (!exists) return []
  return bannedPaths.includes(targetPath)
    ? [`${targetPath} must not exist`]
    : []
}

function walk(target) {
  const absolute = path.resolve(process.cwd(), target)
  if (!fs.existsSync(absolute)) return []
  const stat = fs.statSync(absolute)
  if (stat.isFile()) return [absolute]
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(absolute, entry.name)
    if (entry.isDirectory()) return walk(path.relative(process.cwd(), next))
    if (entry.isFile()) return [next]
    return []
  })
}

const violations = []
for (const targetPath of bannedPaths) {
  const absolute = path.resolve(process.cwd(), targetPath)
  violations.push(...inspectForbiddenFixedWorkflowPath(targetPath, fs.existsSync(absolute)))
}

for (const root of roots) {
  for (const filePath of walk(root)) {
    if (!/\.(ts|tsx|md)$/.test(filePath)) continue
    const content = fs.readFileSync(filePath, 'utf8')
    violations.push(...inspectAssistantFixedWorkflowSurface(path.relative(process.cwd(), filePath), content))
  }
}

if (violations.length > 0) {
  console.error([
    'AR-01A: fixed workflow references are forbidden in Assistant surfaces.',
    'See docs/architecture/modules/assistant-run-lifecycle.md#不变量.',
    ...violations,
  ].join('\n'))
  process.exit(1)
}

console.log('[no-assistant-fixed-workflow-surface] OK')
