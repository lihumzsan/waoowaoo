#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/async-task-lifecycle.md (TL-10).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectEditBibleTaskOwnershipContract(input) {
  const violations = []
  for (const required of ['generationTaskId', '@@index([generationTaskId])']) {
    if (!input.schema.includes(required)) violations.push(`ProjectEditBible ownership schema missing: ${required}`)
  }
  for (const required of ['onTaskCreatedInTransaction', 'data: { generationTaskId: task.id }']) {
    if (!input.submission.includes(required)) violations.push(`edit bible submission ownership handoff missing: ${required}`)
  }
  for (const required of ['generationTaskId: input.taskId', "status: 'generating'"]) {
    if (!input.failureProjector.includes(required)) violations.push(`edit bible failure fence missing: ${required}`)
  }
  if (input.failureProjector.includes('ProjectEditBible currently has no task ownership field')) {
    violations.push('legacy unfenced ProjectEditBible failure skip must remain deleted')
  }
  for (const required of ['generationTaskId: input.taskId', 'readonly taskId: string']) {
    if (!input.successProjector.includes(required)) violations.push(`edit bible success fence missing: ${required}`)
  }
  for (const required of [
    'terminalSuccessHandoff',
    'terminalFailureProjector',
    'terminalCancelProjector',
  ]) {
    if (!input.taskDefinition.includes(required)) violations.push(`TaskDefinition terminal contract missing: ${required}`)
  }
  for (const required of [
    'projectTaskTargetTerminalInTransaction(tx,',
    'kind: intent.kind',
  ]) {
    if (!input.terminalService.includes(required)) violations.push(`terminal service registry projection missing: ${required}`)
  }
  for (const required of [
    'FOR UPDATE',
    'EDIT_BIBLE_GENERATION_OWNERSHIP_STALE',
    'EDIT_BIBLE_GENERATION_FINAL_CAS_FAILED',
  ]) {
    if (!input.successProjector.includes(required)) violations.push(`edit bible locked success transaction missing: ${required}`)
  }
  if (input.legacyParentSources.some((source) => source.includes('EDIT_STYLE_PREVIEWS_GENERATE') || source.includes('edit_style_previews_generate'))) {
    violations.push('retired style-preview parent Task protocol is still present')
  }
  for (const required of ['taskId: job.data.taskId', 'EDIT_STYLE_PREVIEW_TASK_OWNERSHIP_STALE']) {
    if (!input.stylePreviewWorker.includes(required)) violations.push(`style preview success fence missing: ${required}`)
  }
  for (const required of ['generationTaskId: job.data.taskId', 'VIDEO_SEGMENT_TASK_OWNERSHIP_STALE']) {
    if (!input.videoWorker.includes(required)) violations.push(`video segment success fence missing: ${required}`)
  }
  return violations
}

function runCli() {
  const cwd = process.cwd()
  const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
  const violations = inspectEditBibleTaskOwnershipContract({
    schema: read('prisma/schema.prisma'),
    submission: read('src/lib/edit-bible/task-submission.ts'),
    failureProjector: read('src/lib/task/target-failure-sync.ts'),
    successProjector: read('src/lib/edit-bible/service.ts'),
    taskDefinition: read('src/lib/task/definition.ts'),
    terminalService: read('src/lib/task/terminal/service.ts'),
    legacyParentSources: [
      read('src/lib/task/types.ts'),
      read('src/lib/workers/text.worker.ts'),
      read('src/lib/project-workflow/edit-first.ts'),
      read('src/features/project-workspace/canvas/projection/workspace-node-canvas-projection.ts'),
    ],
    stylePreviewWorker: read('src/lib/workers/handlers/edit-style-preview-image-task-handler.ts'),
    videoWorker: read('src/lib/workers/video.worker.ts'),
  })
  if (violations.length > 0) {
    console.error('[edit-bible-task-ownership] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[edit-bible-task-ownership] OK atomic ownership + fenced terminal projectors')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
