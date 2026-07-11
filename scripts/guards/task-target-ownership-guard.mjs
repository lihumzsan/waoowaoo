#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/async-task-lifecycle.md (TL-02B).

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'

function readTerminalProjectors(source) {
  const result = new Map()
  const file = ts.createSourceFile('definition.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  function visit(node) {
    if (
      ts.isPropertyAssignment(node)
      && ts.isComputedPropertyName(node.name)
      && ts.isPropertyAccessExpression(node.name.expression)
      && ts.isIdentifier(node.name.expression.expression)
      && node.name.expression.expression.text === 'TASK_TYPE'
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'definition'
    ) {
      const failure = node.initializer.arguments[5]
      const cancel = node.initializer.arguments[6]
      if (failure && cancel && ts.isStringLiteral(failure) && ts.isStringLiteral(cancel)) {
        result.set(node.name.expression.name.text, { failure: failure.text, cancel: cancel.text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}

export function inspectTaskTargetOwnershipContract(input) {
  const violations = []
  for (const required of [
    'model ProjectEditScript {',
    'generationTaskId  String?',
    'model ProjectEditShotExecutionPlan {',
    'generationTaskId  String?',
  ]) {
    if (!input.schema.includes(required)) violations.push(`schema missing Task ownership contract: ${required}`)
  }
  const registeredProjectors = readTerminalProjectors(input.definitions)
  for (const [taskType, projector] of [
    ['MUSIC_SCORE_PLAN', 'music_score'],
    ['SOUNDSCAPE_PLAN', 'soundscape'],
    ['SOUNDSCAPE_GENERATE', 'soundscape'],
    ['EDIT_SCRIPT_GENERATE', 'edit_script'],
    ['EDIT_SHOT_EXECUTION_PLAN_GENERATE', 'edit_shot_execution_plan'],
  ]) {
    const registered = registeredProjectors.get(taskType)
    if (registered?.failure !== projector || registered.cancel !== projector) {
      violations.push(`TaskDefinition missing terminal projector: ${taskType} -> ${projector}`)
    }
  }
  for (const required of [
    'projectMusicScore',
    'projectSoundscape',
    'projectEditScript',
    'projectEditShotExecutionPlan',
    'generationTaskId: input.taskId',
    "'success_materialized'",
  ]) {
    if (!input.projectors.includes(required)) violations.push(`terminal projector registry missing: ${required}`)
  }
  if (input.projectors.includes('syncTaskTargetFailure')) {
    violations.push('target failure projector must not expose a Terminal Service bypass')
  }
  for (const required of [
    'generationTaskId: input.taskId',
    'EDIT_SCRIPT_TASK_OWNERSHIP_STALE',
    'EDIT_SHOT_EXECUTION_PLAN_TASK_OWNERSHIP_STALE',
  ]) {
    if (!input.editScriptService.includes(required))
      violations.push(`EditScript persistence missing owner fence: ${required}`)
  }
  if (input.editScriptService.includes('generationTaskId: null')) {
    violations.push('EditScript success must retain the terminal Task ownership watermark')
  }
  for (const [source, required, label] of [
    [input.videoWorker, 'readCompletedVideoGroupForTask', 'VideoGroup'],
    [input.stylePreviewWorker, "preview.status === 'completed'", 'StylePreview'],
    [input.editBibleWorker, 'alreadyPersisted', 'EditBible'],
    [input.chapterRender, "chapter.renderStatus === 'completed'", 'ChapterRender'],
    [input.finalRender, 'FINAL_VIDEO_RENDER_OUTPUT_MEDIA_MISSING', 'FinalRender'],
    [input.bgmWorker, 'readCompletedMusicScoreMix', 'MusicScore'],
    [input.soundscapeWorker, 'readCompletedSoundscapeMix', 'Soundscape'],
  ]) {
    if (!source.includes(required)) violations.push(`${label} success replay fence missing: ${required}`)
  }
  if (input.videoWorker.includes('taskId: null')) {
    violations.push('VideoGroup success must retain the terminal Task ownership watermark')
  }
  if (!input.terminalService.includes("reason: 'completion_pending'")) {
    violations.push('Terminal Service must preserve a formal resource success that won the terminal race')
  }
  for (const required of ['TASK_TERMINAL_BUNDLE_MISSING', 'task-lifecycle-broadcast:${event.id}']) {
    if (!input.terminalService.includes(required)) {
      violations.push(`Terminal Service idempotent replay must validate its durable bundle: ${required}`)
    }
  }
  if (!input.reconciler.includes('recoverMaterializedCompletion')) {
    violations.push('reconciler must resume the same Task after materialized success wins the terminal race')
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
  const violations = inspectTaskTargetOwnershipContract({
    schema: read('prisma/schema.prisma'),
    definitions: read('src/lib/task/definition.ts'),
    projectors: read('src/lib/task/target-failure-sync.ts'),
    editScriptService: read('src/lib/edit-script/service.ts'),
    videoWorker: read('src/lib/workers/video.worker.ts'),
    stylePreviewWorker: read('src/lib/workers/handlers/edit-style-preview-image-task-handler.ts'),
    editBibleWorker: read('src/lib/workers/handlers/edit-bible-generate.ts'),
    chapterRender: read('src/lib/workers/chapter-render.ts'),
    finalRender: read('src/lib/workers/final-video-render.ts'),
    bgmWorker: read('src/lib/bgm-score/generate.ts'),
    soundscapeWorker: read('src/lib/soundscape/generate.ts'),
    terminalService: read('src/lib/task/terminal/service.ts'),
    reconciler: read('src/lib/task/reconcile.ts'),
  })
  if (violations.length > 0) {
    console.error('[task-target-ownership] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[task-target-ownership] OK exhaustive terminal projectors + owner CAS')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
