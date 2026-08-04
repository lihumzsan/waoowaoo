#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  findArchitectureMatches,
  normalizeRepoPath,
  parseGitStatusPorcelainZ,
  uniquePaths,
} from './architecture-impact-lib.mjs'

const root = process.cwd()
const manifestPath = path.join(root, 'docs', 'architecture', 'modules.json')
const requestedArgs = process.argv.slice(2)
const GIT_STATUS_MAX_BUFFER_BYTES = 64 * 1024 * 1024

function usage() {
  process.stderr.write('Usage: npm run architecture:impact -- <file-or-directory> [...more paths]\n')
  process.stderr.write('   or: npm run architecture:impact -- --changed\n')
  process.stderr.write('See docs/architecture/README.md for the architecture module router.\n')
}

function readChangedPaths() {
  const raw = execFileSync(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: GIT_STATUS_MAX_BUFFER_BYTES,
    },
  )
  return parseGitStatusPorcelainZ(raw, root)
}

if (requestedArgs.length === 0) {
  usage()
  process.exit(1)
}

const changedMode = requestedArgs.includes('--changed')
if (changedMode && (requestedArgs.length !== 1 || requestedArgs[0] !== '--changed')) {
  process.stderr.write('The --changed mode cannot be combined with explicit paths.\n')
  usage()
  process.exit(1)
}
if (!changedMode && requestedArgs.some((argument) => argument.startsWith('--'))) {
  process.stderr.write(`Unknown option: ${requestedArgs.find((argument) => argument.startsWith('--'))}\n`)
  usage()
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const requestedPaths = changedMode
  ? readChangedPaths()
  : uniquePaths(requestedArgs.map((value) => normalizeRepoPath(value, root)).filter(Boolean))

if (requestedPaths.length === 0) {
  process.stdout.write('No changed paths found.\n')
  process.exit(0)
}

for (const requestedPath of requestedPaths) {
  process.stdout.write(`\n[path] ${requestedPath}\n`)
  const matches = findArchitectureMatches(requestedPath, manifest.modules, root)

  if (matches.length === 0) {
    process.stdout.write('  No architecture module matched.\n')
    process.stdout.write('  Classify this path using docs/architecture/README.md; add a mapping only for a real module boundary.\n')
    continue
  }

  for (const { architectureModule, sourcePaths } of matches) {
    process.stdout.write(`  [${architectureModule.id}] ${architectureModule.title}\n`)
    process.stdout.write('    Matched by:\n')
    for (const sourcePath of sourcePaths) process.stdout.write(`      - ${sourcePath}\n`)
    process.stdout.write(`    Read: ${architectureModule.document}\n`)
  }
}
