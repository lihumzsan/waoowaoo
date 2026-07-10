import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const allowedReadProjections = new Set([
  'src/instrumentation.ts',
  'src/lib/project-context/assembler.ts',
])
const assignmentPattern = /operationConfirmed\s*:\s*true\b/g

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return await listSourceFiles(fullPath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : []
  }))
  return nested.flat()
}

const violations = []
for (const filePath of await listSourceFiles(sourceRoot)) {
  const relativePath = path.relative(root, filePath).split(path.sep).join('/')
  const source = await readFile(filePath, 'utf8')
  for (const match of source.matchAll(assignmentPattern)) {
    if (allowedReadProjections.has(relativePath)) continue
    const index = match.index ?? 0
    const line = source.slice(0, index).split('\n').length
    violations.push(`${relativePath}:${line}`)
  }
}

if (violations.length > 0) {
  console.error([
    'BA-03: hardcoded operationConfirmed: true bypasses approval provenance.',
    'Propagate approval from the confirmed operation or approved plan; do not manufacture a boolean at the task boundary.',
    'See docs/architecture/modules/billing-approval.md#不变量.',
    ...violations.map((violation) => `- ${violation}`),
  ].join('\n'))
  process.exit(1)
}

console.log('No hardcoded operationConfirmed approval bypasses found.')
