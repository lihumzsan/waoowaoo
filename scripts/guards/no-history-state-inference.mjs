import fs from 'node:fs'
import path from 'node:path'

// Continuation state (pending approvals, choice responses, resume targets)
// lives in `project_agent_interruptions` / `project_agent_waits` rows with
// one-time consumption. Server code must never re-infer that state by
// scanning message history or message metadata. These identifiers are the
// legacy history-scanning protocol; they must not reappear server-side.

const roots = [
  'src/app/api',
  'src/lib/project-agent',
  'src/lib/operations',
  'src/lib/adapters',
  'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx',
  'src/features/project-workspace/components/workspace-assistant',
]

const banned = [
  'findLatestProjectAgentApprovalResponse',
  'findPendingAgentInterruption',
  'findRespondedAgentApprovalIds',
  'projectAgentApprovalResponse',
  'projectAgentChoiceResponse',
  'collectAssistantAsyncTaskSubmissions',
  'findLatestAssistantExternalTaskWait',
  'findActiveStylePreviewGenerationCard',
  'WORKSPACE_ASSISTANT_THREAD_CATCH_UP_DELAYS_MS',
  'shouldPollWorkspaceAssistantSessionState',
]

export function inspectHistoryStateInference(filePath, content) {
  return banned
    .filter((term) => content.includes(term))
    .map((term) => `${filePath} contains ${term}`)
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
for (const root of roots) {
  for (const filePath of walk(root)) {
    if (!/\.(ts|tsx)$/.test(filePath)) continue
    const content = fs.readFileSync(filePath, 'utf8')
    violations.push(...inspectHistoryStateInference(path.relative(process.cwd(), filePath), content))
  }
}

for (const retiredPath of [
  'src/features/project-workspace/components/workspace-assistant/async-task-follow-up.ts',
  'src/features/project-workspace/components/workspace-assistant/active-style-preview-generation.ts',
]) {
  if (fs.existsSync(path.resolve(process.cwd(), retiredPath))) {
    violations.push(`${retiredPath} restores retired message-history inference`)
  }
}

const runtimePath = 'src/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime.ts'
const runtime = fs.readFileSync(path.resolve(process.cwd(), runtimePath), 'utf8')
const interactionPath = 'src/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantInteraction.ts'
const interaction = fs.readFileSync(path.resolve(process.cwd(), interactionPath), 'utf8')
const runtimeStatePath = 'src/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state.ts'
const runtimeState = fs.readFileSync(path.resolve(process.cwd(), runtimeStatePath), 'utf8')
const renderersPath = 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'
const renderers = fs.readFileSync(path.resolve(process.cwd(), renderersPath), 'utf8')
const assistantRenderers = renderers
const controlPath = 'src/lib/project-agent/control.ts'
const control = fs.readFileSync(path.resolve(process.cwd(), controlPath), 'utf8')
const commandServicePath = 'src/lib/project-agent/command-service.ts'
const commandService = fs.readFileSync(path.resolve(process.cwd(), commandServicePath), 'utf8')
if (/activeControlRun\s*\?\?\s*serverOperationRun/.test(runtime)) {
  violations.push(`${runtimePath} lets client control state override an existing server run`)
}
if (/setTimeout\([\s\S]{0,240}refreshSessionState/.test(runtime)) {
  violations.push(`${runtimePath} restores timer-driven session-state correctness polling`)
}
// refreshSessionState 的全部调用点已搬到 interaction hook,该不变量必须跟着执行对象走。
if (/setTimeout\([\s\S]{0,240}refreshSessionState|setInterval\([\s\S]{0,240}refreshSessionState/.test(interaction)) {
  violations.push(`${interactionPath} restores timer-driven session-state correctness polling`)
}
if (!control.includes('createProjectAgentControlVisibleUserMessageId')) {
  violations.push(`${controlPath} is missing the canonical control visible-message identity authority`)
}
if (
  !interaction.includes('createWorkspaceAssistantControlVisibleUserMessage')
  || !runtimeState.includes('createProjectAgentControlVisibleUserMessageId({')
  || !commandService.includes('createProjectAgentControlVisibleUserMessageId(params.controlAction)')
) {
  violations.push('client optimistic and server persisted control messages do not share one canonical identity authority')
}
if (assistantRenderers.includes("'edit-style-preview-generation'")) {
  violations.push(`${renderersPath} restores the deleted historical style-generation message protocol`)
}
for (const marker of [
  'refetchInterval',
  'useTaskTargetStateMap',
  'data.items',
  "targetType: 'ProjectEditStylePreview'",
]) {
  if (assistantRenderers.includes(marker)) {
    violations.push(`${renderersPath} restores private style-preview lifecycle inference via ${JSON.stringify(marker)}`)
  }
}

if (violations.length > 0) {
  console.error([
    'AR-01: server code must not infer agent continuation state from message history (use interruption/wait rows).',
    'See docs/architecture/modules/assistant-run-lifecycle.md#不变量.',
    ...violations,
  ].join('\n'))
  process.exit(1)
}
