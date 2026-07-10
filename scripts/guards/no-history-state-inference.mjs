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
if (/activeControlRun\s*\?\?\s*serverOperationRun/.test(runtime)) {
  violations.push(`${runtimePath} lets client control state override an existing server run`)
}
if (/setTimeout\([\s\S]{0,240}refreshSessionState/.test(runtime)) {
  violations.push(`${runtimePath} restores timer-driven session-state correctness polling`)
}

if (violations.length > 0) {
  console.error([
    'AR-01: server code must not infer agent continuation state from message history (use interruption/wait rows).',
    'See docs/architecture/modules/assistant-run-lifecycle.md#不变量.',
    ...violations,
  ].join('\n'))
  process.exit(1)
}
