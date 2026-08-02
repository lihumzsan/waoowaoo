import type {
  WorkspaceResourceAlternativeMemberView,
  WorkspaceResourceContent,
  WorkspaceResourceMediaType,
  WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'
import type {
  WorkspaceCanvasResourceFileView,
  WorkspaceCanvasResourceSummaryView,
  WorkspaceResourceCardMemberView,
  WorkspaceResourceCardView,
} from '../contracts/workspace-canvas-interactions'
import {
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
} from '../lifecycle/workspace-canvas-resource-lifecycle'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
import {
  resolveWorkspaceCanvasMediaShell,
  resolveWorkspaceCanvasNodeSize,
} from '../node-presentation-profiles'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import { createEdge, createNode, layoutPosition } from './workspace-node-projection-shared'

const RESOURCE_COLUMNS = 3
const RESOURCE_COLUMN_GAP = 460
const RESOURCE_ROW_GAP = 620
const RESOURCE_SECTION_GAP = 180
const FOLDER_WIDTH = 320
const FOLDER_HEIGHT = 174
const RESOURCE_CARD_DEFINITION = getWorkspaceCanvasNodeDefinition('resourceCard')

function resourcePresentation(resource: WorkspaceResourceView) {
  if (resource.status === 'ready') return workspaceCanvasSucceededResourcePresentation()
  if (resource.status === 'failed') return workspaceCanvasFailedResourcePresentation()
  if (resource.status === 'canceled') return workspaceCanvasResourcePresentation('canceled')
  return workspaceCanvasPendingResourcePresentation()
}

function requireFileResource(resource: WorkspaceResourceView): WorkspaceCanvasResourceFileView {
  if (resource.resourceKind !== 'file' || resource.mediaType === null) {
    throw new Error(`WORKSPACE_CANVAS_FILE_RESOURCE_INVALID:${resource.resourceId}`)
  }
  return resource as WorkspaceCanvasResourceFileView
}

function structuredEntryCount(content: WorkspaceResourceContent): number | null {
  if (content.kind !== 'structured') return null
  if (Array.isArray(content.data)) return content.data.length
  if (content.data && typeof content.data === 'object') return Object.keys(content.data).length
  return null
}

function resourceSummary(resource: WorkspaceCanvasResourceFileView): WorkspaceCanvasResourceSummaryView {
  const content = resource.current?.content
  if (content?.kind === 'text') return { kind: 'text', text: content.text }
  if (content?.kind === 'structured') {
    return { kind: 'structured', entryCount: structuredEntryCount(content), preview: null }
  }
  if (content?.kind === 'media') {
    return {
      kind: 'media',
      mediaType: resource.mediaType,
      url: content.url,
      mimeType: content.mimeType,
      width: content.width,
      height: content.height,
      durationMs: content.durationMs,
    }
  }
  if (resource.summary.kind === 'text') {
    return resource.summary.preview ? { kind: 'text', text: resource.summary.preview } : { kind: 'empty' }
  }
  if (resource.summary.kind === 'structured') {
    return {
      kind: 'structured',
      entryCount: null,
      preview: resource.summary.preview,
    }
  }
  if (resource.summary.kind === 'media') {
    return {
      kind: 'media',
      mediaType: resource.mediaType,
      url: resource.summary.url,
      mimeType: resource.summary.mimeType,
      width: resource.summary.width,
      height: resource.summary.height,
      durationMs: resource.summary.durationMs,
    }
  }
  return { kind: 'empty' }
}

function memberName(member: WorkspaceResourceAlternativeMemberView): string {
  return member.name
}

function alternativeMember(
  member: WorkspaceResourceAlternativeMemberView,
  fallbackMediaType: WorkspaceResourceMediaType,
): WorkspaceResourceCardMemberView | null {
  const mediaType = member.mediaType ?? fallbackMediaType
  if (mediaType === 'text' && member.previewUrl === null) return null
  return {
    resource: {
      resourceId: member.resourceId,
      name: memberName(member),
      status: member.status,
      mediaType,
      error: null,
    },
    inputSummaries: [],
    download: member.previewUrl ? { href: member.previewUrl, fileName: memberName(member) } : null,
    presentation: {
      rendererKey: 'resourceCard',
      fallbackMediaType: mediaType,
      summary: member.previewUrl ? {
        kind: 'media',
        mediaType,
        url: member.previewUrl,
        mimeType: null,
        width: null,
        height: null,
        durationMs: null,
      } : { kind: 'empty' },
    },
  }
}

function resourceCard(resourceView: WorkspaceResourceView): WorkspaceResourceCardView {
  const resource = requireFileResource(resourceView)
  const download = resource.actions.find((action) => action.kind === 'download' && action.enabled && action.href)
  const operations = resource.actions.flatMap((action) => {
    if (
      (action.kind !== 'retry' && action.kind !== 'variant')
      || !action.enabled
      || !action.operationId
      || !action.input
    ) return []
    return [{
      kind: action.kind,
      operationId: action.operationId,
      confirmation: 'billable_media' as const,
      input: action.input,
    }]
  })
  const primary: WorkspaceResourceCardMemberView = {
    resource,
    inputSummaries: resource.inputSummaries,
    download: download?.href ? { href: download.href, fileName: resource.name } : null,
    presentation: {
      rendererKey: 'resourceCard',
      fallbackMediaType: resource.mediaType,
      summary: resourceSummary(resource),
    },
  }
  const siblingMembers = resource.alternativeGroup?.members
    .filter((member) => member.resourceId !== resource.resourceId)
    .flatMap((member) => {
      const projected = alternativeMember(member, resource.mediaType)
      return projected ? [projected] : []
    }) ?? []
  const allAlternativeMembers = [primary, ...siblingMembers]
  const completeAlternativeGroup = resource.alternativeGroup
    && allAlternativeMembers.length === resource.alternativeGroup.total
  return {
    ...primary,
    resource,
    alternativeGroup: completeAlternativeGroup ? {
      groupId: resource.alternativeGroup.groupId,
      total: resource.alternativeGroup.total,
      members: allAlternativeMembers,
    } : null,
    canvasOperations: operations,
  }
}

function mediaDimensions(resource: WorkspaceCanvasResourceFileView) {
  const content = resource.current?.content
  if (content?.kind === 'media') {
    return { width: content.width, height: content.height }
  }
  return resource.summary.kind === 'media'
    ? { width: resource.summary.width, height: resource.summary.height }
    : { width: null, height: null }
}

export function appendWorkspaceResourceProjection(context: WorkspaceNodeProjectionContext): void {
  const { projectId, projectAspectRatio, workspaceResources, savedLayouts, translate, nodes, edges } = context
  if (workspaceResources.length === 0) return
  const nodeIdByResourceId = new Map<string, string>()

  workspaceResources.forEach((resource, index) => {
    const column = index % RESOURCE_COLUMNS
    const row = Math.floor(index / RESOURCE_COLUMNS)
    const fallback = {
      x: 260 + column * RESOURCE_COLUMN_GAP,
      y: RESOURCE_SECTION_GAP + row * RESOURCE_ROW_GAP,
    }
    if (resource.resourceKind === 'folder') {
      const nodeId = workspaceNodeId.folder(resource.resourceId)
      nodeIdByResourceId.set(resource.resourceId, nodeId)
      nodes.push(createNode({
        id: nodeId,
        position: layoutPosition(savedLayouts, nodeId, fallback),
        width: FOLDER_WIDTH,
        height: FOLDER_HEIGHT,
        data: {
          projectId,
          kind: 'folder',
          layoutNodeType: 'folder',
          targetType: 'folder',
          targetId: resource.resourceId,
          title: resource.name,
          eyebrow: translate('nodes.folder.eyebrow'),
          ...workspaceCanvasSucceededResourcePresentation(),
          runtimeTargets: [],
          folder: {
            resourceId: resource.resourceId,
            workspacePath: resource.workspacePath,
          },
        },
      }))
      return
    }

    const card = resourceCard(resource)
    const nodeId = workspaceNodeId.resourceCard(resource.resourceId)
    nodeIdByResourceId.set(resource.resourceId, nodeId)
    const dimensions = mediaDimensions(card.resource)
    const presentationInput = {
      kind: 'resourceCard' as const,
      mediaType: card.resource.mediaType,
      schemaId: card.resource.schemaId,
      generationOptions: card.resource.generationOptions,
      mediaWidth: dimensions.width,
      mediaHeight: dimensions.height,
      projectAspectRatio,
    }
    const mediaShell = resolveWorkspaceCanvasMediaShell(presentationInput)
    const size = resolveWorkspaceCanvasNodeSize(presentationInput)
    nodes.push(createNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, fallback),
      width: size.width,
      height: size.height,
      data: {
        projectId,
        kind: 'resourceCard',
        layoutNodeType: 'resourceCard',
        targetType: 'workspaceResource',
        targetId: resource.resourceId,
        title: resource.name,
        eyebrow: translate('nodes.resourceCard.eyebrow', {
          type: translate(`nodes.resourceCard.mediaType.${card.resource.mediaType}`),
        }),
        mediaShell,
        ...resourcePresentation(resource),
        runtimeTargets: [{
          targetType: 'WorkspaceResource',
          targetId: resource.resourceId,
          types: RESOURCE_CARD_DEFINITION.taskTypes,
        }],
        resourceDetails: card,
      },
    }))
  })

  const edgeIds = new Set(edges.map((edge) => edge.id))
  for (const resource of workspaceResources) {
    if (resource.resourceKind !== 'file') continue
    const targetNodeId = nodeIdByResourceId.get(resource.resourceId)
    if (!targetNodeId) continue
    for (const input of resource.inputs) {
      const sourceNodeId = nodeIdByResourceId.get(input.resourceId)
      if (!sourceNodeId || sourceNodeId === targetNodeId) continue
      const edgeId = `resource-lineage:${input.resourceId}:${targetNodeId}:${input.role}:${String(input.position)}`
      if (edgeIds.has(edgeId)) continue
      edgeIds.add(edgeId)
      edges.push(createEdge(edgeId, sourceNodeId, targetNodeId))
    }
  }
}
