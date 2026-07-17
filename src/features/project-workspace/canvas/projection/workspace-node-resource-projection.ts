import { TASK_TYPE } from '@/lib/task/types'
import type { CreativeResourceCardView, CreativeResourceView } from '@/lib/creative-resource/contracts'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { workspaceCanvasResourcePresentation } from '../lifecycle/workspace-canvas-resource-lifecycle'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import {
  createEdge,
  createNode,
  layoutPosition,
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
  workspaceNodeId,
} from './workspace-node-projection-shared'

const RESOURCE_COLUMNS = 3
const RESOURCE_COLUMN_GAP = 460
const RESOURCE_ROW_GAP = 620
const RESOURCE_SECTION_GAP = 180
const RESOURCE_WIDTH = 400
const RESOURCE_HEIGHT = 500

function resourcePresentation(resource: CreativeResourceView) {
  if (resource.status === 'ready') return workspaceCanvasSucceededResourcePresentation()
  if (resource.status === 'failed') return workspaceCanvasFailedResourcePresentation()
  if (resource.status === 'canceled') return workspaceCanvasResourcePresentation('canceled')
  return workspaceCanvasPendingResourcePresentation()
}

function groupingKey(card: CreativeResourceCardView): string {
  return card.resource.candidateSetId ?? card.resource.resourceId
}

function targetKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`
}

function readSnapshotString(card: CreativeResourceCardView, key: string): string | null {
  const content = card.resource.headRevision?.content
  if (content?.kind !== 'domain_snapshot' || !content.snapshot || typeof content.snapshot !== 'object' || Array.isArray(content.snapshot)) {
    return null
  }
  const value = content.snapshot[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function professionalTargetKeys(card: CreativeResourceCardView): readonly string[] {
  const origin = card.resource.origin
  if (!origin) return []
  const exact = targetKey(origin.sourceType, origin.sourceId)
  switch (origin.sourceType) {
    case 'ProjectEpisodeSourceDocument': {
      const editBibleId = readSnapshotString(card, 'editBibleId')
      return [
        exact,
        ...(editBibleId
          ? [
              targetKey('ProjectEditSourceScript', editBibleId),
              targetKey('editSourceScript', editBibleId),
            ]
          : []),
      ]
    }
    case 'ProjectEditBible':
      return [exact, targetKey('editBible', origin.sourceId)]
    case 'ProjectEditStylePreview':
      return [exact]
    case 'ProjectEditScript':
      return [exact, targetKey('editScript', origin.sourceId)]
    case 'ProjectEditShotExecutionPlan': {
      const editScriptId = readSnapshotString(card, 'editScriptId')
      return editScriptId
        ? [exact, targetKey('ProjectEditShotExecutionPlan', editScriptId), targetKey('editShotExecutionPlan', editScriptId)]
        : [exact]
    }
    case 'ProjectVideoSegment':
      return [exact, targetKey('videoSegment', origin.sourceId)]
    case 'ProjectEditBgmDesign':
    case 'ProjectEditMusicScore':
      return [exact, targetKey('ProjectEpisode', origin.sourceId), targetKey('episode', origin.sourceId)]
    default:
      return [exact]
  }
}

function alwaysUseOrdinaryMediaCard(card: CreativeResourceCardView): boolean {
  return card.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.RENDERED_VIDEO
    || card.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.CHAPTER_VIDEO
}

export function appendWorkspaceResourceProjection(context: WorkspaceNodeProjectionContext): void {
  const { projectId, episodeName, creativeResources, savedLayouts, translate, nodes, edges } = context
  if (creativeResources.length === 0) return
  const cardsByGroup = new Map<string, CreativeResourceCardView>()
  for (const card of creativeResources) {
    if (!cardsByGroup.has(groupingKey(card))) cardsByGroup.set(groupingKey(card), card)
  }
  const cards = Array.from(cardsByGroup.values())
  const sectionY = nodes.reduce((max, node) => Math.max(max, node.position.y + node.data.height), 0) + RESOURCE_SECTION_GAP
  const nodeIdByResourceId = new Map<string, string>()

  const professionalNodeIndexByTarget = new Map<string, number>()
  nodes.forEach((node, index) => {
    professionalNodeIndexByTarget.set(targetKey(node.data.targetType, node.data.targetId), index)
    for (const target of node.data.runtimeTargets ?? []) {
      professionalNodeIndexByTarget.set(targetKey(target.targetType, target.targetId), index)
    }
  })
  const genericCards: CreativeResourceCardView[] = []
  for (const card of cards) {
    const professionalNodeIndex = alwaysUseOrdinaryMediaCard(card)
      ? undefined
      : professionalTargetKeys(card)
          .map((key) => professionalNodeIndexByTarget.get(key))
          .find((index): index is number => index !== undefined)
    if (professionalNodeIndex === undefined) {
      genericCards.push(card)
      continue
    }
    const existing = nodes[professionalNodeIndex]
    if (!existing) throw new Error(`WORKSPACE_RESOURCE_PROFESSIONAL_NODE_MISSING:${card.resource.resourceId}`)
    nodes[professionalNodeIndex] = {
      ...existing,
      data: { ...existing.data, resourceDetails: card },
    }
    const groupResources = card.candidates?.resources ?? [card.resource]
    groupResources.forEach((resource) => nodeIdByResourceId.set(resource.resourceId, existing.id))
  }

  genericCards.forEach((card, index) => {
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
          types: [
            TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
            TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
            TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
            TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE,
          ],
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
