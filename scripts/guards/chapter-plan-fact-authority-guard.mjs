#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/chapter-planning.md (CP-01..CP-09).

import fs from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
const violations = []

const operations = read('src/lib/operations/domains/assistant/creative-bible-ops.ts')
const service = read('src/lib/edit-bible/service.ts')
const materializer = read('src/lib/creative-resource/creative-work-materialization.ts')
const outputRegistry = read('src/lib/creative-worker/output-registry.ts')
const chapterContext = read('src/lib/edit-chapter/creative-context-service.ts')
const constraints = read('src/lib/edit-bible/constraints.ts')

for (const required of [
  "chapter_plan: creativeChapterPlanOutputSchema",
  "kind: 'chapter_plan'",
]) {
  if (!outputRegistry.includes(required)) violations.push(`Creative output registry missing: ${required}`)
}
for (const required of [
  'CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN',
  "output.kind === 'chapter_plan'",
]) {
  if (!materializer.includes(required)) violations.push(`Chapter plan Resource materialization missing: ${required}`)
}
if (!operations.includes('adopt_chapters:') || !operations.includes('adoptCreativeChapterPlan(')) {
  violations.push('exact chapter_plan adoption Operation is missing')
}
if (!operations.includes('choiceCommit: { enabled: true }')) {
  violations.push('Chapter adoption must remain eligible for one generic Choice current-decision commit')
}
for (const required of [
  'CREATIVE_CHAPTER_PLAN_SCREENPLAY_LINEAGE_REQUIRED',
  'CREATIVE_CHAPTER_PLAN_CONTEXT_LINEAGE_SCOPE_INVALID',
  'chapter.targetDurationSec > CREATIVE_CHAPTER_MAX_DURATION_SECONDS',
]) {
  if (!service.includes(required)) violations.push(`Chapter adoption validation missing: ${required}`)
}
if (!constraints.includes('CREATIVE_CHAPTER_MAX_DURATION_SECONDS = 180')) {
  violations.push('Chapter adoption must retain the 180-second local ceiling')
}
if (chapterContext.includes('CREATIVE_CONTEXT_BIBLE_INCOMPLETE')) {
  violations.push('Chapter context must not require a previously adopted Bible')
}
for (const forbidden of ['plan_chapters', 'splitEditBibleIntoChapterPlans', 'WorkerGroup', 'confirmed_screenplay', 'nextAction']) {
  if (operations.includes(forbidden) || service.includes(forbidden) || materializer.includes(forbidden)) {
    violations.push(`Chapter runtime restores forbidden workflow identity: ${forbidden}`)
  }
}
if (fs.existsSync(path.join(cwd, 'src/lib/edit-bible/chapter-split.ts'))) {
  violations.push('deterministic Chapter boundary splitter must remain deleted')
}

if (violations.length > 0) {
  console.error('[chapter-plan-fact-authority] violations detected')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('[chapter-plan-fact-authority] OK Skill-owned Chapter boundaries + exact adoption')
