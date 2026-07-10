#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const allowedProviderImportPrefixes = [
  'src/lib/ai-providers/',
  'src/lib/ai-exec/',
  'src/lib/ai-registry/',
]

function fail(title, details = []) {
  console.error(`\n[no-media-provider-bypass] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  console.error('  - See docs/architecture/modules/billing-approval.md#权威入口 and docs/architecture/modules/provider-gateway.md#权威入口.')
  process.exit(1)
}

function toRel(fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/')
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      out.push(fullPath)
    }
  }
  return out
}

const mediaEngineRelativePath = 'src/lib/ai-exec/engine.ts'
const mediaEnginePath = path.join(root, mediaEngineRelativePath)
if (!fs.existsSync(mediaEnginePath)) {
  fail(`Missing ${mediaEngineRelativePath}`)
}

const mediaEngineContent = fs.readFileSync(mediaEnginePath, 'utf8')
if (!/export\s+async\s+function\s+executeMediaGeneration\s*\(/.test(mediaEngineContent)) {
  fail('ai-exec media engine must expose executeMediaGeneration', [mediaEngineRelativePath])
}
if (!/resolveModelSelection\s*\(/.test(mediaEngineContent) || !/resolveAiProviderAdapter\s*\(/.test(mediaEngineContent)) {
  fail('ai-exec media engine must resolve the selected model and provider adapter', [
    `expected resolveModelSelection(...) and resolveAiProviderAdapter(...) in ${mediaEngineRelativePath}`,
  ])
}

const allFiles = walk(path.join(root, 'src'))
const violations = []

for (const fullPath of allFiles) {
  const relPath = toRel(fullPath)
  const content = fs.readFileSync(fullPath, 'utf8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (/\bcreateImageGeneratorByModel\s*\(/.test(line) || /\bcreateVideoGeneratorByModel\s*\(/.test(line)) {
      violations.push(`${relPath}:${i + 1} forbidden provider-bypass factory call create*GeneratorByModel(...)`)
    }

    if (/\bgetImageApiKey\s*\(/.test(line) || /\bgetVideoApiKey\s*\(/.test(line)) {
      violations.push(`${relPath}:${i + 1} forbidden direct getImageApiKey/getVideoApiKey usage outside api-config`)
    }

    if (/from\s+['"]@\/lib\/generators\/factory['"]/.test(line)) {
      violations.push(`${relPath}:${i + 1} forbidden direct import from '@/lib/generators/factory' (must go through ai-exec/engine)`)
    }

    if (
      /from\s+['"]@\/lib\/ai-providers\/(?:ark|fal|google|openrouter|elevenlabs)\//.test(line)
      && !allowedProviderImportPrefixes.some((prefix) => relPath.startsWith(prefix))
    ) {
      violations.push(`${relPath}:${i + 1} imports a provider implementation directly; use ai-exec/engine instead`)
    }
  }
}

if (violations.length > 0) {
  fail('Found media provider routing bypass', violations)
}

console.log('[no-media-provider-bypass] OK')
