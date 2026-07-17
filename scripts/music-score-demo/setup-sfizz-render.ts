import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SFIZZ_REPOSITORY = 'https://github.com/sfztools/sfizz.git'
const SFIZZ_COMMIT = 'f5c6e29f23b8057867c08e88f5f6ac6738baa30b'

function run(command: string, args: readonly string[], errorCode: string): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`${errorCode}:${result.error.message}`)
  if (result.status !== 0) throw new Error(`${errorCode}:exit=${result.status ?? 'unknown'}`)
}

function capture(command: string, args: readonly string[], errorCode: string): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw new Error(`${errorCode}:${result.error.message}`)
  if (result.status !== 0) throw new Error(`${errorCode}:${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') return false
    throw error
  }
}

async function patchAtomicQueue(sourceDir: string): Promise<void> {
  const headerPath = path.join(sourceDir, 'external/atomic_queue/include/atomic_queue/atomic_queue.h')
  let source = await readFile(headerPath, 'utf8')
  const replacements = [
    ['Base::template do_pop_any', 'Base::do_pop_any'],
    ['Base::template do_push_any', 'Base::do_push_any'],
    ['Base::do_pop_atomic<T, NIL>', 'Base::template do_pop_atomic<T, NIL>'],
    ['Base::do_push_atomic<T, NIL>', 'Base::template do_push_atomic<T, NIL>'],
  ] as const
  for (const [obsolete, current] of replacements) {
    const obsoleteCount = source.split(obsolete).length - 1
    const currentCount = source.split(current).length - 1
    if (obsoleteCount + currentCount !== 2) {
      throw new Error(`SFIZZ_ATOMIC_QUEUE_PATCH_CONTEXT_INVALID:${obsolete}:${obsoleteCount}:${currentCount}`)
    }
    source = source.replaceAll(obsolete, current)
  }
  await writeFile(headerPath, source)
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd()
  const assetsDir = path.join(repositoryRoot, 'tmp/music-benchmark-assets')
  const sourceDir = path.join(assetsDir, 'sfizz-pinned-src')
  const buildDir = path.join(assetsDir, 'sfizz-pinned-build')
  await mkdir(assetsDir, { recursive: true })

  if (!(await exists(path.join(sourceDir, '.git')))) {
    run('git', ['clone', '--filter=blob:none', '--no-checkout', SFIZZ_REPOSITORY, sourceDir], 'SFIZZ_CLONE_FAILED')
    run('git', ['-C', sourceDir, 'fetch', '--depth', '1', 'origin', SFIZZ_COMMIT], 'SFIZZ_FETCH_FAILED')
    run('git', ['-C', sourceDir, 'checkout', '--detach', SFIZZ_COMMIT], 'SFIZZ_CHECKOUT_FAILED')
    run(
      'git', ['-C', sourceDir, 'submodule', 'update', '--init', '--recursive', '--depth', '1'],
      'SFIZZ_SUBMODULE_UPDATE_FAILED',
    )
  }
  const currentCommit = capture('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], 'SFIZZ_VERSION_READ_FAILED')
  if (currentCommit !== SFIZZ_COMMIT) throw new Error(`SFIZZ_SOURCE_VERSION_MISMATCH:${currentCommit}`)
  await patchAtomicQueue(sourceDir)

  run('cmake', [
    '-S', sourceDir, '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Release', '-DSFIZZ_JACK=OFF', '-DSFIZZ_SHARED=OFF',
    '-DSFIZZ_TESTS=OFF', '-DSFIZZ_BENCHMARKS=OFF', '-DSFIZZ_DEMOS=OFF', '-DSFIZZ_DEVTOOLS=OFF',
  ], 'SFIZZ_CONFIGURE_FAILED')
  run('cmake', ['--build', buildDir, '--target', 'sfizz_render', '--parallel', '8'], 'SFIZZ_BUILD_FAILED')

  const binaryPath = path.join(buildDir, 'library/bin/sfizz_render')
  if (!(await exists(binaryPath))) throw new Error('SFIZZ_BINARY_MISSING_AFTER_BUILD')
  process.stdout.write(`sfizz_render → ${binaryPath}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
