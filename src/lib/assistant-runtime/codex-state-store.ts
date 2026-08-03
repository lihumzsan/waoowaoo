import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import type { RuntimeSessionScope } from '@/lib/codex-runtime/runtime-session-manager'
import { ASSISTANT_RUNTIME_REVISION } from './runtime-revision'

const CODEX_STATE_STORAGE_PREFIX = 'agent-workspaces/v1'
const CODEX_STATE_FILE_NAME = `codex-session-state.${ASSISTANT_RUNTIME_REVISION}.json`
const CODEX_STATE_MAX_FILES = 2_000
const CODEX_STATE_MAX_FILE_BYTES = 16 * 1024 * 1024
const CODEX_STATE_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const ALLOWED_ROOTS = new Set(['sessions', 'archived_sessions'])
const ALLOWED_EXTENSION = '.jsonl'

type CodexStateFile = {
  readonly path: string
  readonly sha256: string
  readonly contentBase64: string
}

type CodexStateBundle = {
  readonly schemaVersion: 1
  readonly files: readonly CodexStateFile[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireScopePart(value: string, code: string): string {
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{1,191}$/u.test(value)) throw new Error(code)
  return value
}

function addFramed(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.length)
  hash.update(length)
  hash.update(bytes)
}

export function buildCodexStateStorageKey(scope: RuntimeSessionScope): string {
  const userId = requireScopePart(scope.userId, 'ASSISTANT_RUNTIME_STATE_USER_ID_INVALID')
  const projectId = requireScopePart(scope.projectId, 'ASSISTANT_RUNTIME_STATE_PROJECT_ID_INVALID')
  const hash = createHash('sha256')
  addFramed(hash, userId)
  addFramed(hash, projectId)
  return `${CODEX_STATE_STORAGE_PREFIX}/${hash.digest('hex')}/${CODEX_STATE_FILE_NAME}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function validateRelativePath(value: string): string {
  if (
    !value
    || value !== value.trim()
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || path.posix.normalize(value) !== value
  ) {
    throw new Error('ASSISTANT_RUNTIME_STATE_PATH_INVALID')
  }
  const segments = value.split('/')
  if (
    segments.length < 2
    || !ALLOWED_ROOTS.has(segments[0] ?? '')
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
    || path.posix.extname(value) !== ALLOWED_EXTENSION
  ) {
    throw new Error('ASSISTANT_RUNTIME_STATE_PATH_FORBIDDEN')
  }
  return value
}

function encodeBundle(bundle: CodexStateBundle): Buffer {
  const normalized: CodexStateBundle = {
    schemaVersion: 1,
    files: [...bundle.files].sort((left, right) => left.path.localeCompare(right.path)),
  }
  return Buffer.from(JSON.stringify(normalized), 'utf8')
}

function parseBundle(bytes: Buffer): CodexStateBundle {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error('ASSISTANT_RUNTIME_STATE_BUNDLE_INVALID', { cause: error })
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.files)) {
    throw new Error('ASSISTANT_RUNTIME_STATE_BUNDLE_INVALID')
  }
  if (value.files.length > CODEX_STATE_MAX_FILES) {
    throw new Error('ASSISTANT_RUNTIME_STATE_FILE_LIMIT_EXCEEDED')
  }
  let totalBytes = 0
  const seen = new Set<string>()
  const files = value.files.map((entry): CodexStateFile => {
    if (!isRecord(entry)) throw new Error('ASSISTANT_RUNTIME_STATE_FILE_INVALID')
    const relativePath = typeof entry.path === 'string' ? validateRelativePath(entry.path) : null
    const contentBase64 = typeof entry.contentBase64 === 'string' ? entry.contentBase64 : null
    const digest = typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(entry.sha256)
      ? entry.sha256
      : null
    if (!relativePath || contentBase64 === null || !digest || seen.has(relativePath)) {
      throw new Error('ASSISTANT_RUNTIME_STATE_FILE_INVALID')
    }
    seen.add(relativePath)
    const content = Buffer.from(contentBase64, 'base64')
    if (content.toString('base64') !== contentBase64 || content.length > CODEX_STATE_MAX_FILE_BYTES) {
      throw new Error('ASSISTANT_RUNTIME_STATE_FILE_CONTENT_INVALID')
    }
    if (sha256(content) !== digest) throw new Error('ASSISTANT_RUNTIME_STATE_FILE_HASH_INVALID')
    totalBytes += content.length
    if (totalBytes > CODEX_STATE_MAX_TOTAL_BYTES) {
      throw new Error('ASSISTANT_RUNTIME_STATE_TOTAL_LIMIT_EXCEEDED')
    }
    return { path: relativePath, sha256: digest, contentBase64 }
  })
  const bundle = { schemaVersion: 1 as const, files: files.sort((a, b) => a.path.localeCompare(b.path)) }
  if (!encodeBundle(bundle).equals(bytes)) throw new Error('ASSISTANT_RUNTIME_STATE_BUNDLE_NON_CANONICAL')
  return bundle
}

function isMissingObjectError(error: unknown): boolean {
  if (!isRecord(error)) return false
  const metadata = isRecord(error.$metadata) ? error.$metadata : null
  const status = metadata?.httpStatusCode
  const name = typeof error.name === 'string' ? error.name : ''
  const code = typeof error.code === 'string' ? error.code : ''
  return status === 404 || name === 'NoSuchKey' || name === 'NotFound'
    || code === 'NoSuchKey' || code === 'NotFound'
}

async function readStoredBundle(scope: RuntimeSessionScope): Promise<Buffer | null> {
  try {
    return await getObjectBuffer(buildCodexStateStorageKey(scope))
  } catch (error) {
    if (isMissingObjectError(error)) return null
    throw new Error('ASSISTANT_RUNTIME_STATE_READ_FAILED', { cause: error })
  }
}

async function readRegularFile(absolutePath: string, relativePath: string): Promise<Buffer> {
  let handle
  try {
    handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    throw new Error(`ASSISTANT_RUNTIME_STATE_FILE_OPEN_FAILED:${relativePath}`, { cause: error })
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > CODEX_STATE_MAX_FILE_BYTES) {
      throw new Error(`ASSISTANT_RUNTIME_STATE_FILE_INVALID:${relativePath}`)
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function collectFiles(
  codexHomeDirectory: string,
  relativeDirectory: string,
  files: CodexStateFile[],
  total: { value: number },
): Promise<void> {
  const absoluteDirectory = path.join(codexHomeDirectory, ...relativeDirectory.split('/'))
  let entries
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return
    throw error
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    const absolutePath = path.join(absoluteDirectory, entry.name)
    const stat = await lstat(absolutePath)
    if (stat.isSymbolicLink() || entry.isSymbolicLink()) {
      throw new Error(`ASSISTANT_RUNTIME_STATE_SYMLINK_FORBIDDEN:${relativePath}`)
    }
    if (stat.isDirectory() && entry.isDirectory()) {
      await collectFiles(codexHomeDirectory, relativePath, files, total)
      continue
    }
    if (!stat.isFile() || !entry.isFile()) {
      throw new Error(`ASSISTANT_RUNTIME_STATE_SPECIAL_FILE_FORBIDDEN:${relativePath}`)
    }
    if (path.posix.extname(relativePath) !== ALLOWED_EXTENSION) continue
    validateRelativePath(relativePath)
    const content = await readRegularFile(absolutePath, relativePath)
    total.value += content.length
    if (files.length >= CODEX_STATE_MAX_FILES || total.value > CODEX_STATE_MAX_TOTAL_BYTES) {
      throw new Error('ASSISTANT_RUNTIME_STATE_LIMIT_EXCEEDED')
    }
    files.push({
      path: relativePath,
      sha256: sha256(content),
      contentBase64: content.toString('base64'),
    })
  }
}

export async function captureCodexStateBundle(codexHomeDirectory: string): Promise<Buffer> {
  const files: CodexStateFile[] = []
  const total = { value: 0 }
  await collectFiles(codexHomeDirectory, 'sessions', files, total)
  await collectFiles(codexHomeDirectory, 'archived_sessions', files, total)
  return encodeBundle({ schemaVersion: 1, files })
}

export async function restoreCodexStateBundle(input: {
  readonly scope: RuntimeSessionScope
  readonly codexHomeDirectory: string
}): Promise<boolean> {
  const existingEntries = await readdir(input.codexHomeDirectory).catch((error: unknown) => {
    if (isRecord(error) && error.code === 'ENOENT') return []
    throw error
  })
  if (existingEntries.length > 0) throw new Error('ASSISTANT_RUNTIME_STATE_HOME_NOT_EMPTY')
  await mkdir(input.codexHomeDirectory, { recursive: true, mode: 0o700 })
  const bytes = await readStoredBundle(input.scope)
  if (!bytes) return false
  const bundle = parseBundle(bytes)
  for (const file of bundle.files) {
    const content = Buffer.from(file.contentBase64, 'base64')
    const absolutePath = path.join(input.codexHomeDirectory, ...file.path.split('/'))
    await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 })
    await writeFile(absolutePath, content, { flag: 'wx', mode: 0o600 })
  }
  return true
}

export async function saveCodexStateBundle(input: {
  readonly scope: RuntimeSessionScope
  readonly codexHomeDirectory: string
}): Promise<{ readonly changed: boolean; readonly sha256: string }> {
  const next = await captureCodexStateBundle(input.codexHomeDirectory)
  const prior = await readStoredBundle(input.scope)
  if (prior && prior.equals(next)) return { changed: false, sha256: sha256(next) }
  try {
    await uploadObject(next, buildCodexStateStorageKey(input.scope), 1, 'application/json')
  } catch (writeError) {
    let stored: Buffer | null
    try {
      stored = await readStoredBundle(input.scope)
    } catch (readError) {
      throw new Error('ASSISTANT_RUNTIME_STATE_WRITE_OUTCOME_UNKNOWN', {
        cause: new AggregateError([writeError, readError]),
      })
    }
    if (!stored || !stored.equals(next)) {
      throw new Error('ASSISTANT_RUNTIME_STATE_WRITE_FAILED', { cause: writeError })
    }
  }
  return { changed: true, sha256: sha256(next) }
}
