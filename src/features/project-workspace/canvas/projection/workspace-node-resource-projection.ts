import type { CreativeResourceCardView, CreativeResourceView } from '@/lib/creative-resource/contracts'
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
import {
  createEdge,
  createNode,
  layoutPosition,
} from './workspace-node-projection-shared'

const RESOURCE_COLUMNS = 3
const RESOURCE_COLUMN_GAP = 460
const RESOURCE_ROW_GAP = 620
const RESOURCE_SECTION_GAP = 180
const RESOURCE_CARD_DEFINITION = getWorkspaceCanvasNodeDefinition('resourceCard')

function resourcePresentation(resource: CreativeResourceView) {
  if (resource.status === 'ready') return workspaceCanvasSucceededResourcePresentation()
  if (resource.status === 'failed') return workspaceCanvasFailedResourcePresentation()
  if (resource.status === 'canceled') return workspaceCanvasResourcePresentation('canceled')
  return workspaceCanvasPendingResourcePresentation()
}

function groupingKey(card: CreativeResourceCardView): string {
  return card.resource.resourceId
}

function resourceGenerationOptions(resource: CreativeResourceView) {
  return resource.pendingGeneration?.generationOptions
    ?? resource.materialization?.provenance.generationOptions
    ?? null
}

function resourceMediaDimensions(resource: CreativeResourceView): {
  readonly width: number | null
  readonly height: number | null
} {
  const content = resource.materialization?.content
  return content?.kind === 'media'
    ? { width: content.width ?? null, height: content.height ?? null }
    : { width: null, height: null }
}

export function appendWorkspaceResourceProjection(context: WorkspaceNodeProjectionContext): void {
  const {
    projectId, episodeName, projectAspectRatio, creativeResources, savedLayouts, translate, nodes, edges,
  } = context
  if (creativeResources.length === 0) return
  const cardsByGroup = new Map<string, CreativeResourceCardView>()
  for (const card of creativeResources) {
    if (!cardsByGroup.has(groupingKey(card))) cardsByGroup.set(groupingKey(card), card)
  }
  const cards = Array.from(cardsByGroup.values())
  const sectionY = RESOURCE_SECTION_GAP
  const nodeIdByResourceId = new Map<string, string>()

  cards.forEach((card, index) => {
    const groupResources = [card.resource]
    const nodeId = workspaceNodeId.resourceCard(groupingKey(card))
    groupResources.forEach((resource) => nodeIdByResourceId.set(resource.resourceId, nodeId))
    const column = index % RESOURCE_COLUMNS
    const row = Math.floor(index / RESOURCE_COLUMNS)
    const mediaDimensions = resourceMediaDimensions(card.resource)
    const generationOptions = resourceGenerationOptions(card.resource)
    const mediaShell = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: card.resource.mediaType,
      schemaId: card.resource.schemaId,
      generationOptions,
      mediaWidth: mediaDimensions.width,
      mediaHeight: mediaDimensions.height,
      projectAspectRatio,
    })
    const size = resolveWorkspaceCanvasNodeSize({
      kind: 'resourceCard',
      mediaType: card.resource.mediaType,
      schemaId: card.resource.schemaId,
      generationOptions,
      mediaWidth: mediaDimensions.width,
      mediaHeight: mediaDimensions.height,
      projectAspectRatio,
    })
    nodes.push(createNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, {
        x: 260 + column * RESOURCE_COLUMN_GAP,
        y: sectionY + row * RESOURCE_ROW_GAP,
      }),
      width: size.width,
      height: size.height,
      data: {
        projectId,
        episodeName,
        kind: 'resourceCard',
        layoutNodeType: 'resourceCard',
        targetType: 'creativeResource',
        targetId: card.resource.resourceId,
        title: card.resource.name,
        eyebrow: translate('nodes.resourceCard.eyebrow', {
          type: translate(`nodes.resourceCard.mediaType.${card.resource.mediaType}`),
        }),
        mediaShell,
        ...resourcePresentation(card.resource),
        runtimeTargets: groupResources.map((resource) => ({
          targetType: 'CreativeResource',
          targetId: resource.resourceId,
          types: RESOURCE_CARD_DEFINITION.taskTypes,
        })),
        resourceDetails: card,
      },
    }))
  })

  const edgeIds = new Set(edges.map((edge) => edge.id))
  for (const card of cards) {
    const targetNodeId = nodeIdByResourceId.get(card.resource.resourceId)
    if (!targetNodeId) continue
    for (const input of card.resource.materialization?.inputs ?? []) {
      const sourceNodeId = nodeIdByResourceId.get(input.resourceId)
      if (!sourceNodeId || sourceNodeId === targetNodeId) continue
      const edgeId = `resource-lineage:${input.resourceId}:${targetNodeId}:${input.role}:${String(input.position)}`
      if (edgeIds.has(edgeId)) continue
      edgeIds.add(edgeId)
      edges.push(createEdge(edgeId, sourceNodeId, targetNodeId))
    }
  }
}
