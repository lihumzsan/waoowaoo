#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()

function fail(title, details = []) {
  console.error(`\n[task-target-states-no-polling-guard] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

function readFile(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) {
    fail('Missing required file', [relativePath])
  }
  return fs.readFileSync(fullPath, 'utf8')
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function toRel(fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/')
}

function collectPattern(pattern) {
  const files = walk(path.join(root, 'src'))
  const hits = []
  for (const fullPath of files) {
    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) continue
    const text = fs.readFileSync(fullPath, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (pattern.test(lines[i])) {
        hits.push(`${toRel(fullPath)}:${i + 1}`)
      }
    }
  }
  return hits
}

const refetchIntervalMsHits = collectPattern(/\brefetchIntervalMs\b/)
if (refetchIntervalMsHits.length > 0) {
  fail('Found forbidden refetchIntervalMs usage', refetchIntervalMsHits)
}

const voiceStagePath =
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/VoiceStage.tsx'
const voiceStageText = readFile(voiceStagePath)
if (voiceStageText.includes('setInterval(')) {
  fail('VoiceStage must not use timer polling', [voiceStagePath])
}

const targetStateMapPath = 'src/lib/query/hooks/useTaskTargetStateMap.ts'
const targetStateMapText = readFile(targetStateMapPath)
const defaultPollingDisabledPattern =
  /\.\.\.\(\s*options\.activePollingInterval\s*===\s*undefined\s*\?\s*\{\s*refetchInterval:\s*false\b/
if (!defaultPollingDisabledPattern.test(targetStateMapText)) {
  fail('activePollingInterval must default to disabled', [targetStateMapPath])
}

const episodeCoverCardPath =
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard.tsx'
const activePollingHits = collectPattern(/\bactivePollingInterval\b/)
  .filter((hit) => !hit.startsWith(`${targetStateMapPath}:`))
const unexpectedActivePollingHits = activePollingHits
  .filter((hit) => !hit.startsWith(`${episodeCoverCardPath}:`))
if (unexpectedActivePollingHits.length > 0) {
  fail(
    'Only EpisodeCoverCard may opt in to active task-target polling',
    unexpectedActivePollingHits,
  )
}
const episodeCoverActivePollingHits = activePollingHits
  .filter((hit) => hit.startsWith(`${episodeCoverCardPath}:`))
if (episodeCoverActivePollingHits.length !== 1) {
  fail('EpisodeCoverCard must opt in exactly once', [
    `${episodeCoverCardPath}: found ${episodeCoverActivePollingHits.length}`,
  ])
}

const ssePath = 'src/lib/query/hooks/useSSE.ts'
const sseText = readFile(ssePath)
const targetStatesInvalidateExprMatch = sseText.match(
  /const shouldInvalidateTargetStates\s*=\s*([\s\S]*?)\n\s*\n/,
)
if (!targetStatesInvalidateExprMatch) {
  fail('Unable to locate shouldInvalidateTargetStates expression', [ssePath])
}
const targetStatesInvalidateExpr = targetStatesInvalidateExprMatch[1]
if (!/TASK_EVENT_TYPE\.COMPLETED/.test(targetStatesInvalidateExpr) || !/TASK_EVENT_TYPE\.FAILED/.test(targetStatesInvalidateExpr)) {
  fail('useSSE must invalidate target states only for terminal events', [ssePath])
}
if (/TASK_EVENT_TYPE\.CREATED/.test(targetStatesInvalidateExpr)) {
  fail('useSSE target-state invalidation must not include CREATED', [ssePath])
}
if (/TASK_EVENT_TYPE\.PROCESSING/.test(targetStatesInvalidateExpr)) {
  fail('useSSE target-state invalidation must not include PROCESSING', [ssePath])
}

console.log('[task-target-states-no-polling-guard] OK')
