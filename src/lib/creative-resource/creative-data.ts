import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import type {
  CreativeResourceInputRef,
  CreativeResourceJsonObject,
  CreativeResourceJsonValue,
} from './contracts'
import { isCreativeResourceScopeKind } from './contracts'
import { validateCreativeResourceInputReferencesInTransaction } from './persistence'

const MAX_EDIT_PATH_SEGMENTS = 24
const MAX_EDIT_PATH_SEGMENT_LENGTH = 128
const MAX_CREATIVE_DATA_DEPTH = 24
const MAX_CREATIVE_DATA_NODES = 10_000
const MAX_CREATIVE_DATA_BYTES = 256 * 1024
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export type CreativeResourceDataEdit =
  | {
      readonly op: 'set'
      readonly path: readonly string[]
      readonly value: CreativeResourceJsonValue
    }
  | {
      readonly op: 'remove'
      readonly path: readonly string[]
    }

interface EmbeddedCreativeResourceRef {
  readonly resourceId: string
}

function invalidData(code: string, details: Record<string, unknown> = {}): never {
  throw new ApiError('INVALID_PARAMS', {
    code,
    agentRetryableAfterCorrection: true,
    ...details,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonValue(value: unknown, depth: number, nodes: { count: number }): CreativeResourceJsonValue {
  nodes.count += 1
  if (nodes.count > MAX_CREATIVE_DATA_NODES) invalidData('CREATIVE_RESOURCE_DATA_TOO_COMPLEX')
  if (depth > MAX_CREATIVE_DATA_DEPTH) invalidData('CREATIVE_RESOURCE_DATA_TOO_DEEP')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidData('CREATIVE_RESOURCE_DATA_NUMBER_INVALID')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => parseJsonValue(item, depth + 1, nodes))
  if (!isRecord(value)) invalidData('CREATIVE_RESOURCE_DATA_VALUE_INVALID')
  const output: Record<string, CreativeResourceJsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      invalidData('CREATIVE_RESOURCE_DATA_KEY_FORBIDDEN', { key })
    }
    output[key] = parseJsonValue(child, depth + 1, nodes)
  }
  return output
}

export function parseCreativeResourceDataValueJson(valueJson: string): CreativeResourceJsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(valueJson)
  } catch {
    invalidData('CREATIVE_RESOURCE_DATA_VALUE_JSON_INVALID', { field: 'edits.valueJson' })
  }
  return parseJsonValue(parsed, 0, { count: 0 })
}

function requirePath(path: readonly string[]): readonly string[] {
  if (path.length === 0 || path.length > MAX_EDIT_PATH_SEGMENTS) {
    invalidData('CREATIVE_RESOURCE_DATA_PATH_INVALID', { path })
  }
  for (const segment of path) {
    if (
      !segment
      || segment.length > MAX_EDIT_PATH_SEGMENT_LENGTH
      || FORBIDDEN_PATH_SEGMENTS.has(segment)
    ) {
      invalidData('CREATIVE_RESOURCE_DATA_PATH_INVALID', { path })
    }
  }
  return path
}

function cloneDocument(document: CreativeResourceJsonObject): Record<string, CreativeResourceJsonValue> {
  return parseJsonValue(JSON.parse(JSON.stringify(document)), 0, { count: 0 }) as Record<string, CreativeResourceJsonValue>
}

function requireParent(
  document: Record<string, CreativeResourceJsonValue>,
  path: readonly string[],
  createMissing: boolean,
): Record<string, CreativeResourceJsonValue> | null {
  let parent = document
  for (const segment of path.slice(0, -1)) {
    const current = parent[segment]
    if (current === undefined) {
      if (!createMissing) return null
      const created: Record<string, CreativeResourceJsonValue> = {}
      parent[segment] = created
      parent = created
      continue
    }
    if (!isRecord(current)) {
      invalidData('CREATIVE_RESOURCE_DATA_PATH_PARENT_NOT_OBJECT', { path, segment })
    }
    parent = current as Record<string, CreativeResourceJsonValue>
  }
  return parent
}

function assertDocumentSize(document: CreativeResourceJsonObject): void {
  const bytes = Buffer.byteLength(JSON.stringify(document), 'utf8')
  if (bytes > MAX_CREATIVE_DATA_BYTES) {
    invalidData('CREATIVE_RESOURCE_DATA_TOO_LARGE', {
      requestedValue: bytes,
      allowedValues: [MAX_CREATIVE_DATA_BYTES],
    })
  }
  parseJsonValue(document, 0, { count: 0 })
}

export function applyCreativeResourceDataEdits(
  document: CreativeResourceJsonObject,
  edits: readonly CreativeResourceDataEdit[],
): { readonly document: CreativeResourceJsonObject; readonly changedPaths: readonly string[] } {
  const next = cloneDocument(document)
  const changedPaths: string[] = []
  for (const edit of edits) {
    const path = requirePath(edit.path)
    const parent = requireParent(next, path, edit.op === 'set')
    if (!parent) continue
    const key = path[path.length - 1]
    if (!key) invalidData('CREATIVE_RESOURCE_DATA_PATH_INVALID', { path })
    if (edit.op === 'remove') {
      if (Object.prototype.hasOwnProperty.call(parent, key)) {
        delete parent[key]
        changedPaths.push(`/${path.join('/')}`)
      }
      continue
    }
    const prior = parent[key]
    if (JSON.stringify(prior) !== JSON.stringify(edit.value)) {
      parent[key] = edit.value
      changedPaths.push(`/${path.join('/')}`)
    }
  }
  assertDocumentSize(next)
  return { document: next, changedPaths }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalidData('CREATIVE_RESOURCE_DATA_REFERENCE_INVALID', { field })
  }
  return value.trim()
}

function collectEmbeddedRefs(
  value: CreativeResourceJsonValue,
  refs: EmbeddedCreativeResourceRef[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEmbeddedRefs(item, refs))
    return
  }
  if (!isRecord(value)) return
  if (Object.prototype.hasOwnProperty.call(value, '$resourceRef')) {
    if (Object.keys(value).length !== 1 || !isRecord(value.$resourceRef)) {
      invalidData('CREATIVE_RESOURCE_DATA_REFERENCE_INVALID', { field: '$resourceRef' })
    }
    const raw = value.$resourceRef
    const keys = Object.keys(raw).sort()
    if (JSON.stringify(keys) !== JSON.stringify(['resourceId'])) {
      invalidData('CREATIVE_RESOURCE_DATA_REFERENCE_INVALID', { field: '$resourceRef' })
    }
    refs.push({
      resourceId: requireString(raw.resourceId, '$resourceRef.resourceId'),
    })
    return
  }
  Object.values(value).forEach((child) => collectEmbeddedRefs(child as CreativeResourceJsonValue, refs))
}

function toInputJsonValue(value: CreativeResourceJsonObject): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

export async function editCreativeResourceDataInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
    readonly expectedVersion: number
    readonly edits: readonly CreativeResourceDataEdit[]
  },
): Promise<{
  readonly resourceId: string
  readonly creativeData: CreativeResourceJsonObject
  readonly creativeDataVersion: number
  readonly changedPaths: readonly string[]
}> {
  const resource = await tx.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      OR: [{ projectId: input.projectId }, { projectId: null }],
    },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      scopeKind: true,
      scopeId: true,
      creativeData: true,
      creativeDataVersion: true,
    },
  })
  if (!resource) {
    throw new ApiError('NOT_FOUND', {
      code: 'CREATIVE_RESOURCE_NOT_FOUND',
      field: 'resourceId',
    })
  }
  if (resource.creativeDataVersion !== input.expectedVersion) {
    throw new ApiError('CONFLICT', {
      code: 'CREATIVE_RESOURCE_DATA_VERSION_CONFLICT',
      field: 'expectedVersion',
      expectedVersion: input.expectedVersion,
      actualVersion: resource.creativeDataVersion,
      agentRetryableAfterCorrection: true,
    })
  }
  const currentValue = resource.creativeData ?? {}
  const parsedCurrent = parseJsonValue(currentValue, 0, { count: 0 })
  if (!isRecord(parsedCurrent)) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'CREATIVE_RESOURCE_DATA_ROOT_INVALID',
      resourceId: resource.id,
    })
  }
  const result = applyCreativeResourceDataEdits(
    parsedCurrent as CreativeResourceJsonObject,
    input.edits,
  )
  const embeddedRefs: EmbeddedCreativeResourceRef[] = []
  collectEmbeddedRefs(result.document, embeddedRefs)
  const referenceInputs: CreativeResourceInputRef[] = embeddedRefs.map((reference, position) => ({
    ...reference,
    role: 'creative_data_reference',
    position,
  }))
  if (!isCreativeResourceScopeKind(resource.scopeKind)) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'CREATIVE_RESOURCE_SCOPE_KIND_INVALID',
      resourceId: resource.id,
    })
  }
  await validateCreativeResourceInputReferencesInTransaction(tx, {
    kind: resource.scopeKind,
    id: resource.scopeId,
    userId: resource.userId,
    projectId: resource.projectId,
    episodeId: resource.episodeId,
  }, referenceInputs)

  const nextVersion = result.changedPaths.length > 0
    ? resource.creativeDataVersion + 1
    : resource.creativeDataVersion
  const update = await tx.creativeResource.updateMany({
    where: {
      id: resource.id,
      userId: input.userId,
      creativeDataVersion: input.expectedVersion,
    },
    data: result.changedPaths.length > 0
      ? {
          creativeData: toInputJsonValue(result.document),
          creativeDataVersion: nextVersion,
        }
      : { creativeDataVersion: resource.creativeDataVersion },
  })
  if (update.count !== 1) {
    throw new ApiError('CONFLICT', {
      code: 'CREATIVE_RESOURCE_DATA_VERSION_CONFLICT',
      field: 'expectedVersion',
      expectedVersion: input.expectedVersion,
      agentRetryableAfterCorrection: true,
    })
  }
  return {
    resourceId: resource.id,
    creativeData: result.document,
    creativeDataVersion: nextVersion,
    changedPaths: result.changedPaths,
  }
}
