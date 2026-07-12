#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const manifestPath = path.join(root, 'docs', 'architecture', 'modules.json')
const readmePath = path.join(root, 'docs', 'architecture', 'README.md')
const architectureRoot = path.join(root, 'docs', 'architecture')
const requiredSections = ['## 设计理念', '## 不变量', '## 权威入口', '## 验证', '## 历史回归', '## 修改检查表']

// Architecture contract: docs/architecture/modules/test-governance.md (TG-08, TG-09).

function fail(details) {
  process.stderr.write('[architecture-docs-contract] Architecture documentation contract failed.\n')
  for (const detail of details) process.stderr.write(`  - ${detail}\n`)
  process.stderr.write('  - See docs/architecture/README.md for the routing and maintenance contract.\n')
  process.exit(1)
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
  } catch (error) {
    fail([`cannot parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`])
  }
}

function isCanonicalRepoPath(value) {
  if (value !== value.trim()) return false
  if (path.isAbsolute(value)) return false
  if (value.includes('\\')) return false
  if (value.startsWith('./') || value.endsWith('/')) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return path.posix.normalize(value) === value
}

function findDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(entryPath))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

if (!fs.existsSync(manifestPath)) fail(['missing docs/architecture/modules.json'])
if (!fs.existsSync(readmePath)) fail(['missing docs/architecture/README.md'])

const manifest = readJson('docs/architecture/modules.json')
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail(['manifest must be an object'])
if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) fail(['manifest must declare at least one module'])

const readme = fs.readFileSync(readmePath, 'utf8')
const ids = new Set()
const errors = []

for (const filePath of collectFiles(path.join(architectureRoot, 'incidents'))) {
  errors.push(`permanent incident/process document is forbidden: ${path.relative(root, filePath)}`)
}
for (const entry of fs.readdirSync(architectureRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue
  errors.push(`architecture root process document must be migrated into a module: docs/architecture/${entry.name}`)
}

for (const architectureModule of manifest.modules) {
  if (!architectureModule || typeof architectureModule !== 'object' || Array.isArray(architectureModule)) {
    errors.push('module entry must be an object')
    continue
  }
  const { id, document, title, sourcePaths, testPaths, guardPaths } = architectureModule
  if (typeof id !== 'string' || !id.trim()) {
    errors.push('module id must be a non-empty string')
    continue
  }
  if (ids.has(id)) errors.push(`duplicate module id: ${id}`)
  ids.add(id)
  if (typeof document !== 'string' || !document.startsWith('docs/architecture/modules/')) {
    errors.push(`${id}: document must be under docs/architecture/modules/`)
    continue
  }
  if (typeof title !== 'string' || !title.trim()) errors.push(`${id}: title must be a non-empty string`)
  if (!fs.existsSync(path.join(root, document))) {
    errors.push(`${id}: missing document ${document}`)
    continue
  }
  const documentContent = fs.readFileSync(path.join(root, document), 'utf8')
  if (!documentContent.includes(`<!-- architecture-module: ${id} -->`)) {
    errors.push(`${id}: document must declare its architecture-module marker`)
  }
  for (const section of requiredSections) {
    if (!documentContent.includes(section)) errors.push(`${id}: missing required section ${section}`)
  }
  if (!readme.includes(`modules/${path.basename(document)}`)) {
    errors.push(`${id}: README must link ${document}`)
  }
  for (const [label, entries] of [['sourcePaths', sourcePaths], ['testPaths', testPaths], ['guardPaths', guardPaths]]) {
    if (!Array.isArray(entries) || entries.length === 0) {
      errors.push(`${id}: ${label} must be a non-empty array`)
      continue
    }
    for (const duplicate of findDuplicates(entries)) {
      errors.push(`${id}: ${label} contains duplicate path: ${duplicate}`)
    }
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.trim()) {
        errors.push(`${id}: ${label} contains an invalid path`)
      } else if (!isCanonicalRepoPath(entry)) {
        errors.push(`${id}: ${label} path must be canonical and repo-relative: ${entry}`)
      } else if (!fs.existsSync(path.join(root, entry))) {
        errors.push(`${id}: ${label} path does not exist: ${entry}`)
      } else if (label === 'guardPaths') {
        const guardContent = fs.readFileSync(path.join(root, entry), 'utf8')
        if (!guardContent.includes('docs/architecture/modules/')) {
          errors.push(`${id}: guard must link an architecture module: ${entry}`)
        }
      }
    }
  }
  if (Array.isArray(sourcePaths)) {
    for (const sourcePath of sourcePaths) {
      if (typeof sourcePath !== 'string') continue
      const coveringPath = sourcePaths.find((candidate) => (
        typeof candidate === 'string'
        && candidate !== sourcePath
        && sourcePath.startsWith(`${candidate}/`)
      ))
      if (coveringPath) {
        errors.push(`${id}: sourcePath ${sourcePath} is already covered by ${coveringPath}`)
      }
    }
  }
}

if (errors.length > 0) fail(errors)
process.stdout.write(`[architecture-docs-contract] OK modules=${manifest.modules.length}\n`)
