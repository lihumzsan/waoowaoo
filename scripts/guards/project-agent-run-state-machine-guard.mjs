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
  if (!ts.isPropertyAccessExpression(delegate)) return null
  const model = delegate.name.text
  if (!projectionModels.has(model)) return null
  return { method, model }
}

function mutationDataKeys(node) {
  const argument = node.arguments[0]
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null
  const dataProperty = objectProperty(argument, 'data')
  if (!dataProperty || !ts.isObjectLiteralExpression(dataProperty.initializer)) return null
  return dataProperty.initializer.properties.map((property) => propertyName(property.name)).filter(Boolean)
}

function isDeclaredMaintenanceMutation(filePath, node, mutation) {
  if (mutation.method !== 'updateMany') return false
  const keys = mutationDataKeys(node)
  if (!keys || keys.length !== 1) return false
  return (
    filePath === runMaintenancePath
    && mutation.model === 'projectAgentRun'
    && keys[0] === 'heartbeatAt'
  ) || (
    filePath === interruptionMaintenancePath
    && mutation.model === 'projectAgentInterruption'
    && keys[0] === 'runState'
  )
}

const violations = []
for (const filePath of collectTypeScriptFiles(sourceRoot)) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
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

if (violations.length > 0) {
  console.error('Project Agent Run state-machine guard failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Project Agent lifecycle projection single-writer guard passed.')
