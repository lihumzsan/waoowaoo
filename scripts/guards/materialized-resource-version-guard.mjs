import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Architecture contracts:
// - docs/architecture/modules/canvas-node.md (CN-08A)
// - docs/architecture/modules/async-task-lifecycle.md (TL-06D)

const root = process.cwd()

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const cache = read('src/lib/query/materialized-resource-cache.ts')
const materializer = read('src/lib/workspace-resource/materialized-resource.ts')
const versionContract = read('src/lib/workspace-resource/materialized-resource-version.ts')
const taskTypes = read('src/lib/task/types.ts')
const violations = []

if (cache.includes('setQueryData(queryKey, envelope.data)')) {
  violations.push('materialized cache must not restore unconditional envelope.data replacement')
}
for (const required of [
  'compareWorkspaceMaterializedResourceVersions',
  'readWorkspaceMaterializedResourceVersionFromData',
  "reason: order === 'same' ? 'duplicate' : 'stale'",
  'CANVAS_TERMINAL_RESOURCE_CURRENT_VERSION_INVALID',
]) {
  if (!cache.includes(required)) violations.push(`materialized cache is missing monotonic gate: ${required}`)
}

if (/resourceVersion\s*:\s*String\s*\(/.test(materializer)) {
  violations.push('materializer must use the typed revision version contract')
}
if (/resourceVersion[\s\S]{0,180}:\s*task\.taskId/.test(materializer)) {
  violations.push('taskId must never be used as a resourceVersion fallback')
}
for (const required of [
  'createWorkspaceRevisionVersion',
  'createWorkspaceUpdatedAtVersion',
  'CANVAS_TERMINAL_RESOURCE_VERSION_MISSING',
]) {
  if (!materializer.includes(required)) violations.push(`materializer is missing version contract: ${required}`)
}

for (const required of [
  "REVISION: 'revision'",
  "UPDATED_AT: 'updated_at'",
  'compareWorkspaceMaterializedResourceVersions',
  'readWorkspaceMaterializedResourceVersionFromData',
]) {
  if (!versionContract.includes(required)) violations.push(`version contract is incomplete: ${required}`)
}

if (/type WorkspaceMaterializedResourceEnvelope\s*=\s*\{[\s\S]*resourceVersion\s*:\s*string/.test(taskTypes)) {
  violations.push('task envelope must not weaken resourceVersion back to an untyped string')
}

if (violations.length > 0) {
  console.error('Materialized resource version guard failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Materialized resource version guard passed.')
