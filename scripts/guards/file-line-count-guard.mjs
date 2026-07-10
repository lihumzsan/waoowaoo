#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'scripts/guards/file-line-count-baseline.json')
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))

const RULES = [
  {
    label: 'component',
    dir: 'src',
    include: (relPath) =>
      relPath.includes('/components/')
      && /\.(ts|tsx)$/.test(relPath),
    limit: 500,
  },
  {
    label: 'hook',
    dir: 'src',
    include: (relPath) =>
      (relPath.includes('/hooks/') || /\/use[A-Z].+\.(ts|tsx)$/.test(relPath))
      && /\.(ts|tsx)$/.test(relPath),
    limit: 400,
  },
  {
    label: 'worker-handler',
    dir: 'src/lib/workers/handlers',
    include: (relPath) => /\.(ts|tsx)$/.test(relPath),
    limit: 300,
  },
  {
    label: 'mutation',
    dir: 'src/lib/query/mutations',
    include: (relPath) => /\.(ts|tsx)$/.test(relPath) && !relPath.endsWith('/index.ts'),
    limit: 300,
  },
]

const walkFiles = (absDir, relBase = '') => {
  if (!fs.existsSync(absDir)) return []
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name)
    const rel = path.join(relBase, entry.name).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, rel))
      continue
    }
    out.push({ absPath: abs, relPath: rel })
  }
  return out
}

const countLines = (absPath) => {
  const raw = fs.readFileSync(absPath, 'utf8')
  if (raw.length === 0) return 0
  return raw.split('\n').length
}

const overLimit = new Map()

for (const rule of RULES) {
  const absDir = path.join(ROOT, rule.dir)
  const files = walkFiles(absDir, rule.dir).filter((f) => rule.include(f.relPath))
  for (const file of files) {
    const lineCount = countLines(file.absPath)
    if (lineCount > rule.limit) {
      overLimit.set(file.relPath, {
        label: rule.label,
        relPath: file.relPath,
        lineCount,
        limit: rule.limit,
      })
    }
  }
}

const violations = []
for (const [relPath, violation] of overLimit) {
  const acceptedLineCount = baseline[relPath]
  if (typeof acceptedLineCount !== 'number') {
    violations.push({ ...violation, reason: 'new over-limit file' })
    continue
  }
  if (violation.lineCount > acceptedLineCount) {
    violations.push({
      ...violation,
      reason: `grew beyond baseline ${String(acceptedLineCount)}`,
    })
  }
}
for (const [relPath, acceptedLineCount] of Object.entries(baseline)) {
  const current = overLimit.get(relPath)
  if (!current || current.lineCount < acceptedLineCount) {
    violations.push({
      label: 'baseline',
      relPath,
      lineCount: current?.lineCount ?? 0,
      limit: acceptedLineCount,
      reason: 'baseline must be lowered or removed after improvement',
    })
  }
}

if (violations.length === 0) {
  process.stdout.write('[file-line-count-guard] PASS\n')
  process.exit(0)
}

process.stderr.write('[file-line-count-guard] FAIL: file size budget exceeded\n')
for (const violation of violations) {
  process.stderr.write(
    `- [${violation.label}] ${violation.relPath}: ${violation.lineCount} > ${violation.limit} (${violation.reason})\n`,
  )
}
process.exit(1)
