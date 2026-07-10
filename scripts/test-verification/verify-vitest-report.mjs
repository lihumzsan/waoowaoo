#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function fail(message, details = []) {
  const suffix = details.length > 0 ? `\n${details.map((detail) => `  - ${detail}`).join('\n')}` : ''
  throw new Error(`[verify-vitest-report] ${message}${suffix}`)
}

function parseArgs(argv) {
  const options = {
    report: null,
    repo: process.cwd(),
    roots: [],
    suite: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--report') {
      if (!value) fail('--report requires a path')
      options.report = path.resolve(value)
      index += 1
      continue
    }
    if (arg === '--repo') {
      if (!value) fail('--repo requires a path')
      options.repo = path.resolve(value)
      index += 1
      continue
    }
    if (arg === '--root') {
      if (!value) fail('--root requires a repository-relative directory')
      options.roots.push(value.replaceAll('\\', '/').replace(/\/$/, ''))
      index += 1
      continue
    }
    if (arg === '--suite') {
      if (!value) fail('--suite requires a name')
      options.suite = value
      index += 1
      continue
    }
    fail(`Unknown argument: ${arg}`)
  }

  if (!options.report) fail('--report is required')
  if (!options.suite) fail('--suite is required')
  if (options.roots.length === 0) fail('At least one --root is required')
  return options
}

function walkTestFiles(directory, output = []) {
  if (!fs.existsSync(directory)) fail(`Required test root does not exist: ${directory}`)
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walkTestFiles(fullPath, output)
      continue
    }
    if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) {
      output.push(fullPath)
    }
  }
  return output
}

function readReport(reportPath) {
  if (!fs.existsSync(reportPath)) fail(`Vitest JSON report does not exist: ${reportPath}`)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    fail(`Unable to parse Vitest JSON report ${reportPath}: ${details}`)
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.testResults)) {
    fail(`Vitest JSON report has no testResults array: ${reportPath}`)
  }
  return parsed
}

function toRepoPath(repo, file) {
  const relative = path.relative(repo, path.resolve(file)).split(path.sep).join('/')
  if (relative.startsWith('../') || relative === '..') {
    fail(`Reported test file is outside repository: ${file}`)
  }
  return relative
}

function verifyReport(options) {
  const report = readReport(options.report)
  const expectedFiles = options.roots
    .flatMap((root) => walkTestFiles(path.resolve(options.repo, root)))
    .map((file) => toRepoPath(options.repo, file))
    .sort()
  const expected = new Set(expectedFiles)
  if (expected.size !== expectedFiles.length) fail('Required suite roots overlap and discover duplicate test files')

  const results = report.testResults
  const actualFiles = results.map((result) => toRepoPath(options.repo, result.name)).sort()
  const actual = new Set(actualFiles)
  const missing = expectedFiles.filter((file) => !actual.has(file))
  const unexpected = actualFiles.filter((file) => !expected.has(file))
  const duplicateFiles = actualFiles.filter((file, index) => actualFiles.indexOf(file) !== index)
  const skippedCases = results.flatMap((result) => (result.assertionResults ?? [])
    .filter((assertion) => assertion.status === 'pending' || assertion.status === 'todo' || assertion.status === 'skipped')
    .map((assertion) => `${toRepoPath(options.repo, result.name)} :: ${assertion.fullName ?? assertion.title ?? 'unnamed'}`))
  const nonPassingFiles = results
    .filter((result) => result.status !== 'passed')
    .map((result) => `${toRepoPath(options.repo, result.name)} (${String(result.status)})`)

  if (report.success !== true) fail(`Suite ${options.suite} report is not successful`)
  if (expectedFiles.length === 0) fail(`Suite ${options.suite} discovered zero expected test files`)
  if (missing.length > 0) fail(`Suite ${options.suite} did not collect every required test file`, missing)
  if (unexpected.length > 0) fail(`Suite ${options.suite} collected files outside its declared roots`, unexpected)
  if (duplicateFiles.length > 0) fail(`Suite ${options.suite} reported duplicate test files`, duplicateFiles)
  if (skippedCases.length > 0) fail(`Suite ${options.suite} contains skipped or todo cases`, skippedCases)
  if (nonPassingFiles.length > 0) fail(`Suite ${options.suite} contains non-passing test files`, nonPassingFiles)

  return {
    suite: options.suite,
    expectedFileCount: expectedFiles.length,
    executedFileCount: actualFiles.length,
    testCount: report.numTotalTests,
    skippedTestCount: report.numPendingTests + report.numTodoTests,
  }
}

const options = parseArgs(process.argv.slice(2))
const summary = verifyReport(options)
process.stdout.write(`[verify-vitest-report] OK ${JSON.stringify(summary)}\n`)
