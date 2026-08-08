import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = process.cwd()
const sourceRoot = path.join(repositoryRoot, 'src')
const resourceWriter = path.join(sourceRoot, 'lib/workspace-resource/persistence.ts')
const revisionWriter = path.join(sourceRoot, 'lib/workspace-resource/projection-revision.ts')
const resourceMutationMethods = 'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany'
const resourceMutationPatterns = [
  new RegExp(`\\bworkspaceResource\\s*\\.\\s*(?:${resourceMutationMethods})\\s*\\(`, 'gu'),
  new RegExp(`\\[\\s*['\"]workspaceResource['\"]\\s*\\]\\s*\\.\\s*(?:${resourceMutationMethods})\\s*\\(`, 'gu'),
]
const revisionMutationPattern = /workspaceResourceRevision\s*:\s*\{\s*increment\s*:/gu
const rawResourceMutationPattern = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[`"]?workspace_resources\b/iu

function resourceMutationCount(source) {
  return resourceMutationPatterns.reduce(
    (count, pattern) => count + [...source.matchAll(pattern)].length,
    0,
  )
}

function listSourceFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolutePath))
      continue
    }
    if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(absolutePath)
  }
  return files
}

const violations = []
let ownedResourceMutations = 0
let ownedRevisionMutations = 0
for (const file of listSourceFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  const resourceMutations = resourceMutationCount(source)
  const revisionMutations = [...source.matchAll(revisionMutationPattern)]
  if (file === resourceWriter) ownedResourceMutations += resourceMutations
  else if (resourceMutations > 0) violations.push(`${path.relative(repositoryRoot, file)} writes WorkspaceResource directly`)
  if (rawResourceMutationPattern.test(source)) {
    violations.push(`${path.relative(repositoryRoot, file)} mutates workspace_resources through raw SQL`)
  }
  if (file === revisionWriter) ownedRevisionMutations += revisionMutations.length
  else if (revisionMutations.length > 0) violations.push(`${path.relative(repositoryRoot, file)} advances workspaceResourceRevision directly`)
}

if (ownedResourceMutations === 0) violations.push('WorkspaceResource persistence owner contains no resource mutation')
if (ownedRevisionMutations !== 1) violations.push(`workspaceResourceRevision must have exactly one writer, found ${String(ownedRevisionMutations)}`)

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`WorkspaceResource writer guard passed (${String(ownedResourceMutations)} owned mutations, one revision writer).\n`)
