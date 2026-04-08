import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const schemaPath = resolve(repoRoot, 'prisma', 'schema.prisma')
const generatedClientPaths = [
  resolve(repoRoot, 'node_modules', '.prisma', 'client', 'index.js'),
  resolve(repoRoot, 'node_modules', '.prisma', 'client', 'index.d.ts'),
  resolve(repoRoot, 'node_modules', '@prisma', 'client', 'index.d.ts'),
]

function getNewestGeneratedMtimeMs() {
  const mtimes = generatedClientPaths
    .filter((candidatePath) => existsSync(candidatePath))
    .map((candidatePath) => statSync(candidatePath).mtimeMs)
  return mtimes.length > 0 ? Math.max(...mtimes) : null
}

function shouldRunGenerate() {
  if (!existsSync(schemaPath)) {
    console.warn('[prisma] schema.prisma not found, skipping generate')
    return false
  }

  const generatedMtimeMs = getNewestGeneratedMtimeMs()
  if (generatedMtimeMs === null) {
    return true
  }

  const schemaMtimeMs = statSync(schemaPath).mtimeMs
  return generatedMtimeMs < schemaMtimeMs
}

if (!shouldRunGenerate()) {
  console.log('[prisma] generated client is up to date, skipping prisma generate')
  process.exit(0)
}

const prismaBin = resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
)

const result = spawnSync(prismaBin, ['generate'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error('[prisma] failed to start prisma generate:', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
