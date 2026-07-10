'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyNodeChanges,
  Background,
  ReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import type { DemoProjectSnapshot } from '@/lib/demo/demo-snapshot'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import {
  getWorkspaceCanvasNodePresentationProfile,
  resolveWorkspaceCanvasNodeSize,
} from '@/features/project-workspace/canvas/node-presentation-profiles'
import { workspaceNodeTypes } from '@/features/project-workspace/canvas/nodes/workspaceNodeTypes'
import type {
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeRecord,
} from '@/features/project-workspace/canvas/node-canvas-types'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  composeWorkspaceCanvasLegacyLayout,
} from '@/features/project-workspace/canvas/layout/workspace-layout-composer'

const DEMO_NODE_TYPES: NodeTypes = workspaceNodeTypes
const DEMO_VIDEO_PLAN_ASPECT_RATIO = 16 / 9
const DEMO_EDIT_FIRST_WORKFLOW: EditFirstWorkflowState = {
  active: true,
  stage: 'ready_to_generate_videos',
  blocking: {
    kind: 'none',
    reason: null,
  },
  nextAction: null,
  allowedOperationIds: [],
}

function demoNodeDefaultExpanded(node: WorkspaceCanvasFlowNode): boolean {
  const profile = getWorkspaceCanvasNodePresentationProfile(node.data.kind)
  if (node.data.kind === 'bgmScore' && node.data.bgmScoreDetails?.mixUrl) return true
  return node.data.defaultExpanded ?? profile.defaultExpanded
}

function toReadOnlyNode(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly expanded: boolean
  readonly onToggleExpanded: (nodeId: string) => void
}): WorkspaceCanvasFlowNode {
  const { node, expanded, onToggleExpanded } = input
  const profile = getWorkspaceCanvasNodePresentationProfile(node.data.kind)
  const size = resolveWorkspaceCanvasNodeSize({
    kind: node.data.kind,
    expanded,
    collapsedSize: {
      width: node.data.width,
      height: node.data.height,
    },
  })
  const videoPlanDetails = node.data.kind === 'videoPlan' && node.data.videoPlanDetails?.outputUrl
    ? {
        ...node.data.videoPlanDetails,
        outputAspectRatio: DEMO_VIDEO_PLAN_ASPECT_RATIO,
      }
    : node.data.videoPlanDetails
  const readOnlyData: WorkspaceCanvasNodeRecord = {
    ...node.data,
    nodeId: node.data.nodeId ?? node.id,
    isRunning: false,
    expanded,
    expandedLayout: expanded ? profile.expandedLayout : undefined,
    previewAspectRatio: node.data.kind === 'videoPlan' && node.data.videoPlanDetails?.outputUrl
      ? DEMO_VIDEO_PLAN_ASPECT_RATIO
      : node.data.previewAspectRatio,
    videoPlanDetails,
    action: undefined,
    actionLabel: undefined,
    secondaryAction: undefined,
    secondaryActionLabel: undefined,
    actionDisabled: true,
    readOnly: true,
    onAction: undefined,
    onMeasureNodeSize: undefined,
    onToggleExpanded,
  }

  return {
    ...node,
    style: {
      ...node.style,
      width: size.width,
      height: size.height,
    },
    data: readOnlyData,
    draggable: true,
    selectable: true,
  }
}

function DemoProjectCanvasContent({ snapshot }: { readonly snapshot: DemoProjectSnapshot }) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const [nodeExpansionOverrides, setNodeExpansionOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [sourceNodes, setSourceNodes] = useState<WorkspaceCanvasFlowNode[]>([])

  const projection = useMemo(() => {
    return buildWorkspaceNodeCanvasProjection({
      projectId: snapshot.project.id,
      episodeId: snapshot.episode.id,
      episodeName: snapshot.episode.name,
      storyboards: snapshot.storyboards,
      editFirstWorkflow: DEMO_EDIT_FIRST_WORKFLOW,
      editBible: snapshot.editBible,
      editScript: snapshot.editScript,
      editScriptPending: false,
      finalVideo: snapshot.finalVideo,
      videoGroups: snapshot.videoGroups,
      defaultVideoModel: snapshot.project.singleShotVideoModel ?? snapshot.project.videoModel,
      defaultSequenceVideoModel: snapshot.project.sequenceVideoModel,
      savedLayouts: snapshot.layout?.nodeLayouts ?? [],
      translate: t,
    })
  }, [snapshot, t])

  const defaultExpandedByNodeId = useMemo(() => {
    return new Map(projection.nodes.map((node) => [node.id, demoNodeDefaultExpanded(node)]))
  }, [projection.nodes])

  const toggleNodeExpanded = useCallback((nodeId: string) => {
    setNodeExpansionOverrides((currentOverrides) => {
      const nextOverrides = new Map(currentOverrides)
      const currentExpanded = nextOverrides.get(nodeId) ?? defaultExpandedByNodeId.get(nodeId) ?? false
      nextOverrides.set(nodeId, !currentExpanded)
      return nextOverrides
    })
  }, [defaultExpandedByNodeId])

  const projectedNodes = useMemo(() => {
    const readOnlyNodes = projection.nodes.map((node) => {
      const expanded = nodeExpansionOverrides.get(node.id) ?? defaultExpandedByNodeId.get(node.id) ?? false
      return toReadOnlyNode({
        node,
        expanded,
        onToggleExpanded: toggleNodeExpanded,
      })
    })
    return composeWorkspaceCanvasLegacyLayout({
      nodes: readOnlyNodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(readOnlyNodes),
    })
  }, [defaultExpandedByNodeId, nodeExpansionOverrides, projection.nodes, toggleNodeExpanded])

  useEffect(() => {
    setSourceNodes(projectedNodes)
  }, [projectedNodes])

  const handleNodesChange = useCallback((changes: NodeChange<WorkspaceCanvasFlowNode>[]) => {
    setSourceNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
  }, [])

  return (
    <main className="h-dvh w-dvw overflow-hidden bg-slate-50">
      <ReactFlow
        nodes={sourceNodes}
        edges={[...projection.edges]}
        nodeTypes={DEMO_NODE_TYPES}
        onNodesChange={handleNodesChange}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.08}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#d8dee9" />
      </ReactFlow>
    </main>
  )
}

export default function DemoProjectCanvas({ snapshot }: { readonly snapshot: DemoProjectSnapshot }) {
  return (
    <ReactFlowProvider>
      <DemoProjectCanvasContent snapshot={snapshot} />
    </ReactFlowProvider>
  )
}
