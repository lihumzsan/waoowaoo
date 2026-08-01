import { createHash } from 'node:crypto'
import type {
  CreativeResourceScopeKind,
  CreativeResourceScopeRef,
} from './contracts'

function requireIdentity(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function buildShortIdentity(prefix: 'r_' | 'rs_', namespace: string, parts: readonly string[]): string {
  const digest = createHash('sha256')
  for (const part of [namespace, ...parts]) {
    const normalized = requireIdentity(part, 'CREATIVE_RESOURCE_IDENTITY_PART_REQUIRED')
    digest.update(String(Buffer.byteLength(normalized, 'utf8')))
    digest.update(':')
    digest.update(normalized)
  }
  return `${prefix}${digest.digest().subarray(0, 16).toString('base64url')}`
}

export function buildCreativeResourceScopeRef(input: {
  readonly kind: CreativeResourceScopeKind
  readonly id: string
  readonly userId: string
  readonly projectId?: string | null
  readonly episodeId?: string | null
}): CreativeResourceScopeRef {
  const id = requireIdentity(input.id, 'CREATIVE_RESOURCE_SCOPE_ID_REQUIRED')
  const userId = requireIdentity(input.userId, 'CREATIVE_RESOURCE_USER_ID_REQUIRED')
  const projectId = input.projectId?.trim() || null
  const episodeId = input.episodeId?.trim() || null
  if (input.kind === 'user' && (id !== userId || projectId || episodeId)) {
    throw new Error('CREATIVE_RESOURCE_USER_SCOPE_INVALID')
  }
  if (input.kind === 'project' && (!projectId || id !== projectId || episodeId)) {
    throw new Error('CREATIVE_RESOURCE_PROJECT_SCOPE_INVALID')
  }
  if (input.kind === 'episode' && (!projectId || !episodeId || id !== episodeId)) {
    throw new Error('CREATIVE_RESOURCE_EPISODE_SCOPE_INVALID')
  }
  return { kind: input.kind, id, userId, projectId, episodeId }
}

export function resolveProjectCreativeResourceScope(input: {
  readonly userId: string
  readonly projectId: string
  readonly episodeId?: string | null
}): CreativeResourceScopeRef {
  const episodeId = input.episodeId?.trim() || null
  return buildCreativeResourceScopeRef({
    kind: episodeId ? 'episode' : 'project',
    id: episodeId ?? input.projectId,
    userId: input.userId,
    projectId: input.projectId,
    episodeId,
  })
}

export function buildCreativeResourceId(input: {
  readonly operationId: string
  readonly requestId: string
  readonly memberIndex: number
}): string {
  const operationId = requireIdentity(input.operationId, 'CREATIVE_RESOURCE_OPERATION_ID_REQUIRED')
  const requestId = requireIdentity(input.requestId, 'CREATIVE_RESOURCE_REQUEST_ID_REQUIRED')
  if (!Number.isSafeInteger(input.memberIndex) || input.memberIndex < 0) {
    throw new Error('CREATIVE_RESOURCE_MEMBER_INDEX_INVALID')
  }
  return buildShortIdentity('r_', 'operation', [
    operationId,
    requestId,
    String(input.memberIndex),
  ])
}

export function buildDomainCreativeResourceId(input: {
  readonly sourceType: string
  readonly sourceId: string
}): string {
  const sourceType = requireIdentity(input.sourceType, 'CREATIVE_RESOURCE_SOURCE_TYPE_REQUIRED')
  const sourceId = requireIdentity(input.sourceId, 'CREATIVE_RESOURCE_SOURCE_ID_REQUIRED')
  return buildShortIdentity('r_', 'domain', [sourceType, sourceId])
}
