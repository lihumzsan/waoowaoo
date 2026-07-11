#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/canvas-node.md (CN-08).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectTerminalResourceRefetchContract(input) {
  const violations = []
  for (const [label, source] of [
    ['schema', input.schema],
    ['task types', input.taskTypes],
    ['worker lifecycle', input.workerLifecycle],
    ['Terminal Service', input.terminalService],
    ['SSE sync', input.sseSync],
  ]) {
    for (const forbidden of ['resourceRevision', 'materializedResources']) {
      if (source.includes(forbidden)) violations.push(`${label} restores removed terminal resource protocol: ${forbidden}`)
    }
  }
  if (!input.checkpoint.includes("state: 'ready'")) {
    violations.push('handler checkpoint must become ready immediately after the persisted handler result')
  }
  if (input.checkpoint.includes("state: 'executed'") || input.checkpoint.includes('finalizeTaskHandlerCheckpoint')) {
    violations.push('handler checkpoint must not restore the materialization-only executed/finalize stage')
  }
  for (const required of ['readWorkspaceResourceRefs', 'syncWorkspaceResourceChanges', 'affectedResources']) {
    if (!input.sseSync.includes(required)) violations.push(`terminal SSE refetch path is missing ${required}`)
  }
  if (input.sseSync.includes('setQueryData(')) {
    violations.push('terminal SSE must not write business Query data directly')
  }
  for (const required of ['invalidateQueries', 'refetchQueries', "type: 'active'"]) {
    if (!input.resourceSync.includes(required)) violations.push(`resource sync is missing ${required}`)
  }
  if (!input.packageJson.includes('"db:push": "prisma db push --skip-generate"')) {
    violations.push('database setup must be the single Prisma db push command')
  }
  if (input.packageJson.includes('db:prepare') || input.packageJson.includes('install-resource-revision-triggers')) {
    violations.push('database setup restores the removed trigger installation path')
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
  const removedPaths = [
    'scripts/install-resource-revision-triggers.ts',
    'src/lib/query/materialized-resource-cache.ts',
    'src/lib/workspace-resource/episode-resource-revision-contract.ts',
    'src/lib/workspace-resource/materialized-resource-version.ts',
    'src/lib/workspace-resource/materialized-resource.ts',
    'src/lib/workspace-resource/query-dto-version.ts',
    'src/lib/workspace-resource/resource-revision.ts',
    'prisma/migrations/20260711060000_add_episode_resource_revision/migration.sql',
  ]
  const violations = removedPaths
    .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
    .map((relativePath) => `removed resource-version path still exists: ${relativePath}`)
  violations.push(...inspectTerminalResourceRefetchContract({
    schema: read('prisma/schema.prisma'),
    taskTypes: read('src/lib/task/types.ts'),
    workerLifecycle: read('src/lib/workers/shared.ts'),
    terminalService: read('src/lib/task/terminal/service.ts'),
    checkpoint: read('src/lib/task/execution-checkpoint.ts'),
    sseSync: read('src/lib/query/workspace-sse-event-sync.ts'),
    resourceSync: read('src/lib/query/resource-change-sync.ts'),
    packageJson: read('package.json'),
  }))
  if (violations.length > 0) {
    console.error('[terminal-resource-refetch] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[terminal-resource-refetch] OK terminal notification + canonical Query refetch')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
