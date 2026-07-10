#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const scripts = packageJson.scripts ?? {}
const mandatoryRoots = ['test:guards', 'lint:all']
const reachableScripts = new Set()

function visitScript(name) {
  if (reachableScripts.has(name) || typeof scripts[name] !== 'string') return
  reachableScripts.add(name)
  for (const match of scripts[name].matchAll(/npm run ([\w:-]+)/g)) {
    visitScript(match[1])
  }
}

for (const rootScript of mandatoryRoots) visitScript(rootScript)

const guards = fs.readdirSync(path.join(root, 'scripts/guards'))
  .filter((name) => name.endsWith('.mjs') && !name.startsWith('_'))
  .sort()
const violations = []

for (const guard of guards) {
  const commandFragment = `scripts/guards/${guard}`
  const declaringScripts = Object.entries(scripts)
    .filter(([, command]) => typeof command === 'string' && command.includes(commandFragment))
    .map(([name]) => name)
  if (declaringScripts.length === 0) {
    violations.push(`${guard}: no package script declares this guard`)
    continue
  }
  if (!declaringScripts.some((name) => reachableScripts.has(name))) {
    violations.push(`${guard}: declared by ${declaringScripts.join(', ')} but unreachable from ${mandatoryRoots.join(' or ')}`)
  }
}

if (violations.length > 0) {
  process.stderr.write([
    '[mandatory-guard-mount] Guard files must be executable from a mandatory verification root.',
    'See docs/architecture/README.md and each module guardPaths declaration.',
    ...violations.map((violation) => `  - ${violation}`),
    '',
  ].join('\n'))
  process.exit(1)
}

process.stdout.write(`[mandatory-guard-mount] OK guards=${String(guards.length)}\n`)
