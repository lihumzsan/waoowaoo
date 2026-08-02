import { createHash } from 'node:crypto'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import {
  encodeWorkspaceBundle,
  parseWorkspaceBundle,
  validateWorkspaceBundle,
  WORKSPACE_BUNDLE_SCHEMA_VERSION,
  type WorkspaceBundleV1,
} from './workspace-bundle'

const WORKSPACE_STORAGE_PREFIX = 'agent-workspaces/v1'
const WORKSPACE_BUNDLE_FILE_NAME = 'workspace.bundle.json'

export type WorkspaceStoreScope = {
  readonly userId: string
  readonly projectId: string
}

export type WorkspaceBundleStoreView = {
  readonly bundle: WorkspaceBundleV1
  readonly sha256: string
}

export type WorkspaceBundleSaveResult = WorkspaceBundleStoreView & {
  readonly changed: boolean
}

export type WorkspaceStoreErrorCode =
  | 'WORKSPACE_NOT_INITIALIZED'
  | 'WORKSPACE_ALREADY_INITIALIZED'
  | 'WORKSPACE_SCOPE_INVALID'
  | 'WORKSPACE_BUNDLE_NON_CANONICAL'
  | 'WORKSPACE_BUNDLE_READ_FAILED'
  | 'WORKSPACE_BUNDLE_WRITE_FAILED'
  | 'WORKSPACE_BUNDLE_WRITE_CONFLICT'

export class WorkspaceStoreError extends Error {
  readonly code: WorkspaceStoreErrorCode

  constructor(code: WorkspaceStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceStoreError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireScopePart(value: string, label: string): string {
  const normalized = value.trim()
  if (
    normalized !== value
    || !/^[A-Za-z0-9_-]{1,191}$/u.test(normalized)
  ) {
    throw new WorkspaceStoreError(
      'WORKSPACE_SCOPE_INVALID',
      `${label} is not a valid workspace scope identity`,
    )
  }
  return normalized
}

function addFramedHashValue(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.length)
  hash.update(length)
  hash.update(bytes)
}

export function buildWorkspaceBundleStorageKey(scope: WorkspaceStoreScope): string {
  const userId = requireScopePart(scope.userId, 'userId')
  const projectId = requireScopePart(scope.projectId, 'projectId')
  const hash = createHash('sha256')
  addFramedHashValue(hash, userId)
  addFramedHashValue(hash, projectId)
  return `${WORKSPACE_STORAGE_PREFIX}/${hash.digest('hex')}/${WORKSPACE_BUNDLE_FILE_NAME}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isMissingObjectError(error: unknown): boolean {
  if (!isRecord(error)) return false
  const metadata = isRecord(error.$metadata) ? error.$metadata : null
  const httpStatusCode = metadata?.httpStatusCode
  const name = typeof error.name === 'string' ? error.name : ''
  const code = typeof error.Code === 'string'
    ? error.Code
    : typeof error.code === 'string'
      ? error.code
      : ''
  return httpStatusCode === 404 || name === 'NoSuchKey' || name === 'NotFound'
    || code === 'NoSuchKey' || code === 'NotFound'
}

async function readStoredBytes(storageKey: string): Promise<Buffer | null> {
  try {
    return await getObjectBuffer(storageKey)
  } catch (error: unknown) {
    if (isMissingObjectError(error)) return null
    throw new WorkspaceStoreError(
      'WORKSPACE_BUNDLE_READ_FAILED',
      'Failed to read workspace bundle from object storage',
      { cause: error },
    )
  }
}

function decodeCanonicalStoredBundle(bytes: Buffer): WorkspaceBundleStoreView {
  const bundle = parseWorkspaceBundle(bytes)
  const canonicalBytes = encodeWorkspaceBundle(bundle)
  if (!bytes.equals(canonicalBytes)) {
    throw new WorkspaceStoreError(
      'WORKSPACE_BUNDLE_NON_CANONICAL',
      'Stored workspace bundle is not canonically encoded',
    )
  }
  return { bundle, sha256: sha256(canonicalBytes) }
}

async function putCanonicalBytes(storageKey: string, bytes: Buffer): Promise<void> {
  try {
    await uploadObject(bytes, storageKey, 1, 'application/json; charset=utf-8')
    return
  } catch (writeError: unknown) {
    let storedBytes: Buffer | null
    try {
      storedBytes = await readStoredBytes(storageKey)
    } catch (readError: unknown) {
      throw new WorkspaceStoreError(
        'WORKSPACE_BUNDLE_WRITE_FAILED',
        'Workspace bundle write failed and its outcome could not be verified',
        { cause: new AggregateError([writeError, readError]) },
      )
    }

    if (storedBytes && sha256(storedBytes) === sha256(bytes) && storedBytes.equals(bytes)) return
    if (storedBytes) {
      throw new WorkspaceStoreError(
        'WORKSPACE_BUNDLE_WRITE_CONFLICT',
        'Workspace bundle write failed and object storage contains different bytes',
        { cause: writeError },
      )
    }
    throw new WorkspaceStoreError(
      'WORKSPACE_BUNDLE_WRITE_FAILED',
      'Workspace bundle write failed and no workspace object was stored',
      { cause: writeError },
    )
  }
}

export async function loadWorkspaceBundle(
  scope: WorkspaceStoreScope,
): Promise<WorkspaceBundleStoreView> {
  const storageKey = buildWorkspaceBundleStorageKey(scope)
  const bytes = await readStoredBytes(storageKey)
  if (!bytes) {
    throw new WorkspaceStoreError(
      'WORKSPACE_NOT_INITIALIZED',
      'Workspace bundle has not been initialized',
    )
  }
  return decodeCanonicalStoredBundle(bytes)
}

export async function initializeWorkspaceBundle(
  scope: WorkspaceStoreScope,
  initialBundle: WorkspaceBundleV1 = {
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    files: [],
  },
): Promise<WorkspaceBundleStoreView> {
  const storageKey = buildWorkspaceBundleStorageKey(scope)
  const existingBytes = await readStoredBytes(storageKey)
  if (existingBytes) {
    throw new WorkspaceStoreError(
      'WORKSPACE_ALREADY_INITIALIZED',
      'Workspace bundle is already initialized',
    )
  }

  const bundle = validateWorkspaceBundle(initialBundle)
  const bytes = encodeWorkspaceBundle(bundle)
  await putCanonicalBytes(storageKey, bytes)
  return { bundle, sha256: sha256(bytes) }
}

export async function saveWorkspaceBundle(
  scope: WorkspaceStoreScope,
  nextBundle: WorkspaceBundleV1,
): Promise<WorkspaceBundleSaveResult> {
  const storageKey = buildWorkspaceBundleStorageKey(scope)
  const existingBytes = await readStoredBytes(storageKey)
  if (!existingBytes) {
    throw new WorkspaceStoreError(
      'WORKSPACE_NOT_INITIALIZED',
      'Workspace bundle must be initialized before it can be saved',
    )
  }
  decodeCanonicalStoredBundle(existingBytes)

  const bundle = validateWorkspaceBundle(nextBundle)
  const nextBytes = encodeWorkspaceBundle(bundle)
  if (existingBytes.equals(nextBytes)) {
    return { bundle, sha256: sha256(nextBytes), changed: false }
  }

  await putCanonicalBytes(storageKey, nextBytes)
  return { bundle, sha256: sha256(nextBytes), changed: true }
}
