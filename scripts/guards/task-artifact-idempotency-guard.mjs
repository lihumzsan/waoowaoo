#!/usr/bin/env node

// Architecture contracts:
// - docs/architecture/modules/async-task-lifecycle.md (TL-13)
// - docs/architecture/modules/provider-gateway.md (PG-06)

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'

const TASK_ARTIFACT_HELPERS = new Map([
  ['uploadImageSourceToCos', 3],
  ['uploadVideoSourceToCos', 4],
  ['uploadAudioSourceToCos', 3],
])

function hasTaskArtifactIdentity(value) {
  if (!value || !ts.isObjectLiteralExpression(value)) return false
  const names = new Set(value.properties.flatMap((entry) => {
    if (!ts.isPropertyAssignment(entry) && !ts.isShorthandPropertyAssignment(entry)) return []
    if (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) return [entry.name.text]
    return []
  }))
  return names.has('taskId') && names.has('artifact')
}

export function inspectTaskArtifactSource(input) {
  const violations = []
  const sourceFile = ts.createSourceFile(input.file, input.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let hasDirectUpload = false
  let hasStableBuilder = false
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      if (name === 'generateUniqueKey') {
        violations.push(`${input.file}:${line} Task artifact must not use a timestamp/random storage key`)
      }
      if (name === 'buildTaskArtifactStorageKey') hasStableBuilder = true
      if (name === 'uploadObject') hasDirectUpload = true
      const identityIndex = TASK_ARTIFACT_HELPERS.get(name)
      if (identityIndex !== undefined && !hasTaskArtifactIdentity(node.arguments[identityIndex])) {
        violations.push(`${input.file}:${line} ${name}(...) must declare taskId + artifact identity`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (hasDirectUpload && !hasStableBuilder) {
    violations.push(`${input.file} direct Task uploadObject(...) must use buildTaskArtifactStorageKey`)
  }
  return violations
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, output)
    else if (entry.name.endsWith('.ts')) output.push(full)
  }
  return output
}

function runCli() {
  const root = process.cwd()
  const violations = []
  for (const relativeRoot of ['src/lib/workers', 'src/lib/bgm-score', 'src/lib/ambient-sound']) {
    for (const file of walk(path.join(root, relativeRoot))) {
      const relative = path.relative(root, file).split(path.sep).join('/')
      violations.push(...inspectTaskArtifactSource({ file: relative, content: fs.readFileSync(file, 'utf8') }))
    }
  }
  if (violations.length > 0) {
    console.error('[task-artifact-idempotency] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[task-artifact-idempotency] OK stable task-owned storage artifacts')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
