import { createHash } from 'node:crypto'
import type {
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceRevisionContent,
  CreativeResourceScopeKind,
  CreativeResourceScopeRef,
} from './contracts'

function requireIdentity(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function canonicalize(value: CreativeResourceJsonValue): CreativeResourceJsonValue {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key] ?? null)]),
  )
}

export function fingerprintCreativeResourceRevision(input: {
  readonly mediaType: string
  readonly schemaId: string
  readonly content: CreativeResourceRevisionContent
  readonly inputs: readonly CreativeResourceInputRef[]
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly generationOptions: CreativeResourceJsonValue | null
}): string {
  const normalizedInputs = [...input.inputs]
    .sort((left, right) => left.position - right.position || left.role.localeCompare(right.role))
    .map((reference) => ({
      revisionId: reference.revisionId,
      fingerprint: reference.fingerprint,
      role: reference.role,
      position: reference.position,
    }))
  return createHash('sha256').update(JSON.stringify(canonicalize({
    mediaType: input.mediaType.trim(),
    schemaId: input.schemaId.trim(),
    content: input.content as unknown as CreativeResourceJsonValue,
    inputs: normalizedInputs,
    prompt: input.prompt?.trim() ?? null,
    modelKey: input.modelKey?.trim() ?? null,
    generationOptions: input.generationOptions,
  }))).digest('hex')
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

export function buildCreativeResourceOriginKey(input: {
  readonly operationId: string
  readonly requestId: string
  readonly candidateIndex: number
}): string {
  const operationId = requireIdentity(input.operationId, 'CREATIVE_RESOURCE_OPERATION_ID_REQUIRED')
  const requestId = requireIdentity(input.requestId, 'CREATIVE_RESOURCE_REQUEST_ID_REQUIRED')
  if (!Number.isSafeInteger(input.candidateIndex) || input.candidateIndex < 0) {
    throw new Error('CREATIVE_RESOURCE_CANDIDATE_INDEX_INVALID')
  }
  const digest = createHash('sha256')
    .update(operationId)
    .update('\n')
    .update(requestId)
    .update('\n')
    .update(String(input.candidateIndex))
    .digest('hex')
  return `resource:${digest}`
}

export function buildCreativeResourceCandidateSetId(input: {
  readonly operationId: string
  readonly requestId: string
}): string {
  const operationId = requireIdentity(input.operationId, 'CREATIVE_RESOURCE_OPERATION_ID_REQUIRED')
  const requestId = requireIdentity(input.requestId, 'CREATIVE_RESOURCE_REQUEST_ID_REQUIRED')
  const digest = createHash('sha256')
    .update(operationId)
    .update('\n')
    .update(requestId)
    .digest('hex')
  return `candidate-set:${digest}`
}

export function buildDomainCreativeResourceOriginKey(input: {
  readonly sourceType: string
  readonly sourceId: string
}): string {
  const sourceType = requireIdentity(input.sourceType, 'CREATIVE_RESOURCE_SOURCE_TYPE_REQUIRED')
  const sourceId = requireIdentity(input.sourceId, 'CREATIVE_RESOURCE_SOURCE_ID_REQUIRED')
  const digest = createHash('sha256')
    .update(sourceType)
    .update('\n')
    .update(sourceId)
    .digest('hex')
  return `domain:${digest}`
}
