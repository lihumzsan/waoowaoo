#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const CORRECTIVE_SIGNALS = [
  ['fix', /(^|[^a-z])fix(?:ed|es)?([^a-z]|$)/i],
  ['bug', /(^|[^a-z])bugs?([^a-z]|$)/i],
  ['hotfix', /(^|[^a-z])hotfix([^a-z]|$)/i],
  ['regression', /(^|[^a-z])regression([^a-z]|$)/i],
  ['prevent', /(^|[^a-z])prevent(?:ed|s|ing)?([^a-z]|$)/i],
  ['restore', /(^|[^a-z])restore(?:d|s|ing)?([^a-z]|$)/i],
  ['recover', /(^|[^a-z])recover(?:ed|y|ies|ing)?([^a-z]|$)/i],
  ['guard', /(^|[^a-z])guard(?:ed|s|ing)?([^a-z]|$)/i],
  ['stabilize', /(^|[^a-z])stabili[sz]e(?:d|s|ing)?([^a-z]|$)/i],
  ['resolve', /(^|[^a-z])resolve(?:d|s|ing)?([^a-z]|$)/i],
  ['correct', /(^|[^a-z])correct(?:ed|s|ing)?([^a-z]|$)/i],
  ['修复', /修复/],
  ['修正', /修正/],
  ['错误', /错误/],
  ['故障', /故障/],
  ['回归', /回归/],
  ['防止', /防止/],
  ['恢复', /恢复/],
]

const TEST_LAYER_PREFIXES = [
  ['unit', 'tests/unit/'],
  ['integration-api', 'tests/integration/api/'],
  ['integration-provider', 'tests/integration/provider/'],
  ['integration-chain', 'tests/integration/chain/'],
  ['integration-task', 'tests/integration/task/'],
  ['system', 'tests/system/'],
  ['regression', 'tests/regression/'],
  ['contract', 'tests/contracts/'],
]

function fail(message) {
  throw new Error(`[test-history] ${message}`)
}

function parseArgs(argv) {
  const options = {
    days: 90,
    pretty: false,
    repo: process.cwd(),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pretty') {
      options.pretty = true
      continue
    }
    if (arg === '--days') {
      const value = argv[index + 1]
      if (!value) fail('--days requires a positive integer')
      const days = Number(value)
      if (!Number.isInteger(days) || days <= 0) fail(`Invalid --days value: ${value}`)
      options.days = days
      index += 1
      continue
    }
    if (arg === '--repo') {
      const value = argv[index + 1]
      if (!value) fail('--repo requires a path')
      options.repo = path.resolve(value)
      index += 1
      continue
    }
    fail(`Unknown argument: ${arg}`)
  }

  return options
}

function runGit(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    fail(`git ${args.join(' ')} failed in ${repo}: ${details}`)
  }
}

function readCommit(repo, commit) {
  const metadata = runGit(repo, ['show', '-s', '--format=%H%x1f%cI%x1f%s%x1f%B', commit])
  const [hash, committedAt, subject, ...bodyParts] = metadata.split('\u001f')
  if (!hash || !committedAt || !subject) fail(`Unable to parse metadata for ${commit}`)
  const message = `${subject}\n${bodyParts.join('\u001f')}`
  const matchedSignals = CORRECTIVE_SIGNALS
    .filter(([, pattern]) => pattern.test(message))
    .map(([signal]) => signal)
  const filesText = runGit(repo, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    commit,
  ])
  const files = filesText ? filesText.split('\n').filter(Boolean).sort() : []
  const testLayers = TEST_LAYER_PREFIXES
    .filter(([, prefix]) => files.some((file) => file.startsWith(prefix)))
    .map(([layer]) => layer)

  return {
    commit: hash,
    committedAt,
    subject,
    matchedSignals,
    files,
    testLayers,
  }
}

function buildHotspots(candidates, includeFile) {
  const entries = new Map()
  for (const candidate of candidates) {
    for (const file of candidate.files) {
      if (!includeFile(file)) continue
      const existing = entries.get(file) ?? []
      existing.push({
        commit: candidate.commit,
        committedAt: candidate.committedAt,
        subject: candidate.subject,
      })
      entries.set(file, existing)
    }
  }

  return [...entries.entries()]
    .map(([file, timeline]) => ({ file, count: timeline.length, timeline }))
    .sort((left, right) => right.count - left.count || left.file.localeCompare(right.file))
}

function buildReport(options) {
  runGit(options.repo, ['rev-parse', '--is-inside-work-tree'])
  const head = runGit(options.repo, ['rev-parse', 'HEAD'])
  const hashesText = runGit(options.repo, [
    'log',
    '--no-merges',
    `--since=${options.days}.days`,
    '--format=%H',
  ])
  const hashes = hashesText ? hashesText.split('\n').filter(Boolean) : []
  const commits = hashes.map((hash) => readCommit(options.repo, hash))
  const candidates = commits.filter((commit) => commit.matchedSignals.length > 0)
  const byLayer = Object.fromEntries(TEST_LAYER_PREFIXES.map(([layer]) => [
    layer,
    candidates.filter((candidate) => candidate.testLayers.includes(layer)).length,
  ]))

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repositoryHead: head,
    window: { days: options.days },
    summary: {
      scannedCommitCount: commits.length,
      candidateCommitCount: candidates.length,
      candidatesWithAnyTestChange: candidates.filter((candidate) => candidate.testLayers.length > 0).length,
      candidatesByTestLayer: byLayer,
    },
    candidates,
    productionHotspots: buildHotspots(
      candidates,
      (file) => file.startsWith('src/') || file.startsWith('prisma/') || file.startsWith('messages/'),
    ),
    testHotspots: buildHotspots(candidates, (file) => file.startsWith('tests/')),
  }
}

const options = parseArgs(process.argv.slice(2))
const report = buildReport(options)
process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`)
