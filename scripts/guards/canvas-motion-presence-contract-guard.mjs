#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/canvas-node.md (CN-12).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectWorkspaceCanvasMotionPresenceContract(source) {
  const violations = []
  for (const required of [
    'resolveWorkspaceCanvasMotionPresenceAction',
    'const presenceAction =',
    "presenceAction === 'show'",
    "presenceAction === 'hide'",
    "presenceAction !== 'schedule_exit'",
    'lastVisibleChildrenRef',
  ]) {
    if (!source.includes(required)) {
      violations.push(`motion presence is missing the shared transition contract: ${required}`)
    }
  }
  for (const forbidden of ['useState<ReactNode>', 'setCachedChildren']) {
    if (source.includes(forbidden)) {
      violations.push(`motion presence restores React children as state: ${forbidden}`)
    }
  }
  return violations
}

function readRuleBody(source, selector) {
  const marker = `${selector} {`
  const start = source.indexOf(marker)
  if (start < 0) return null
  const bodyStart = start + marker.length
  const bodyEnd = source.indexOf('}', bodyStart)
  return bodyEnd < 0 ? null : source.slice(bodyStart, bodyEnd)
}

export function inspectWorkspaceCanvasMotionPresenceStyles(source) {
  const violations = []
  const baseRule = readRuleBody(source, '.workspace-canvas-motion-presence')
  if (baseRule === null) {
    violations.push('motion presence CSS is missing its stable base rule')
  } else {
    for (const required of ['animation: none', 'opacity: 1', 'transform: none', 'will-change: auto']) {
      if (!baseRule.includes(required)) {
        violations.push(`settled motion presence must restore ordinary DOM rendering: ${required}`)
      }
    }
    if (baseRule.includes('will-change: grid-template-rows, opacity, transform')) {
      violations.push('settled motion presence permanently retains compositor hints')
    }
  }

  for (const selector of [
    '.workspace-canvas-motion-presence[data-workspace-canvas-motion-active="true"]',
    '.workspace-canvas-motion-presence[data-motion-state="entered"][data-workspace-canvas-motion-active="true"]',
    '.workspace-canvas-motion-presence[data-motion-state="exiting"][data-workspace-canvas-motion-active="true"]',
  ]) {
    if (readRuleBody(source, selector) === null) {
      violations.push(`motion CSS is not scoped to the explicit active window: ${selector}`)
    }
  }

  for (const forbidden of [
    '.workspace-canvas-motion-presence[data-motion-state="entered"] {',
    '.workspace-canvas-motion-presence[data-motion-state="exiting"] {',
  ]) {
    if (source.includes(forbidden)) {
      violations.push(`motion CSS restores an unbounded state animation: ${forbidden}`)
    }
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const source = fs.readFileSync(
    path.join(root, 'src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx'),
    'utf8',
  )
  const styles = fs.readFileSync(path.join(root, 'src/styles/animations.css'), 'utf8')
  const violations = [
    ...inspectWorkspaceCanvasMotionPresenceContract(source),
    ...inspectWorkspaceCanvasMotionPresenceStyles(styles),
  ]
  if (violations.length > 0) {
    console.error('[canvas-motion-presence] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[canvas-motion-presence] OK idempotent transition and settled compositor contract')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
