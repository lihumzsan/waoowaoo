import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

export const WORKSPACE_BUNDLE_SCHEMA_VERSION = 1 as const
export const WORKSPACE_BUNDLE_MAX_FILES = 1_000
export const WORKSPACE_BUNDLE_MAX_FILE_BYTES = 1024 * 1024
export const WORKSPACE_BUNDLE_MAX_TOTAL_BYTES = 10 * 1024 * 1024
export const WORKSPACE_BUNDLE_MAX_PATH_BYTES = 512
export const WORKSPACE_BUNDLE_MAX_ENCODED_BYTES = 64 * 1024 * 1024

const ALLOWED_EXTENSIONS = new Set(['.json', '.md', '.txt'])
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

export type WorkspaceBundleFile = {
  readonly path: string
  readonly content: string
}

export type WorkspaceBundleV1 = {
  readonly schemaVersion: typeof WORKSPACE_BUNDLE_SCHEMA_VERSION
  readonly files: readonly WorkspaceBundleFile[]
}

export type WorkspaceBundleErrorCode =
  | 'WORKSPACE_BUNDLE_INVALID'
  | 'WORKSPACE_BUNDLE_PATH_INVALID'
  | 'WORKSPACE_BUNDLE_FILE_TYPE_INVALID'
  | 'WORKSPACE_BUNDLE_FILE_LIMIT_EXCEEDED'
  | 'WORKSPACE_BUNDLE_FILE_TOO_LARGE'
  | 'WORKSPACE_BUNDLE_TOTAL_SIZE_EXCEEDED'
  | 'WORKSPACE_BUNDLE_UTF8_INVALID'
  | 'WORKSPACE_BUNDLE_DIRECTORY_NOT_EMPTY'
  | 'WORKSPACE_BUNDLE_SYMLINK_FORBIDDEN'
  | 'WORKSPACE_BUNDLE_SPECIAL_FILE_FORBIDDEN'

export class WorkspaceBundleError extends Error {
  readonly code: WorkspaceBundleErrorCode

  constructor(code: WorkspaceBundleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceBundleError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_INVALID',
      `${label} must contain exactly: ${expected.join(', ')}`,
    )
  }
}

function assertUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue
    if (codeUnit > 0xdbff) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_UTF8_INVALID',
        `${label} contains an unpaired Unicode surrogate`,
      )
    }
    const nextCodeUnit = value.charCodeAt(index + 1)
    if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_UTF8_INVALID',
        `${label} contains an unpaired Unicode surrogate`,
      )
    }
    index += 1
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    const decoded = UTF8_DECODER.decode(bytes)
    assertUnicodeScalarString(decoded, label)
    return decoded
  } catch (error: unknown) {
    if (error instanceof WorkspaceBundleError) throw error
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_UTF8_INVALID',
      `${label} is not valid UTF-8`,
      { cause: error },
    )
  }
}

function validatePathComponents(rawPath: string): string {
  assertUnicodeScalarString(rawPath, 'Workspace file path')
  if (
    rawPath.length === 0
    || rawPath !== rawPath.trim()
    || rawPath !== rawPath.normalize('NFC')
    || rawPath.startsWith('/')
    || rawPath.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(rawPath)
    || Buffer.byteLength(rawPath, 'utf8') > WORKSPACE_BUNDLE_MAX_PATH_BYTES
  ) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_PATH_INVALID',
      `Invalid workspace path: ${JSON.stringify(rawPath)}`,
    )
  }

  const segments = rawPath.split('/')
  if (
    segments.some((segment) => (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || segment.startsWith('.')
    ))
    || path.posix.normalize(rawPath) !== rawPath
  ) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_PATH_INVALID',
      `Workspace path must be normalized and contain no hidden or traversal segments: ${rawPath}`,
    )
  }
  return rawPath
}

export function validateWorkspaceFilePath(rawPath: string): string {
  const normalizedPath = validatePathComponents(rawPath)
  const extension = path.posix.extname(normalizedPath)
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_FILE_TYPE_INVALID',
      `Workspace file extension is not allowed: ${normalizedPath}`,
    )
  }
  return normalizedPath
}

function validateWorkspaceDirectoryPath(rawPath: string): string {
  return validatePathComponents(rawPath)
}

function normalizeBundleFiles(files: readonly WorkspaceBundleFile[]): WorkspaceBundleFile[] {
  if (files.length > WORKSPACE_BUNDLE_MAX_FILES) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_FILE_LIMIT_EXCEEDED',
      `Workspace contains more than ${String(WORKSPACE_BUNDLE_MAX_FILES)} files`,
    )
  }

  let totalBytes = 0
  const seenPaths = new Set<string>()
  const normalized = files.map((file, index) => {
    if (!isRecord(file)) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_INVALID',
        `Workspace file at index ${String(index)} must be an object`,
      )
    }
    requireExactKeys(file, ['path', 'content'], `Workspace file at index ${String(index)}`)
    if (typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_INVALID',
        `Workspace file at index ${String(index)} must contain string path and content`,
      )
    }

    const filePath = validateWorkspaceFilePath(file.path)
    if (seenPaths.has(filePath)) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_PATH_INVALID',
        `Duplicate workspace path: ${filePath}`,
      )
    }
    seenPaths.add(filePath)

    assertUnicodeScalarString(file.content, `Workspace file ${filePath}`)
    const fileBytes = Buffer.byteLength(file.content, 'utf8')
    if (fileBytes > WORKSPACE_BUNDLE_MAX_FILE_BYTES) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_FILE_TOO_LARGE',
        `Workspace file exceeds ${String(WORKSPACE_BUNDLE_MAX_FILE_BYTES)} bytes: ${filePath}`,
      )
    }
    totalBytes += fileBytes
    if (totalBytes > WORKSPACE_BUNDLE_MAX_TOTAL_BYTES) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_TOTAL_SIZE_EXCEEDED',
        `Workspace content exceeds ${String(WORKSPACE_BUNDLE_MAX_TOTAL_BYTES)} bytes`,
      )
    }

    return { path: filePath, content: file.content }
  })

  return normalized.sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ))
}

export function validateWorkspaceBundle(value: unknown): WorkspaceBundleV1 {
  if (!isRecord(value)) {
    throw new WorkspaceBundleError('WORKSPACE_BUNDLE_INVALID', 'Workspace bundle must be an object')
  }
  requireExactKeys(value, ['schemaVersion', 'files'], 'Workspace bundle')
  if (value.schemaVersion !== WORKSPACE_BUNDLE_SCHEMA_VERSION || !Array.isArray(value.files)) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_INVALID',
      `Workspace bundle must use schemaVersion ${String(WORKSPACE_BUNDLE_SCHEMA_VERSION)} and contain files`,
    )
  }

  return {
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    files: normalizeBundleFiles(value.files as readonly WorkspaceBundleFile[]),
  }
}

export function parseWorkspaceBundle(input: string | Uint8Array): WorkspaceBundleV1 {
  const encodedBytes = typeof input === 'string'
    ? Buffer.byteLength(input, 'utf8')
    : input.byteLength
  if (encodedBytes > WORKSPACE_BUNDLE_MAX_ENCODED_BYTES) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_TOTAL_SIZE_EXCEEDED',
      `Encoded workspace bundle exceeds ${String(WORKSPACE_BUNDLE_MAX_ENCODED_BYTES)} bytes`,
    )
  }
  const source = typeof input === 'string'
    ? (() => {
        assertUnicodeScalarString(input, 'Workspace bundle')
        return input
      })()
    : decodeUtf8(input, 'Workspace bundle')

  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch (error: unknown) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_INVALID',
      'Workspace bundle is not valid JSON',
      { cause: error },
    )
  }
  return validateWorkspaceBundle(parsed)
}

export function encodeWorkspaceBundle(bundle: WorkspaceBundleV1): Buffer {
  const normalized = validateWorkspaceBundle(bundle)
  const encoded = Buffer.from(JSON.stringify(normalized), 'utf8')
  if (encoded.byteLength > WORKSPACE_BUNDLE_MAX_ENCODED_BYTES) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_TOTAL_SIZE_EXCEEDED',
      `Encoded workspace bundle exceeds ${String(WORKSPACE_BUNDLE_MAX_ENCODED_BYTES)} bytes`,
    )
  }
  return encoded
}

async function requireEmptyMaterializationRoot(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 })
  const rootStat = await lstat(rootDir)
  if (rootStat.isSymbolicLink()) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_SYMLINK_FORBIDDEN',
      'Workspace materialization root must not be a symbolic link',
    )
  }
  if (!rootStat.isDirectory()) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_SPECIAL_FILE_FORBIDDEN',
      'Workspace materialization root must be a directory',
    )
  }
  if ((await readdir(rootDir)).length !== 0) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_DIRECTORY_NOT_EMPTY',
      'Workspace materialization root must be empty',
    )
  }
}

async function ensureMaterializationDirectory(rootDir: string, relativeDir: string): Promise<void> {
  if (!relativeDir) return
  validateWorkspaceDirectoryPath(relativeDir)
  let currentPath = rootDir
  for (const segment of relativeDir.split('/')) {
    currentPath = path.join(currentPath, segment)
    await mkdir(currentPath, { mode: 0o700 }).catch((error: unknown) => {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : null
      if (code !== 'EEXIST') throw error
    })
    const currentStat = await lstat(currentPath)
    if (currentStat.isSymbolicLink()) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_SYMLINK_FORBIDDEN',
        `Workspace directory must not be a symbolic link: ${relativeDir}`,
      )
    }
    if (!currentStat.isDirectory()) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_SPECIAL_FILE_FORBIDDEN',
        `Workspace path is not a directory: ${relativeDir}`,
      )
    }
  }
}

export async function materializeWorkspaceBundle(
  rootDir: string,
  bundle: WorkspaceBundleV1,
): Promise<void> {
  const normalized = validateWorkspaceBundle(bundle)
  await requireEmptyMaterializationRoot(rootDir)

  for (const file of normalized.files) {
    const parentDir = path.posix.dirname(file.path)
    await ensureMaterializationDirectory(rootDir, parentDir === '.' ? '' : parentDir)
    await writeFile(
      path.join(rootDir, ...file.path.split('/')),
      Buffer.from(file.content, 'utf8'),
      { flag: 'wx', mode: 0o600 },
    )
  }
}

async function readRegularUtf8File(absolutePath: string, relativePath: string): Promise<string> {
  let handle
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    )
  } catch (error: unknown) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : null
    if (code === 'ELOOP') {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_SYMLINK_FORBIDDEN',
        `Workspace file must not be a symbolic link: ${relativePath}`,
        { cause: error },
      )
    }
    throw error
  }

  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_SPECIAL_FILE_FORBIDDEN',
        `Workspace path is not a regular file: ${relativePath}`,
      )
    }
    if (fileStat.size > WORKSPACE_BUNDLE_MAX_FILE_BYTES) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_FILE_TOO_LARGE',
        `Workspace file exceeds ${String(WORKSPACE_BUNDLE_MAX_FILE_BYTES)} bytes: ${relativePath}`,
      )
    }
    return decodeUtf8(await handle.readFile(), `Workspace file ${relativePath}`)
  } finally {
    await handle.close()
  }
}

async function collectWorkspaceFiles(
  rootDir: string,
  relativeDir: string,
  files: WorkspaceBundleFile[],
  byteCounter: { value: number },
): Promise<void> {
  const absoluteDir = relativeDir
    ? path.join(rootDir, ...relativeDir.split('/'))
    : rootDir
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  entries.sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ))

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    const absolutePath = path.join(absoluteDir, entry.name)
    const entryStat = await lstat(absolutePath)
    if (entryStat.isSymbolicLink() || entry.isSymbolicLink()) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_SYMLINK_FORBIDDEN',
        `Workspace path must not be a symbolic link: ${relativePath}`,
      )
    }
    if (entryStat.isDirectory() && entry.isDirectory()) {
      validateWorkspaceDirectoryPath(relativePath)
      await collectWorkspaceFiles(rootDir, relativePath, files, byteCounter)
      continue
    }
    if (!entryStat.isFile() || !entry.isFile()) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_SPECIAL_FILE_FORBIDDEN',
        `Workspace path must be a regular file or directory: ${relativePath}`,
      )
    }

    validateWorkspaceFilePath(relativePath)
    if (files.length >= WORKSPACE_BUNDLE_MAX_FILES) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_FILE_LIMIT_EXCEEDED',
        `Workspace contains more than ${String(WORKSPACE_BUNDLE_MAX_FILES)} files`,
      )
    }
    const content = await readRegularUtf8File(absolutePath, relativePath)
    byteCounter.value += Buffer.byteLength(content, 'utf8')
    if (byteCounter.value > WORKSPACE_BUNDLE_MAX_TOTAL_BYTES) {
      throw new WorkspaceBundleError(
        'WORKSPACE_BUNDLE_TOTAL_SIZE_EXCEEDED',
        `Workspace content exceeds ${String(WORKSPACE_BUNDLE_MAX_TOTAL_BYTES)} bytes`,
      )
    }
    files.push({ path: relativePath, content })
  }
}

export async function captureWorkspaceBundle(rootDir: string): Promise<WorkspaceBundleV1> {
  const rootStat = await lstat(rootDir)
  if (rootStat.isSymbolicLink()) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_SYMLINK_FORBIDDEN',
      'Workspace capture root must not be a symbolic link',
    )
  }
  if (!rootStat.isDirectory()) {
    throw new WorkspaceBundleError(
      'WORKSPACE_BUNDLE_SPECIAL_FILE_FORBIDDEN',
      'Workspace capture root must be a directory',
    )
  }

  const files: WorkspaceBundleFile[] = []
  await collectWorkspaceFiles(rootDir, '', files, { value: 0 })
  return validateWorkspaceBundle({
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    files,
  })
}
