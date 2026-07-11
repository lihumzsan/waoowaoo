import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

// Architecture contract: docs/architecture/modules/assistant-run-lifecycle.md (AR-01, AR-05, AR-06).

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const reducerPath = path.join(root, 'src/lib/project-agent/event/reducer.ts')
const runMaintenancePath = path.join(root, 'src/lib/project-agent/runs.ts')
const interruptionMaintenancePath = path.join(root, 'src/lib/project-agent/interruptions.ts')
const projectionModels = new Set([
  'projectAgentRun',
  'projectAgentActivity',
  'projectAgentInterruption',
  'projectAgentWait',
  'projectAgentContinuationCheckpoint',
  'projectAssistantThread',
])
const secondaryProjectionOwners = new Map([
  ['projectAgentWait', new Set([
    path.join(root, 'src/lib/project-agent/event/reducer.ts'),
    path.join(root, 'src/lib/project-agent/waits.ts'),
  ])],
  ['projectAgentContinuationCheckpoint', new Set([
    path.join(root, 'src/lib/project-agent/waits.ts'),
  ])],
  ['projectAssistantThread', new Set([
    path.join(root, 'src/lib/project-agent/persistence.ts'),
  ])],
])

function collectTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptFiles(absolutePath)
    return entry.isFile() && /\.tsx?$/.test(absolutePath) ? [absolutePath] : []
  })
}

function propertyName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function objectProperty(object, name) {
  return object.properties.find((property) => (
    ts.isPropertyAssignment(property) && propertyName(property.name) === name
  )) ?? null
}

function projectAgentProjectionMutation(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null
  const method = node.expression.name.text
  if (!['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(method)) return null
  const delegate = node.expression.expression
  const model = ts.isPropertyAccessExpression(delegate)
    ? delegate.name.text
    : ts.isElementAccessExpression(delegate)
      ? propertyName(delegate.argumentExpression)
      : null
  if (!model) return null
  if (!projectionModels.has(model)) return null
  return { method, model }
}

export function inspectProjectAgentProjectionWrites(filePath, sourceText) {
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
    const mutation = projectAgentProjectionMutation(node)
    if (mutation) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source))
      found.push(`${filePath}:${position.line + 1} (${mutation.model}.${mutation.method})`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const tablePattern = 'project_agent_(?:runs|activities|interruptions|waits|continuation_checkpoints)|project_assistant_threads'
  if (new RegExp(`\\b(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+[\u0060\"]?(?:${tablePattern})[\u0060\"]?`, 'i').test(sourceText)) {
    found.push(`${filePath}: raw SQL mutates an Assistant lifecycle projection table`)
  }
  return found
}

function mutationDataKeys(node) {
  const argument = node.arguments[0]
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null
  const dataProperty = objectProperty(argument, 'data')
  if (!dataProperty || !ts.isObjectLiteralExpression(dataProperty.initializer)) return null
  return dataProperty.initializer.properties.map((property) => propertyName(property.name)).filter(Boolean)
}

function isDeclaredMaintenanceMutation(filePath, node, mutation) {
  const secondaryOwners = secondaryProjectionOwners.get(mutation.model)
  if (secondaryOwners) return secondaryOwners.has(filePath)
  if (mutation.method !== 'updateMany') return false
  const keys = mutationDataKeys(node)
  if (!keys || keys.length !== 1) return false
  return (
    filePath === runMaintenancePath
    && mutation.model === 'projectAgentRun'
    && keys[0] === 'heartbeatAt'
  )
}

const violations = []
for (const filePath of collectTypeScriptFiles(sourceRoot)) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  if (filePath !== reducerPath) {
    violations.push(...inspectProjectAgentProjectionWrites(
      path.relative(root, filePath),
      sourceText,
    ).filter((violation) => violation.includes('raw SQL mutates')))
  }
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const visit = (node) => {
    const mutation = projectAgentProjectionMutation(node)
    if (
      filePath !== reducerPath
      && mutation
      && !isDeclaredMaintenanceMutation(filePath, node, mutation)
    ) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source))
      violations.push(`${path.relative(root, filePath)}:${position.line + 1} (${mutation.model}.${mutation.method})`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const sessionStatePath = path.join(root, 'src/lib/project-agent/session-state.ts')
const sessionStateSource = fs.readFileSync(sessionStatePath, 'utf8')
if (sessionStateSource.includes('cancelStaleRunningProjectAgentRunsForScope')) {
  violations.push('src/lib/project-agent/session-state.ts: GET projection must remain read-only')
}
if (
  sessionStateSource.includes('activeStylePreviewGeneration')
  || sessionStateSource.includes('generate_edit_style_previews')
) {
  violations.push('src/lib/project-agent/session-state.ts: Session projection must not contain operation-specific private lifecycle state')
}
for (const required of [
  'projectAgentRun.findMany',
  'PROJECT_AGENT_SESSION_ACTIVE_RUN_CONFLICT',
  'PROJECT_AGENT_SESSION_INTERRUPTION_RUN_MISMATCH',
  'PROJECT_AGENT_SESSION_WAIT_RUN_MISMATCH',
  'PROJECT_AGENT_SESSION_ACTIVITY_RUN_MISMATCH',
]) {
  if (!sessionStateSource.includes(required)) {
    violations.push(`src/lib/project-agent/session-state.ts: Session same-Run projection contract missing ${required}`)
  }
}

const assistantPanelPath = path.join(root, 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx')
const assistantPanelSource = fs.readFileSync(assistantPanelPath, 'utf8')
if (
  assistantPanelSource.includes('activeStylePreviewGeneration')
  || assistantPanelSource.includes('shouldDockWorkspaceStylePreviewGenerationCard')
  || assistantPanelSource.includes('shouldSuppressWorkspaceAssistantOperationRunCard')
) {
  violations.push('src/features/project-workspace/components/WorkspaceAssistantPanel.tsx: UI must project generic Run/Wait/Choice state without an operation-specific lifecycle')
}

const runtimeSource = fs.readFileSync(path.join(root, 'src/lib/project-agent/runtime.ts'), 'utf8')
if (
  runtimeSource.includes('updateProjectAgentRunStatus(')
  || runtimeSource.includes('reopenProjectAgentInterruption(')
  || !runtimeSource.includes('settleProjectAgentRunFailureWithMessage(')
) {
  violations.push('src/lib/project-agent/runtime.ts: user-visible failure must atomically settle message + Run and must not reopen a consumed decision')
}
const executionFenceIndex = runtimeSource.indexOf("kind: 'run.execution_started'")
const compressionModelIndex = runtimeSource.indexOf('await compressMessages')
const modelRunIndex = runtimeSource.indexOf('await run(agent, runInput')
if (
  executionFenceIndex < 0
  || compressionModelIndex < 0
  || modelRunIndex < 0
  || executionFenceIndex > compressionModelIndex
  || executionFenceIndex > modelRunIndex
) {
  violations.push('src/lib/project-agent/runtime.ts: execution-segment fence must precede compression and primary model execution')
}
for (const required of [
  'createProjectAgentExecutionSegment',
  'projectAgentExecutionStartedIdempotencyKey(executionSegment.id)',
  'executionSegmentId: executionSegment.id',
]) {
  if (!runtimeSource.includes(required)) {
    violations.push(`src/lib/project-agent/runtime.ts: execution segment authority missing ${required}`)
  }
}
const chatRouteSource = fs.readFileSync(
  path.join(root, 'src/app/api/projects/[projectId]/assistant/chat/route.ts'),
  'utf8',
)
if (
  chatRouteSource.includes('safelyUpdateProjectAgentRunStatus(')
  || !chatRouteSource.includes('settleProjectAgentRunFailureWithMessage(')
) {
  violations.push('Assistant chat route must use atomic message + Run failure settlement')
}
if (
  !chatRouteSource.includes('readRetryableConsumedProjectAgentApprovalInterruption')
  || !chatRouteSource.includes('readRetryableConsumedProjectAgentChoiceInterruption')
  || !chatRouteSource.includes('createProjectAgentConsumedControlRetryRun')
) {
  violations.push('Assistant chat route must preserve consumed decisions and create a distinct guarded retry Run')
}

function functionBody(source, functionName) {
  let body = null
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === functionName
      && node.body
    ) {
      body = node.body.getText(source)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!body) {
    violations.push(`${path.relative(root, source.fileName)}: required authority ${functionName} is missing`)
    return ''
  }
  return body
}

const reducerSourceText = fs.readFileSync(reducerPath, 'utf8')
const reducerSource = ts.createSourceFile(reducerPath, reducerSourceText, ts.ScriptTarget.Latest, true)
if (reducerSourceText.includes('projectAgentActivity.upsert')) {
  violations.push('src/lib/project-agent/event/reducer.ts: activity.started must remain create-only')
}
for (const functionName of ['completeActivity', 'failActivity', 'cancelActivity']) {
  const body = functionBody(reducerSource, functionName)
  if (!body.includes('transitionProjectAgentActivity')) {
    violations.push(`src/lib/project-agent/event/reducer.ts: ${functionName} must use the checked Activity transition authority`)
  }
}
const transitionBody = functionBody(reducerSource, 'transitionProjectAgentActivity')
if (!transitionBody.includes('transitioned.count !== 1')) {
  violations.push('src/lib/project-agent/event/reducer.ts: Activity terminal transitions must reject zero-row and raced writes')
}

const interruptionSourceText = fs.readFileSync(interruptionMaintenancePath, 'utf8')
if (
  interruptionSourceText.includes('reopenProjectAgentInterruption')
  || reducerSourceText.includes('interruption.reopened')
) {
  violations.push('Consumed Assistant decisions are immutable and must never be reopened')
}
const interruptionSource = ts.createSourceFile(
  interruptionMaintenancePath,
  interruptionSourceText,
  ts.ScriptTarget.Latest,
  true,
)
const replacementBody = functionBody(
  interruptionSource,
  'appendProjectAgentInterruptionReplacementInTransaction',
)
for (const requiredFragment of ['$queryRaw', 'projectAgentInterruption.findMany', 'appendProjectAgentEventsInTransaction']) {
  if (!replacementBody.includes(requiredFragment)) {
    violations.push(`src/lib/project-agent/interruptions.ts: atomic interruption replacement must retain ${requiredFragment}`)
  }
}
for (const functionName of [
  'createProjectAgentApprovalInterruption',
  'createProjectAgentChoiceInterruption',
]) {
  const body = functionBody(interruptionSource, functionName)
  if (
    !body.includes('prisma.$transaction')
    || !body.includes('appendProjectAgentInterruptionReplacementInTransaction')
  ) {
    violations.push(`src/lib/project-agent/interruptions.ts: ${functionName} must replace and raise under one transaction authority`)
  }
}

const runSourceText = fs.readFileSync(runMaintenancePath, 'utf8')
const runSource = ts.createSourceFile(runMaintenancePath, runSourceText, ts.ScriptTarget.Latest, true)
const retryRunBody = functionBody(runSource, 'createProjectAgentConsumedControlRetryRun')
for (const requiredFragment of [
  'FOR UPDATE',
  'projectAgentExecutionStartedIdempotencyKey(decisionSegment.id)',
  'projectAgentEvent.findUnique',
  'PROJECT_AGENT_CONTROL_EXECUTION_OUTCOME_UNKNOWN',
  'PROJECT_AGENT_CONTROL_FAILED',
  'appendProjectAgentEventsInTransaction',
]) {
  if (!retryRunBody.includes(requiredFragment)) {
    violations.push(`src/lib/project-agent/runs.ts: consumed-control retry authority must retain ${requiredFragment}`)
  }
}
for (const required of [
  'readProjectAgentDecisionInterruptionId(event.executionSegmentId)',
  'PROJECT_AGENT_APPROVAL_RUN_STATE_CLEAR_RACED',
  'data: { runState: null }',
]) {
  if (!reducerSourceText.includes(required)) {
    violations.push(`src/lib/project-agent/event/reducer.ts: execution-started approval cleanup missing ${required}`)
  }
}

if (violations.length > 0) {
  console.error('Project Agent Run state-machine guard failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Project Agent lifecycle projection single-writer guard passed.')
