#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const manifestPath = path.join(root, 'docs', 'architecture', 'modules.json')
const readmePath = path.join(root, 'docs', 'architecture', 'README.md')
const requiredSections = ['## 设计理念', '## 不变量', '## 权威入口', '## 验证', '## 历史回归', '## 修改检查表']

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

if (!fs.existsSync(manifestPath)) fail(['missing docs/architecture/modules.json'])
if (!fs.existsSync(readmePath)) fail(['missing docs/architecture/README.md'])

const manifest = readJson('docs/architecture/modules.json')
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail(['manifest must be an object'])
if (manifest.schemaVersion !== 1) fail(['manifest schemaVersion must be 1'])
if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) fail(['manifest must declare at least one module'])

const readme = fs.readFileSync(readmePath, 'utf8')
const ids = new Set()
const errors = []

for (const module of manifest.modules) {
  if (!module || typeof module !== 'object' || Array.isArray(module)) {
    errors.push('module entry must be an object')
    continue
  }
  const { id, document, title, sourcePaths, testPaths, guardPaths } = module
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
  for (const [label, paths] of [['sourcePaths', sourcePaths], ['testPaths', testPaths], ['guardPaths', guardPaths]]) {
    if (!Array.isArray(paths) || paths.length === 0) {
      errors.push(`${id}: ${label} must be a non-empty array`)
      continue
    }
    for (const entry of paths) {
      if (typeof entry !== 'string' || !entry.trim()) {
        errors.push(`${id}: ${label} contains an invalid path`)
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
}

if (errors.length > 0) fail(errors)
process.stdout.write(`[architecture-docs-contract] OK modules=${manifest.modules.length}\n`)
