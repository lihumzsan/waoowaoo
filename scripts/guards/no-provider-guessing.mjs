#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const scanRoots = ['src/lib', 'src/app/api']
const allowModelRegistryUsage = new Set()

function fail(title, details = []) {
  console.error(`\n[no-provider-guessing] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
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

const runtimeConfigRelPath = 'src/lib/user-api/runtime-config.ts'
const runtimeConfigPath = path.join(root, runtimeConfigRelPath)
if (!fs.existsSync(runtimeConfigPath)) {
  fail(`Missing ${runtimeConfigRelPath}`)
}
const legacyRegistryPath = path.join(root, 'src/lib/model-registry.ts')
if (fs.existsSync(legacyRegistryPath)) {
  fail('Legacy runtime registry must be removed', ['src/lib/model-registry.ts'])
}
const runtimeConfigText = fs.readFileSync(runtimeConfigPath, 'utf8')

const forbiddenApiConfigTokens = [
  'includeAnyType',
  'crossTypeCandidates',
  'matches multiple providers across media types',
]
const apiViolations = forbiddenApiConfigTokens
  .filter((token) => runtimeConfigText.includes(token))
  .map((token) => `${runtimeConfigRelPath} contains forbidden provider-guessing token: ${token}`)

// 验证 runtime config 使用严格 provider.id 精确匹配（不按 type 过滤，不做 providerKey 模糊匹配）
if (!runtimeConfigText.includes('pickProviderStrict(')) {
  apiViolations.push(`${runtimeConfigRelPath} missing strict provider resolution function (pickProviderStrict)`)
}

const files = scanRoots.flatMap((scanRoot) => walk(path.join(root, scanRoot)))
const violations = [...apiViolations]

for (const fullPath of files) {
  const relPath = toRel(fullPath)
  const content = fs.readFileSync(fullPath, 'utf8')
  const lines = content.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (
      /from\s+['"]@\/lib\/model-registry['"]/.test(line)
      && !allowModelRegistryUsage.has(relPath)
    ) {
      violations.push(`${relPath}:${index + 1} forbidden model-registry import outside allowed boundary`)
    }

    if (
      (/\bgetModelRegistryEntry\s*\(/.test(line) || /\blistRegisteredModels\s*\(/.test(line))
      && !allowModelRegistryUsage.has(relPath)
    ) {
      violations.push(`${relPath}:${index + 1} forbidden model-registry runtime mapping usage`)
    }
  }
}

if (violations.length > 0) {
  fail('Found provider guessing / registry mapping violation', violations)
}

console.log('[no-provider-guessing] OK')
