import type { CreativeResourceCardView, CreativeResourceView } from '@/lib/creative-resource/contracts'
import {
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
} from '../lifecycle/workspace-canvas-resource-lifecycle'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
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
const RESOURCE_WIDTH = 400
const RESOURCE_HEIGHT = 500
const RESOURCE_CARD_DEFINITION = getWorkspaceCanvasNodeDefinition('resourceCard')

function resourcePresentation(resource: CreativeResourceView) {
  if (resource.status === 'ready') return workspaceCanvasSucceededResourcePresentation()
  if (resource.status === 'failed') return workspaceCanvasFailedResourcePresentation()
  if (resource.status === 'canceled') return workspaceCanvasResourcePresentation('canceled')
  return workspaceCanvasPendingResourcePresentation()
}

function groupingKey(card: CreativeResourceCardView): string {
  return card.resource.candidateSetId ?? card.resource.resourceId
}

export function appendWorkspaceResourceProjection(context: WorkspaceNodeProjectionContext): void {
  const { projectId, episodeName, creativeResources, savedLayouts, translate, nodes, edges } = context
  if (creativeResources.length === 0) return
  const cardsByGroup = new Map<string, CreativeResourceCardView>()
  for (const card of creativeResources) {
    if (!cardsByGroup.has(groupingKey(card))) cardsByGroup.set(groupingKey(card), card)
  }
  const cards = Array.from(cardsByGroup.values())
  const sectionY = RESOURCE_SECTION_GAP
  const nodeIdByResourceId = new Map<string, string>()

  cards.forEach((card, index) => {
    const groupResources = card.candidates?.resources ?? [card.resource]
    const nodeId = workspaceNodeId.resourceCard(groupingKey(card))
    groupResources.forEach((resource) => nodeIdByResourceId.set(resource.resourceId, nodeId))
    const column = index % RESOURCE_COLUMNS
    const row = Math.floor(index / RESOURCE_COLUMNS)
    nodes.push(createNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, {
        x: 260 + column * RESOURCE_COLUMN_GAP,
        y: sectionY + row * RESOURCE_ROW_GAP,
      }),
      width: RESOURCE_WIDTH,
      height: RESOURCE_HEIGHT,
      data: {
        projectId,
        episodeName,
        kind: 'resourceCard',
        layoutNodeType: 'resourceCard',
        targetType: 'creativeResource',
        targetId: card.resource.resourceId,
        title: card.resource.name,
        eyebrow: translate('nodes.resourceCard.eyebrow', { type: card.resource.mediaType }),
        body: card.resource.headRevision?.provenance.prompt
          ?? card.resource.pendingGeneration?.prompt
          ?? translate('nodes.resourceCard.body'),
        meta: card.resource.schemaId,
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
    for (const input of card.resource.headRevision?.inputs ?? []) {
      const sourceNodeId = nodeIdByResourceId.get(input.resourceId)
      if (!sourceNodeId || sourceNodeId === targetNodeId) continue
      const edgeId = `resource-lineage:${input.revisionId}:${targetNodeId}:${input.role}:${String(input.position)}`
      if (edgeIds.has(edgeId)) continue
      edgeIds.add(edgeId)
      edges.push(createEdge(edgeId, sourceNodeId, targetNodeId))
    }
  }
}
