import { createHash } from 'node:crypto'
import path from 'node:path'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import type { MediaRef } from '@/lib/media/types'

const STORAGE_PREFIX = 'workspace-resources/v1'
const MAX_TEXT_BYTES = 4 * 1024 * 1024

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function contentType(workspacePath: string): string {
  const extension = path.posix.extname(workspacePath).toLowerCase()
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.md') return 'text/markdown; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

export function buildWorkspaceResourceContentKey(input: {
  readonly projectId: string
  readonly resourceId: string
  readonly version: number
  readonly workspacePath: string
  readonly sha256: string
}): string {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error('WORKSPACE_RESOURCE_CONTENT_VERSION_INVALID')
  }
  const extension = path.posix.extname(input.workspacePath).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(input.sha256)) {
    throw new Error('WORKSPACE_RESOURCE_CONTENT_SHA256_INVALID')
  }
  const projectHash = createHash('sha256').update(input.projectId).digest('hex')
  return `${STORAGE_PREFIX}/${projectHash}/${input.resourceId}/v${String(input.version)}-${input.sha256}${extension}`
}

export async function storeWorkspaceResourceContent(input: {
  readonly projectId: string
  readonly resourceId: string
  readonly version: number
  readonly workspacePath: string
  readonly content: string
}): Promise<MediaRef> {
  const bytes = Buffer.from(input.content, 'utf8')
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error('WORKSPACE_RESOURCE_CONTENT_TOO_LARGE')
  const digest = sha256(bytes)
  const key = buildWorkspaceResourceContentKey({ ...input, sha256: digest })
  await uploadObject(bytes, key, contentType(input.workspacePath))
  return await ensureMediaObjectFromStorageKey(key, {
    sha256: digest,
    mimeType: contentType(input.workspacePath),
    sizeBytes: bytes.byteLength,
  })
}

/**
 * Bounded preview persisted next to each text/structured version so list
 * projections never touch object storage (WR-13). Single truncation rule for
 * every version writer.
 */
export const WORKSPACE_RESOURCE_PREVIEW_MAX_CHARS = 500

export function workspaceResourceContentPreview(serialized: string): string {
  return serialized.slice(0, WORKSPACE_RESOURCE_PREVIEW_MAX_CHARS)
}

export async function readWorkspaceResourceTextContent(storageKey: string): Promise<string> {
  const bytes = await getObjectBuffer(storageKey)
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error('WORKSPACE_RESOURCE_CONTENT_TOO_LARGE')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
