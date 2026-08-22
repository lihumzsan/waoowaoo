import type { AssistantRuntimeSelectedResourceReference } from './contracts'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import { readWorkspaceResource } from '@/lib/workspace-resource/view-service'

const selectedResourceMediaTypes = new Set<AssistantRuntimeSelectedResourceReference['mediaType']>([
  'text',
  'image',
  'audio',
  'video',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(code)
  }
  return value
}

/**
 * Converts the authoritative workspace view into the immutable resource identity
 * stored with an assistant turn. The path and name are context only; the stable
 * identity is resourceId plus contentVersion.
 */
export function toAssistantRuntimeSelectedResourceReference(
  resource: Pick<
    WorkspaceResourceView,
    'resourceId' | 'contentVersion' | 'workspacePath' | 'name' | 'resourceKind' | 'mediaType'
  >,
): AssistantRuntimeSelectedResourceReference {
  if (
    resource.resourceKind !== 'file'
    || resource.mediaType === null
    || !selectedResourceMediaTypes.has(resource.mediaType)
    || !Number.isSafeInteger(resource.contentVersion)
    || resource.contentVersion < 1
  ) {
    throw new Error('ASSISTANT_RUNTIME_SELECTED_RESOURCE_NOT_READY')
  }

  return {
    resourceId: resource.resourceId,
    contentVersion: resource.contentVersion,
    workspacePath: resource.workspacePath,
    name: resource.name,
    mediaType: resource.mediaType,
  }
}

export async function resolveAssistantRuntimeSelectedResourceReference(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
}): Promise<AssistantRuntimeSelectedResourceReference> {
  let resource: WorkspaceResourceView
  try {
    resource = await readWorkspaceResource(input)
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_RESOURCE_NOT_FOUND') {
      throw new Error('ASSISTANT_RUNTIME_SELECTED_RESOURCE_NOT_FOUND')
    }
    throw error
  }
  return toAssistantRuntimeSelectedResourceReference(resource)
}

export function parseAssistantRuntimeSelectedResourceReference(
  value: unknown,
  code = 'ASSISTANT_RUNTIME_SELECTED_RESOURCE_INVALID',
): AssistantRuntimeSelectedResourceReference | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error(code)

  const resourceId = readString(value.resourceId, code)
  const workspacePath = readString(value.workspacePath, code)
  const name = readString(value.name, code)
  const contentVersion = value.contentVersion
  const mediaType = value.mediaType
  if (
    typeof contentVersion !== 'number'
    || !Number.isSafeInteger(contentVersion)
    || contentVersion < 1
    || typeof mediaType !== 'string'
    || !selectedResourceMediaTypes.has(mediaType as AssistantRuntimeSelectedResourceReference['mediaType'])
  ) {
    throw new Error(code)
  }

  return {
    resourceId,
    contentVersion,
    workspacePath,
    name,
    mediaType: mediaType as AssistantRuntimeSelectedResourceReference['mediaType'],
  }
}

/**
 * This is part of the user turn, rather than a UI-only selection chip. It gives
 * the model an exact, versioned video/audio/text identity without attaching bytes.
 */
export function formatAssistantRuntimeSelectedResourceReference(
  resource: AssistantRuntimeSelectedResourceReference,
): string {
  return [
    '<wao_selected_workspace_resource>',
    `resource_id: ${resource.resourceId}`,
    `content_version: ${resource.contentVersion}`,
    `workspace_path: ${JSON.stringify(resource.workspacePath)}`,
    `name: ${JSON.stringify(resource.name)}`,
    `media_type: ${resource.mediaType}`,
    'This is the user-selected workspace resource for the current turn. Use resource_id and content_version when calling workspace resource tools; do not infer a different resource from its display name.',
    '</wao_selected_workspace_resource>',
  ].join('\n')
}
