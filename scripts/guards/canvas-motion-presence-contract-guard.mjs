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

function runCli() {
  const root = process.cwd()
  const source = fs.readFileSync(
    path.join(root, 'src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx'),
    'utf8',
  )
  const violations = inspectWorkspaceCanvasMotionPresenceContract(source)
  if (violations.length > 0) {
    console.error('[canvas-motion-presence] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[canvas-motion-presence] OK idempotent presence transition')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
