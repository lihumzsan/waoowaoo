#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const manifestPath = path.join(root, 'docs', 'architecture', 'modules.json')
const requestedPaths = process.argv.slice(2)

if (requestedPaths.length === 0) {
  process.stderr.write('Usage: npm run architecture:impact -- <file-or-directory> [...more paths]\n')
  process.stderr.write('See docs/architecture/README.md for the architecture module router.\n')
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const normalize = (value) => value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
const paths = requestedPaths.map(normalize)
const matched = manifest.modules.filter((module) => module.sourcePaths.some((sourcePath) => {
  const normalizedSource = normalize(sourcePath)
  return paths.some((requestedPath) => (
    requestedPath === normalizedSource
    || requestedPath.startsWith(`${normalizedSource}/`)
    || normalizedSource.startsWith(`${requestedPath}/`)
  ))
}))

if (matched.length === 0) {
  process.stdout.write('No architecture module matched the supplied paths.\n')
  process.stdout.write('Read docs/architecture/README.md and add a module mapping before introducing a new cross-cutting semantic boundary.\n')
  process.exit(0)
}

for (const architectureModule of matched) {
  process.stdout.write(`\n[${architectureModule.id}] ${architectureModule.title}\n`)
  process.stdout.write(`  Read: ${architectureModule.document}\n`)
  process.stdout.write('  Verify:\n')
  for (const testPath of architectureModule.testPaths) process.stdout.write(`    - ${testPath}\n`)
  for (const guardPath of architectureModule.guardPaths) process.stdout.write(`    - ${guardPath}\n`)
}
