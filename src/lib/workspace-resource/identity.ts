import { createHash, randomBytes } from 'node:crypto'

function requireIdentity(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function shortId(namespace: string, parts: readonly string[]): string {
  const digest = createHash('sha256')
  for (const part of [namespace, ...parts]) {
    const normalized = requireIdentity(part, 'WORKSPACE_RESOURCE_IDENTITY_PART_REQUIRED')
    digest.update(String(Buffer.byteLength(normalized, 'utf8')))
    digest.update(':')
    digest.update(normalized)
  }
  return `r_${digest.digest().subarray(0, 16).toString('base64url')}`
}

export function createWorkspaceResourceId(): string {
  return `r_${randomBytes(16).toString('base64url')}`
}

export function buildDomainWorkspaceResourceId(input: {
  readonly sourceType: string
  readonly sourceId: string
}): string {
  return shortId('domain', [
    requireIdentity(input.sourceType, 'WORKSPACE_RESOURCE_SOURCE_TYPE_REQUIRED'),
    requireIdentity(input.sourceId, 'WORKSPACE_RESOURCE_SOURCE_ID_REQUIRED'),
  ])
}

export function buildWorkspaceResourceId(input: {
  readonly operationId: string
  readonly requestId: string
  readonly memberIndex: number
}): string {
  if (!Number.isSafeInteger(input.memberIndex) || input.memberIndex < 0) {
    throw new Error('WORKSPACE_RESOURCE_MEMBER_INDEX_INVALID')
  }
  return shortId('operation', [
    requireIdentity(input.operationId, 'WORKSPACE_RESOURCE_OPERATION_ID_REQUIRED'),
    requireIdentity(input.requestId, 'WORKSPACE_RESOURCE_REQUEST_ID_REQUIRED'),
    String(input.memberIndex),
  ])
}

export function buildWorkspaceResourceAlternativeGroupId(input: {
  readonly operationExecutionId: string
}): string {
  return `rag_${shortId('alternative-group', [
    requireIdentity(
      input.operationExecutionId,
      'WORKSPACE_RESOURCE_ALTERNATIVE_GROUP_EXECUTION_ID_REQUIRED',
    ),
  ]).slice(2)}`
}
