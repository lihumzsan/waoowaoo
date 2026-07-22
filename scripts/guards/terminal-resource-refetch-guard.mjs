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
  for (const required of ['requireWorkspaceResourceRefs', 'syncWorkspaceResourceChanges', 'affectedResources']) {
    if (!input.sseSync.includes(required)) violations.push(`terminal SSE refetch path is missing ${required}`)
  }
  if (input.sseSync.includes('setQueryData(')) {
    violations.push('terminal SSE must not write business Query data directly')
  }
  for (const required of ['terminalResourceImpact', 'satisfies Record<TaskType, TaskDefinition>']) {
    if (!input.taskDefinition.includes(required)) violations.push(`TaskDefinition resource contract is missing ${required}`)
  }
  for (const required of ['getTaskDefinition(taskType).terminalResourceImpact', 'resolveWorkspaceResourceRefs', 'affectedResources']) {
    if (!input.terminalService.includes(required)) violations.push(`Terminal Service explicit resource handoff is missing ${required}`)
  }
  for (const forbidden of [
    'extractWorkspaceResourceRefsFromTaskLifecycleEvent',
    'extractWorkspaceResourceRefsFromWriteResult',
    'isEditPipelineTaskType',
    'readWriteResultData',
  ]) {
    if (input.resourceImpact.includes(forbidden)) violations.push(`resource impact restores heuristic interpreter: ${forbidden}`)
  }
  for (const required of ['workspaceResourceImpact: WorkspaceResourceImpact', 'writes: true']) {
    if (!input.operationTypes.includes(required)) violations.push(`Operation write resource contract is missing ${required}`)
  }
  if (!input.operationInvocation.includes('impact: operation.effects.workspaceResourceImpact')) {
    violations.push('Operation invocation must resolve resource changes from the declared write effect')
  }
  for (const required of ['createWorkspaceResourceBroadcastsInTransaction', 'prisma.$transaction']) {
    if (!input.operationInvocation.includes(required)) violations.push(`Operation resource transaction is missing ${required}`)
  }
  for (const forbidden of ['publishWorkspaceResourceChangedEventsFromWriteResult', 'result: parsedOutput.data']) {
    if (input.operationInvocation.includes(forbidden)) violations.push(`Operation invocation restores output inference: ${forbidden}`)
  }
  if (input.canvas.includes('useTaskTargetTerminalInvalidation')) {
    violations.push('Canvas must not restore the competing target-state terminal resource observer')
  }
  if (input.mutationBatch.includes('hasMutationBatchModel')) {
    violations.push('MutationBatch must fail closed when its required persistence model is unavailable')
  }
  for (const required of ['invalidateQueries', "refetchType: 'active'"]) {
    if (!input.resourceSync.includes(required)) violations.push(`resource sync is missing ${required}`)
  }
  if (input.resourceSync.includes('refetchQueries')) {
    violations.push('resource sync must not duplicate active refetch after invalidateQueries')
  }
  for (const required of ['createOutboxCommandInTransaction', 'listWorkspaceResourceReplayEvents']) {
    if (!input.resourceEvents.includes(required)) violations.push(`resource event durability is missing ${required}`)
  }
  if (!input.outboxTypes.includes("WORKSPACE_RESOURCE_BROADCAST: 'workspace_resource.broadcast'")) {
    violations.push('Outbox resource broadcast protocol is missing')
  }
  if (!input.outboxWorker.includes('publishPersistedWorkspaceResourceEventByOutboxId')) {
    violations.push('Outbox worker resource delivery is missing')
  }
  for (const required of ['resourceEventAtMs', 'resourceOutboxId']) {
    if (!input.sseProtocol.includes(required)) violations.push(`SSE resource replay cursor is missing ${required}`)
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
    'src/lib/query/hooks/useTaskTargetTerminalInvalidation.ts',
    'src/features/project-workspace/components/assets/hooks/useBatchGeneration.helpers.ts',
    'src/features/project-workspace/components/assets/hooks/useBatchGeneration.ts',
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
    taskDefinition: read('src/lib/task/definition.ts'),
    resourceImpact: read('src/lib/workspace-resource/resource-impact.ts'),
    operationTypes: read('src/lib/operations/types.ts'),
    operationInvocation: read('src/lib/operations/invocation.ts'),
    resourceEvents: read('src/lib/workspace-resource/resource-change-events.ts'),
    outboxTypes: read('src/lib/outbox/types.ts'),
    outboxWorker: read('src/lib/workers/outbox.worker.ts'),
    sseProtocol: read('src/lib/sse/protocol.ts'),
    canvas: read('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx'),
    mutationBatch: read('src/lib/mutation-batch/service.ts'),
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
