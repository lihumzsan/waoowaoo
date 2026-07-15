#!/usr/bin/env node

// Architecture contracts:
// - docs/architecture/modules/async-task-lifecycle.md (TL-13)
// - docs/architecture/modules/provider-gateway.md (PG-06)

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'

const MEDIA_CALLS = new Set(['generateImage', 'generateVideo', 'generateMusic'])

function property(object, name) {
  return object.properties.find((entry) => (
    ts.isPropertyAssignment(entry)
    && ((ts.isIdentifier(entry.name) && entry.name.text === name)
      || (ts.isStringLiteral(entry.name) && entry.name.text === name))
  ))
}

function isProviderSubmitPolicy(value, sourceFile) {
  return value?.getText(sourceFile) === 'RETRY_POLICY.providerSubmit'
}

function isPostMethod(value) {
  return value && ts.isStringLiteral(value) && value.text === 'POST'
}

function hasInvocationKey(value) {
  if (!value || !ts.isObjectLiteralExpression(value)) return false
  return Boolean(property(value, 'key'))
}

export function inspectProviderSubmissionSource(input) {
  const violations = []
  const sourceFile = ts.createSourceFile(
    input.file,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    input.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      const options = node.arguments[1]
      if (name === 'fetchWithRetry' && options && ts.isObjectLiteralExpression(options)) {
        const method = property(options, 'method')
        if (method && isPostMethod(method.initializer)) {
          const policy = property(options, 'policy')
          if (!policy || !isProviderSubmitPolicy(policy.initializer, sourceFile)) {
            violations.push(`${input.file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} provider POST must use RETRY_POLICY.providerSubmit`)
          }
        }
      }
      if (name === 'withRetry' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const retryOptions = node.arguments[0]
        const scope = property(retryOptions, 'scope')
        if (scope && scope.initializer.getText(sourceFile).includes('submit')) {
          const policy = property(retryOptions, 'policy')
          if (!policy || !isProviderSubmitPolicy(policy.initializer, sourceFile)) {
            violations.push(`${input.file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} provider submit retry wrapper must use RETRY_POLICY.providerSubmit`)
          }
        }
      }
      if (MEDIA_CALLS.has(name) && input.file !== 'src/lib/ai-exec/engine.ts') {
        if (node.arguments.length < 5 || !hasInvocationKey(node.arguments[4])) {
          violations.push(`${input.file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} task media call ${name}(...) must declare a stable provider invocation key`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

export function inspectTaskLlmInvocationIdentity(content) {
  const match = content.match(/function taskAiInvocationKey[\s\S]*?\n}\s*(?:\nasync|$)/)
  if (!match) return ['src/lib/ai-exec/engine.ts is missing taskAiInvocationKey']
  const keyFactory = match[0]
  const violations = []
  if (!keyFactory.includes('input.meta.stepIndex')) {
    violations.push('task LLM invocation key must include the stable step index')
  }
  if (/\$\{stepAttempt\}|meta\.stepAttempt/.test(keyFactory)) {
    violations.push('task LLM invocation key must not include transient stepAttempt metadata')
  }
  return violations
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.next-verify') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath, output)
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) output.push(fullPath)
  }
  return output
}

function runCli() {
  const root = process.cwd()
  const relative = (file) => path.relative(root, file).split(path.sep).join('/')
  const violations = []
  for (const file of walk(path.join(root, 'src'))) {
    const rel = relative(file)
    violations.push(...inspectProviderSubmissionSource({
      file: rel,
      content: fs.readFileSync(file, 'utf8'),
    }))
  }
  const engine = fs.readFileSync(path.join(root, 'src/lib/ai-exec/engine.ts'), 'utf8')
  const invocation = fs.readFileSync(path.join(root, 'src/lib/task/provider-invocation.ts'), 'utf8')
  for (const required of [
    'executeTaskDurableInvocation',
    'executeTaskProviderInvocation',
    'taskAiInvocationKey',
    "modality: 'llm'",
    "modality: 'vision'",
    'TASK_PROVIDER_INVOCATION_KEY_REQUIRED',
  ]) {
    if (!engine.includes(required)) violations.push(`src/lib/ai-exec/engine.ts missing ${required}`)
  }
  violations.push(...inspectTaskLlmInvocationIdentity(engine))
  const workerUtils = fs.readFileSync(path.join(root, 'src/lib/workers/utils.ts'), 'utf8')
  if (!workerUtils.includes("{ key: 'media:video:primary' }")) {
    violations.push('src/lib/workers/utils.ts must give the single Video Segment provider submission a stable invocation key')
  }
  for (const required of [
    'executeTaskDurableInvocation',
    "state: 'submitting'",
    "state: 'outcome_unknown'",
    "checkpoint.state === 'submitted'",
  ]) {
    if (!invocation.includes(required)) violations.push(`src/lib/task/provider-invocation.ts missing ${required}`)
  }
  const retryPolicy = fs.readFileSync(path.join(root, 'src/lib/retry/policy.ts'), 'utf8')
  for (const required of [
    'llm: { maxAttempts: 1',
    'llmStream: { maxAttempts: 1',
    'providerSubmit: { maxAttempts: 1',
  ]) {
    if (!retryPolicy.includes(required)) {
      violations.push(`src/lib/retry/policy.ts missing single-submit contract ${required}`)
    }
  }
  if (violations.length > 0) {
    console.error('[provider-submission-at-most-once] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[provider-submission-at-most-once] OK durable invocation fence + zero automatic provider POST retry')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
