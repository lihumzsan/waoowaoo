#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/chapter-planning.md (CP-01..CP-03).

import fs from 'node:fs'
import path from 'node:path'

function count(source, token) {
  return source.split(token).length - 1
}

const cwd = process.cwd()
const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
const violations = []

const schemas = read('src/lib/edit-chapter/schemas.ts')
const service = read('src/lib/edit-script/service.ts')
const projector = read('src/lib/edit-chapter/persistent-facts.ts')

if (schemas.includes('persistentFactsIntroduced')) {
  violations.push('chapter plan model schema restores persistentFactsIntroduced')
}
if (!schemas.includes('}).strict()')) {
  violations.push('chapter plan model schema must remain strict')
}
if (count(service, 'persistentFactsIntroduced:') !== 1) {
  violations.push('chapter plan provenance must have exactly one persistentFactsIntroduced constructor')
}
if (!service.includes('persistentFactsIntroduced: projectChapterPersistentFacts(scriptSource.events)')) {
  violations.push('chapter plan provenance must use the canonical ledger event projector')
}
for (const required of [
  'for (const event of events)',
  'for (const fact of event.persistentFacts)',
  'facts.add(fact)',
]) {
  if (!projector.includes(required)) {
    violations.push(`chapter persistent fact projector missing: ${required}`)
  }
}
if (fs.existsSync(path.join(cwd, 'src/lib/edit-chapter/plan-validator.ts'))) {
  violations.push('retired natural-language chapter fact validator has been restored')
}

if (violations.length > 0) {
  console.error('[chapter-plan-fact-authority] violations detected')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('[chapter-plan-fact-authority] OK ledger-only persistent fact projection')
