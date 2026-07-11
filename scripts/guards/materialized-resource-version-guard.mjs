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
const queryDtoVersion = read('src/lib/workspace-resource/query-dto-version.ts')
const episodeReader = read('src/lib/projects/read-episode-detail.ts')
const editBibleRoute = read('src/app/api/projects/[projectId]/bible/route.ts')
const resourceRevision = read('src/lib/workspace-resource/resource-revision.ts')
const revisionAggregateContract = read('src/lib/workspace-resource/episode-resource-revision-contract.ts')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260711060000_add_episode_resource_revision/migration.sql')
const installer = read('scripts/install-resource-revision-triggers.ts')
const packageJson = read('package.json')
const dockerCompose = read('docker-compose.yml')
const eventSync = read('src/lib/query/workspace-sse-event-sync.ts')
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
if (/resourceVersion\s*:\s*task\.taskId/.test(materializer)) {
  violations.push('taskId must never be used as a resourceVersion fallback')
}
for (const required of [
  'episode.resourceVersion',
  'CANVAS_TERMINAL_RESOURCE_VERSION_MISSING',
]) {
  if (!materializer.includes(required)) violations.push(`materializer is missing version contract: ${required}`)
}

for (const required of [
  "RESOURCE_REVISION: 'resource_revision'",
  'createWorkspaceResourceRevisionVersion',
  'compareWorkspaceMaterializedResourceVersions',
  'readWorkspaceMaterializedResourceVersionFromData',
]) {
  if (!versionContract.includes(required)) violations.push(`version contract is incomplete: ${required}`)
}

for (const required of [
  'createEpisodeDataQueryDto',
  'createEditBibleQueryDto',
  'createWorkspaceResourceRevisionVersion',
]) {
  if (!queryDtoVersion.includes(required)) violations.push(`formal Query DTO version constructor is incomplete: ${required}`)
}
if (!episodeReader.includes('createEpisodeDataQueryDto')) {
  violations.push('episode detail must construct its aggregate resourceVersion at the formal Query DTO boundary')
}
if (!editBibleRoute.includes('createEditBibleQueryDto')) {
  violations.push('edit Bible GET must construct its resourceVersion at the formal Query DTO boundary')
}
if (!/resourceRevision\s+Int\s+@default\(0\)/.test(schema)) {
  violations.push('ProjectEpisode must own the persisted resourceRevision')
}
if (!resourceRevision.includes('select: { resourceRevision: true }')) {
  violations.push('Query DTOs must read the persisted ProjectEpisode resourceRevision')
}
for (const required of [
  'readConsistentWorkspaceResourceSnapshot',
  'const before = await readWorkspaceResourceRevision(input)',
  'const data = await input.read()',
  'const after = await readWorkspaceResourceRevision(input)',
  'if (before === after)',
  'WORKSPACE_RESOURCE_SNAPSHOT_CHANGED_DURING_READ',
]) {
  if (!resourceRevision.includes(required)) {
    violations.push(`resource snapshot seqlock is incomplete: ${required}`)
  }
}
if (!episodeReader.includes('readConsistentWorkspaceResourceSnapshot')) {
  violations.push('episode detail must read its aggregate and resourceRevision through one seqlock boundary')
}
if (!editBibleRoute.includes('readConsistentWorkspaceResourceSnapshot')) {
  violations.push('edit Bible GET must read its aggregate and resourceRevision through one seqlock boundary')
}
const aggregateTables = [...revisionAggregateContract.matchAll(/table:\s*'([^']+)'/g)].map((match) => match[1])
if (aggregateTables.length === 0 || new Set(aggregateTables).size !== aggregateTables.length) {
  violations.push('episode resource revision aggregate contract must declare a non-empty unique table set')
}
for (const table of aggregateTables) {
  for (const edge of ['INSERT', 'UPDATE', 'DELETE']) {
    if (!migration.includes(`${edge} ON \`${table}\``)) {
      violations.push(`resource revision migration is missing ${table} ${edge} edge`)
    }
  }
}
if (migration.includes('CURRENT_TIMESTAMP') || migration.includes('updatedAt')) {
  violations.push('resource revision must not depend on timestamp ordering')
}
for (const required of [
  'RESOURCE_REVISION_TRIGGER_SET_PARTIAL',
  "outcome: 'already_installed'",
  "outcome: 'installed'",
]) {
  if (!installer.includes(required)) {
    violations.push(`resource revision trigger installer is incomplete: ${required}`)
  }
}
if (!packageJson.includes('prisma db push --skip-generate && tsx --env-file-if-exists=.env scripts/install-resource-revision-triggers.ts')) {
  violations.push('db:prepare must install resource revision triggers after Prisma schema sync')
}
if (!dockerCompose.includes('npm run db:prepare')) {
  violations.push('Docker startup must use db:prepare instead of bare prisma db push')
}
for (const required of [
  "materializedResult.outcome === 'missing'",
  "materializedResult.outcome === 'identity-conflict'",
  "normalizedLifecycleType === TASK_EVENT_TYPE.CANCELED",
]) {
  if (!eventSync.includes(required)) violations.push(`SSE terminal handoff outcome is incomplete: ${required}`)
}
if (/missingCompletedHandoff[\s\S]{0,160}applied\.length\s*===\s*0/.test(eventSync)) {
  violations.push('duplicate/stale materialized envelopes must not be treated as missing handoff')
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
