import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { inspectWorkspaceCanvasMotionPresenceContract } from './canvas-motion-presence-contract-guard.mjs'

const root = process.cwd()
const canvasRoot = path.join(root, 'src/features/project-workspace/canvas')
const violations = []

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(filePath)
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [filePath] : []
  })
}

const nodeTypes = read('src/features/project-workspace/canvas/node-canvas-types.ts')
const nodeTypesSource = ts.createSourceFile('node-canvas-types.ts', nodeTypes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const guardedInterfaces = new Set(['WorkspaceCanvasNodeData', 'WorkspaceCanvasEditAssetGroupItem'])
for (const statement of nodeTypesSource.statements) {
  if (!ts.isInterfaceDeclaration(statement) || !guardedInterfaces.has(statement.name.text)) continue
  const fields = new Set(statement.members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || !member.name) return []
    return [member.name.getText(nodeTypesSource)]
  }))
  for (const field of ['artifactPhase', 'isRunning', 'statusLabel', 'taskProgress', 'streamPresentation']) {
    if (fields.has(field)) violations.push(`${statement.name.text} exposes legacy field ${field}`)
  }
  if (!fields.has('lifecycle')) violations.push(`${statement.name.text} must expose one required lifecycle object`)
}

const definitionRegistry = read('src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts')
if (!definitionRegistry.includes('satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodeDefinition>')) {
  violations.push('node definition registry is not exhaustive')
}
const fixtureRegistry = read('src/features/project-workspace/canvas/conformance/workspace-canvas-conformance-fixtures.ts')
if (!fixtureRegistry.includes('satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasConformanceFixture>')) {
  violations.push('conformance fixture registry is not exhaustive')
}
const rendererRegistry = read('src/features/project-workspace/canvas/nodes/workspace-node-renderer-registry.tsx')
if (!rendererRegistry.includes("satisfies Record<WorkspaceCanvasFlowNode['data']['kind'], WorkspaceCanvasNodeRenderer>")) {
  violations.push('renderer registry is not exhaustive')
}

const lifecycleCallAllowlist = new Set([
  'src/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle.ts',
  'src/features/project-workspace/canvas/lifecycle/workspace-canvas-resource-lifecycle.ts',
  'src/features/project-workspace/canvas/workspace-node-runtime.ts',
])

for (const absolutePath of walk(canvasRoot)) {
  const relativePath = path.relative(root, absolutePath)
  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const pattern of [
    /\.artifactPhase\b/,
    /\.taskProgress\b/,
    /\bdata\.isRunning\b/,
    /\bdata\.streamPresentation\b/,
    /\b__running\b/,
  ]) {
    if (pattern.test(content)) violations.push(`${relativePath} reads a legacy lifecycle field`)
  }

  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'resolveWorkspaceCanvasLifecycle'
      && !lifecycleCallAllowlist.has(relativePath)
    ) {
      violations.push(`${relativePath} constructs lifecycle outside the authoritative resolver boundary`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const canvasSurface = read('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')
if (/status\s*:\s*[^\n]*===\s*['"]generating['"][\s\S]{0,80}\?\s*['"]ready['"]/.test(canvasSurface)) {
  violations.push('ProjectWorkspaceCanvas rewrites persisted generating status to ready')
}
if (/activeAssistantOperationId\s*===\s*['"][^'"]+['"]/.test(canvasSurface)) {
  violations.push('ProjectWorkspaceCanvas uses operationId as a private pending lifecycle switch')
}

violations.push(...inspectWorkspaceCanvasMotionPresenceContract(
  read('src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx'),
))

const overlay = read('src/lib/query/task-target-overlay.ts')
const targetStateMap = read('src/lib/query/hooks/useTaskTargetStateMap.ts')
if (/TASK_TARGET_OVERLAY_TTL_MS|expiresAt/.test(overlay) || /runtime\.expiresAt/.test(targetStateMap)) {
  violations.push('optimistic Task overlay must be cleared by lifecycle edges, not TTL')
}

const structuredRuntime = read('src/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime.ts')
for (const required of ['streamRunId', 'stepAttempt', 'lastSeq', 'MAX_STREAM_ACCUMULATORS', 'MAX_TERMINAL_STREAM_RUNS']) {
  if (!structuredRuntime.includes(required)) violations.push(`structured runtime identity/bound is missing ${required}`)
}

const sseHook = read('src/lib/query/hooks/useSSE.ts')
const sseSequence = read('src/lib/query/workspace-sse-event-sequence.ts')
if (
  !sseHook.includes('WorkspaceSSEEventSequence')
  || !sseSequence.includes('MAX_TRACKED_SSE_EVENT_IDENTITIES')
  || !sseSequence.includes('MAX_TRACKED_SSE_TASK_WATERMARKS')
  || !sseSequence.includes('WorkspaceSSESnapshotResyncRequiredError')
  || !sseSequence.includes('event_identity_window_overflow')
  || !sseSequence.includes('task_watermark_window_overflow')
  || !sseHook.includes('requestSnapshotResync')
) {
  violations.push('SSE client event identity dedupe must be bounded and overflow into snapshot resync')
}

for (const rendererPath of walk(path.join(canvasRoot, 'nodes'))) {
  const relativePath = path.relative(root, rendererPath)
  const content = fs.readFileSync(rendererPath, 'utf8')
  if (/from ['"]@\/lib\/task\/(runtime-targets|state-service)/.test(content)) {
    violations.push(`${relativePath} reads Task runtime directly`)
  }
  if (/useWorkspaceStructuredStreamRuntime|workspace-node-runtime/.test(content)) {
    violations.push(`${relativePath} reads structured runtime directly`)
  }
}

if (violations.length > 0) {
  console.error([
    'CN-07/CN-08/CN-09/CN-12: Canvas lifecycle and renderer motion must have one resolver, exhaustive registries, and no recursive state writers.',
    'See docs/architecture/modules/canvas-node.md#不变量.',
    ...Array.from(new Set(violations)),
  ].join('\n'))
  process.exit(1)
}
