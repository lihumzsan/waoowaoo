#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/test-governance.md (TG-04).

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const RULES = [
  {
    name: 'api',
    source: /^src\/app\/api\//,
    tests: [/^tests\/integration\/api\/contract\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/app/api/** requires a matching contract, system, or regression test change',
  },
  {
    name: 'worker',
    source: /^src\/lib\/workers\//,
    tests: [/^tests\/unit\/worker\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/lib/workers/** requires a matching worker, system, or regression test change',
  },
  {
    name: 'task',
    source: /^src\/lib\/task\//,
    tests: [/^tests\/unit\/task\//, /^tests\/integration\/task\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/lib/task/** requires a matching task unit, task integration, system, or regression test change',
  },
  {
    name: 'media',
    source: /^src\/lib\/media\//,
    tests: [/^tests\/unit\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/lib/media/** requires a matching unit, system, or regression test change',
  },
  {
    name: 'provider',
    source: /^src\/lib\/(ai-providers|ai-registry|ai-exec)\//,
    tests: [/^tests\/unit\/(ai-providers|llm)\//, /^tests\/integration\/provider\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing provider/catalog code requires provider contract, system, or regression test change',
  },
]

function normalizeChangedFiles(rawFiles) {
  return rawFiles
    .flatMap((item) => item.split(/[\n,]/))
    .map((item) => item.trim())
    .filter(Boolean)
}

function readGitDiff(cwd, args, source) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return {
      files: normalizeChangedFiles([output]),
      source,
    }
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`[changed-file-test-impact-guard] Unable to read ${source}: ${details}`)
  }
}

function parseRangeArgs(argv) {
  let base = null
  let head = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--base') {
      if (!value) throw new Error('[changed-file-test-impact-guard] --base requires a Git commit')
      base = value
      index += 1
      continue
    }
    if (arg === '--head') {
      if (!value) throw new Error('[changed-file-test-impact-guard] --head requires a Git commit')
      head = value
      index += 1
      continue
    }
    throw new Error(`[changed-file-test-impact-guard] Unknown range argument: ${arg}`)
  }
  if (!base || !head) {
    throw new Error('[changed-file-test-impact-guard] Both --base and --head are required')
  }
  return { base, head }
}

/**
 * @param {{ argv?: string[], cwd?: string, env?: Record<string, string | undefined> }} [input]
 */
export function resolveChangedFiles({
  argv = [],
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (argv.includes('--staged')) {
    if (argv.length !== 1) {
      throw new Error('[changed-file-test-impact-guard] --staged cannot be combined with files or a Git range')
    }
    return readGitDiff(cwd, ['--cached'], 'staged diff')
  }

  if (argv.includes('--base') || argv.includes('--head')) {
    const { base, head } = parseRangeArgs(argv)
    return readGitDiff(cwd, [`${base}...${head}`], `Git range ${base}...${head}`)
  }

  if (argv.some((arg) => arg.startsWith('--'))) {
    throw new Error(`[changed-file-test-impact-guard] Unknown option: ${argv.find((arg) => arg.startsWith('--'))}`)
  }
  if (argv.length > 0) {
    return {
      files: normalizeChangedFiles(argv),
      source: 'explicit file arguments',
    }
  }

  const environmentFiles = normalizeChangedFiles([env.TEST_IMPACT_CHANGED_FILES || ''])
  if (environmentFiles.length > 0) {
    return {
      files: environmentFiles,
      source: 'TEST_IMPACT_CHANGED_FILES',
    }
  }

  if (env.CI === 'true') {
    const base = env.TEST_IMPACT_BASE_SHA
    const head = env.TEST_IMPACT_HEAD_SHA
    if (!base || !head) {
      throw new Error('[changed-file-test-impact-guard] CI requires TEST_IMPACT_BASE_SHA and TEST_IMPACT_HEAD_SHA')
    }
    return readGitDiff(cwd, [`${base}...${head}`], `CI Git range ${base}...${head}`)
  }

  return readGitDiff(cwd, ['--cached'], 'local staged diff')
}

export function inspectChangedFiles(changedFiles) {
  const changed = normalizeChangedFiles(changedFiles)
  const changedTests = changed.filter((file) => file.startsWith('tests/'))
  const violations = []

  for (const rule of RULES) {
    const impactedSources = changed.filter((file) => rule.source.test(file))
    if (impactedSources.length === 0) continue
    const hasMatchingTestChange = changedTests.some((file) => rule.tests.some((pattern) => pattern.test(file)))
    if (!hasMatchingTestChange) {
      violations.push(`${rule.name}: ${rule.message}; sources=${impactedSources.join(',')}`)
    }
  }

  return violations
}

function fail(violations) {
  console.error('\n[changed-file-test-impact-guard] Missing matching test changes')
  for (const violation of violations) {
    console.error(`  - ${violation}`)
  }
  process.exit(1)
}

function runCli() {
  const resolved = resolveChangedFiles({ argv: process.argv.slice(2) })
  const changedFiles = resolved.files

  const violations = inspectChangedFiles(changedFiles)
  if (violations.length > 0) {
    fail(violations)
  }

  console.log(`[changed-file-test-impact-guard] OK source=${resolved.source} files=${changedFiles.length}`)
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) {
  runCli()
}
