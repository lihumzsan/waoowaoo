import type {
  WorkspaceResourceJsonObject,
  WorkspaceResourceJsonValue,
  WorkspaceResourceView,
} from './contracts'
import { contentKindFromPath } from './path'

const TEXT_MARKER_PREFIX = '<!-- wao-resource:'
const TEXT_MARKER_SUFFIX = ' -->'
const JSON_IDENTITY_KEY = '_waoResourceId'
const POINTER_PROTOCOL = 'wao_resource_pointer_v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function encodeEditableResourceFile(input: {
  readonly resourceId: string
  readonly workspacePath: string
  readonly content: string
}): string {
  const kind = contentKindFromPath(input.workspacePath)
  if (kind === 'pointer') throw new Error('WORKSPACE_RESOURCE_POINTER_CONTENT_REQUIRED')
  if (kind === 'text') {
    return `${TEXT_MARKER_PREFIX}${input.resourceId}${TEXT_MARKER_SUFFIX}\n${input.content}`
  }
  const parsed: unknown = JSON.parse(input.content)
  if (!isRecord(parsed)) throw new Error('WORKSPACE_RESOURCE_JSON_OBJECT_REQUIRED')
  if (Object.prototype.hasOwnProperty.call(parsed, JSON_IDENTITY_KEY)) {
    throw new Error('WORKSPACE_RESOURCE_SYSTEM_FIELD_FORBIDDEN')
  }
  return `${JSON.stringify({ [JSON_IDENTITY_KEY]: input.resourceId, ...parsed }, null, 2)}\n`
}

export function decodeEditableResourceFile(input: {
  readonly workspacePath: string
  readonly content: string
}): { readonly resourceId: string | null; readonly content: string } {
  const kind = contentKindFromPath(input.workspacePath)
  if (kind === 'pointer') throw new Error('WORKSPACE_RESOURCE_POINTER_UNEXPECTED')
  if (kind === 'text') {
    const newline = input.content.indexOf('\n')
    const firstLine = newline < 0 ? input.content : input.content.slice(0, newline)
    if (!firstLine.startsWith(TEXT_MARKER_PREFIX) || !firstLine.endsWith(TEXT_MARKER_SUFFIX)) {
      return { resourceId: null, content: input.content }
    }
    const resourceId = firstLine.slice(TEXT_MARKER_PREFIX.length, -TEXT_MARKER_SUFFIX.length).trim()
    if (!resourceId) throw new Error('WORKSPACE_RESOURCE_IDENTITY_MARKER_INVALID')
    return { resourceId, content: newline < 0 ? '' : input.content.slice(newline + 1) }
  }
  const parsed: unknown = JSON.parse(input.content)
  if (!isRecord(parsed)) throw new Error('WORKSPACE_RESOURCE_JSON_OBJECT_REQUIRED')
  const resourceId = typeof parsed[JSON_IDENTITY_KEY] === 'string'
    ? parsed[JSON_IDENTITY_KEY].trim() || null
    : null
  const content = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== JSON_IDENTITY_KEY))
  return { resourceId, content: `${JSON.stringify(content, null, 2)}\n` }
}

export function encodeMediaPointer(resource: WorkspaceResourceView): string {
  if (resource.resourceKind !== 'file' || !resource.mediaType) {
    throw new Error('WORKSPACE_RESOURCE_MEDIA_POINTER_FILE_REQUIRED')
  }
  const pointer: WorkspaceResourceJsonObject = {
    protocol: POINTER_PROTOCOL,
    resourceId: resource.resourceId,
    contentVersion: resource.contentVersion,
    mediaType: resource.mediaType,
    schemaId: resource.schemaId,
    name: resource.name,
    status: resource.status,
    taskId: resource.taskId,
    error: resource.error
      ? { code: resource.error.code }
      : null,
    prompt: resource.prompt,
    inputs: resource.inputs.map((entry): WorkspaceResourceJsonValue => ({
      workspacePath: entry.workspacePath,
      contentVersion: entry.contentVersion,
      role: entry.role,
      position: entry.position,
    })),
  }
  return `${JSON.stringify(pointer, null, 2)}\n`
}

export function decodeMediaPointer(content: string): { readonly resourceId: string } {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || parsed.protocol !== POINTER_PROTOCOL) {
    throw new Error('WORKSPACE_RESOURCE_POINTER_INVALID')
  }
  if (typeof parsed.resourceId !== 'string' || !parsed.resourceId.trim()) {
    throw new Error('WORKSPACE_RESOURCE_POINTER_INVALID')
  }
  return { resourceId: parsed.resourceId.trim() }
}
