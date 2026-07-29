'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WheelEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport,
  useReactFlow,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { logWarn as _ulogWarn } from '@/lib/logging/core'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import { useCreativeResources, useEpisodeData, useProjectData } from '@/lib/query/hooks'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import type { WorkspaceAssistantActiveFocusRequest } from '../workspace-assistant-focus'
import { useCanvasLayoutPersistence } from './hooks/useCanvasLayoutPersistence'
import {
  useWorkspaceNodeCanvasProjection,
} from './hooks/useWorkspaceNodeCanvasProjection'
import {
  resolveWorkspaceCanvasFocusNodeIds,
  useCanvasFocusFollow,
} from './hooks/useCanvasFocusFollow'
import { buildWorkspaceCanvasLayoutInput } from './canvasLayoutInput'
import {
  buildWorkspaceCanvasEdgeSignature,
  buildWorkspaceCanvasNodeSignature,
} from './hooks/canvas-projection-signature'
import {
  DEFAULT_WORKSPACE_CANVAS_VIEWPORT,
  getNextWorkspaceCanvasWheelZoom,
  WORKSPACE_CANVAS_MAX_ZOOM,
  WORKSPACE_CANVAS_MIN_ZOOM,
} from './canvasViewport'
import { isWorkspaceCanvasWheelLockedTarget } from './canvas-scroll-lock'
import { WorkspaceNodeDetailsCard } from './details/WorkspaceNodeDetailsCard'
import { workspaceNodeTypes } from './nodes/workspaceNodeTypes'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
} from './node-canvas-types'
import {
  collectWorkspaceNodeRuntimeTargets,
  resolveWorkspaceCanvasNodeData,
} from './workspace-node-runtime'

const EMPTY_SAVED_NODE_LAYOUTS: readonly CanvasNodeLayout[] = []
const CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX = 56
const WORKSPACE_REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const

export interface WorkspaceAssistantSelectionContext {
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
}

interface ProjectWorkspaceCanvasContentProps {
  onAssistantSelectionChange?: (selection: WorkspaceAssistantSelectionContext) => void
  activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
}

interface CanvasViewportControlsProps {
  readonly resetLabel: string
  readonly fitViewLabel: string
  readonly zoomInLabel: string
  readonly zoomOutLabel: string
  readonly autoFollowLabel: string
  readonly autoFollowEnabled: boolean
  readonly onResetLayout: () => void
  readonly onFitView: () => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onToggleAutoFollow: () => void
}

interface WorkspaceCanvasUserPosition {
  readonly x: number
  readonly y: number
}

function applyWorkspaceCanvasUserPositions(params: {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly positions: ReadonlyMap<string, WorkspaceCanvasUserPosition>
}): WorkspaceCanvasFlowNode[] {
  return params.nodes.map((node) => {
    const position = params.positions.get(node.id)
    if (!position) return node
    return {
      ...node,
      position,
      data: {
        ...node.data,
        layoutBasePosition: position,
      },
    }
  })
}

function CanvasViewportControls({
  resetLabel,
  fitViewLabel,
  zoomInLabel,
  zoomOutLabel,
  autoFollowLabel,
  autoFollowEnabled,
  onResetLayout,
  onFitView,
  onZoomIn,
  onZoomOut,
  onToggleAutoFollow,
}: CanvasViewportControlsProps) {
  const buttonClassName = 'inline-flex h-10 w-10 items-center justify-center border-r border-[var(--glass-stroke-soft)] text-[var(--glass-text-primary)] transition last:border-r-0 hover:bg-[var(--glass-bg-hover)]'
  const autoFollowClassName = autoFollowEnabled
    ? `${buttonClassName} bg-[var(--glass-bg-hover)] text-[var(--glass-tone-info-fg)]`
    : `${buttonClassName} text-[var(--glass-text-tertiary)]`

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 shadow-lg backdrop-blur-md">
      <button
        type="button"
        className={buttonClassName}
        aria-label={zoomInLabel}
        title={zoomInLabel}
        onClick={onZoomIn}
      >
        <AppIcon name="plus" className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label={zoomOutLabel}
        title={zoomOutLabel}
        onClick={onZoomOut}
      >
        <AppIcon name="minus" className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label={fitViewLabel}
        title={fitViewLabel}
        onClick={onFitView}
      >
        <AppIcon name="searchPlus" className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={autoFollowClassName}
        aria-label={autoFollowLabel}
        aria-pressed={autoFollowEnabled}
        title={autoFollowLabel}
        onClick={onToggleAutoFollow}
      >
        <AppIcon name="crosshair" className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label={resetLabel}
        title={resetLabel}
        onClick={onResetLayout}
      >
        <AppIcon name="refresh" className="h-4 w-4" />
      </button>
    </div>
  )
}

function ProjectWorkspaceCanvasContent({
  onAssistantSelectionChange,
  activeAssistantFocusRequest = null,
}: ProjectWorkspaceCanvasContentProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const { projectId, episodeId } = useWorkspaceProvider()
  const { data: episodeData } = useEpisodeData(projectId, episodeId ?? null)
  const episodeName = typeof episodeData?.name === 'string' ? episodeData.name : undefined
  const { data: projectData } = useProjectData(projectId)
  const projectAspectRatio = projectData?.videoRatio ?? null
  const { data: creativeResourcesResponse } = useCreativeResources(projectId, episodeId ?? null)
  const reactFlow = useReactFlow<WorkspaceCanvasFlowNode>()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [userNodePositions, setUserNodePositions] = useState<ReadonlyMap<string, WorkspaceCanvasUserPosition>>(() => new Map())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true)
  const [reactFlowReady, setReactFlowReady] = useState(false)
  const assistantSelectionSignatureRef = useRef<string | null>(null)
  const resolvedProjectedNodesRef = useRef<readonly WorkspaceCanvasFlowNode[]>([])
  const projectedFlowNodesRef = useRef<readonly WorkspaceCanvasFlowNode[]>([])
  const projectedFlowEdgesRef = useRef<readonly WorkspaceCanvasFlowEdge[]>([])
  const initialReactFlowNodesRef = useRef<WorkspaceCanvasFlowNode[] | null>(null)
  const initialReactFlowEdgesRef = useRef<WorkspaceCanvasFlowEdge[] | null>(null)
  const appliedProjectionSignatureRef = useRef<string | null>(null)
  const projectionSignatureRef = useRef('')
  const reactFlowRef = useRef(reactFlow)
  reactFlowRef.current = reactFlow
  const userNodePositionsRef = useRef<ReadonlyMap<string, WorkspaceCanvasUserPosition>>(new Map())

  const {
    layout,
    saveLayout,
    resetLayout: resetSavedLayout,
  } = useCanvasLayoutPersistence({
    projectId,
    episodeId: episodeId ?? '',
  })

  const savedNodeLayouts = layout?.nodeLayouts ?? EMPTY_SAVED_NODE_LAYOUTS
  const projection = useWorkspaceNodeCanvasProjection({
    projectId,
    episodeName,
    projectAspectRatio,
    creativeResources: creativeResourcesResponse?.resources ?? [],
    savedLayouts: savedNodeLayouts,
    translate: t,
  })
  const projectedNodes = projection.nodes
  const projectionEdges = projection.edges
  const workspaceRuntimeTargets = useMemo(
    () => collectWorkspaceNodeRuntimeTargets(projectedNodes),
    [projectedNodes],
  )
  const workspaceTaskStateMap = useTaskTargetStateMap(projectId, workspaceRuntimeTargets, {
    enabled: Boolean(projectId && workspaceRuntimeTargets.length > 0),
    staleTime: 1000,
  })
  const attachNodeUiState = useCallback((inputNodes: readonly WorkspaceCanvasFlowNode[]) => {
    return inputNodes.map((node) => {
      const resolvedData = resolveWorkspaceCanvasNodeData({
        node,
        statesByQueryKey: workspaceTaskStateMap.byQueryKey,
      })
      const zIndex = node.id === selectedNodeId ? 30 : undefined
      return {
        ...node,
        zIndex,
        data: { ...resolvedData },
      }
    })
  }, [
    selectedNodeId,
    workspaceTaskStateMap.byQueryKey,
  ])
  const resolvedProjectedNodes = useMemo(
    () => attachNodeUiState(projectedNodes),
    [attachNodeUiState, projectedNodes],
  )
  resolvedProjectedNodesRef.current = resolvedProjectedNodes
  userNodePositionsRef.current = userNodePositions
  const candidateFlowNodes = useMemo(() => applyWorkspaceCanvasUserPositions({
    nodes: resolvedProjectedNodes,
    positions: userNodePositions,
  }), [resolvedProjectedNodes, userNodePositions])
  const flowNodeSignature = useMemo(
    () => buildWorkspaceCanvasNodeSignature(candidateFlowNodes),
    [candidateFlowNodes],
  )
  const flowNodes = candidateFlowNodes
  if (initialReactFlowNodesRef.current === null) initialReactFlowNodesRef.current = [...flowNodes]
  projectedFlowNodesRef.current = flowNodes

  const projectionNodeSignature = useMemo(
    () => buildWorkspaceCanvasNodeSignature(resolvedProjectedNodes),
    [resolvedProjectedNodes],
  )
  const projectionEdgeSignature = useMemo(
    () => buildWorkspaceCanvasEdgeSignature(projectionEdges),
    [projectionEdges],
  )
  projectedFlowEdgesRef.current = projectionEdges
  if (initialReactFlowEdgesRef.current === null) initialReactFlowEdgesRef.current = [...projectionEdges]
  projectionSignatureRef.current = `${flowNodeSignature}\n--edges--\n${projectionEdgeSignature}`
  const syncProjectionToReactFlow = useCallback((flow = reactFlowRef.current) => {
    const signature = projectionSignatureRef.current
    if (appliedProjectionSignatureRef.current === signature) return
    appliedProjectionSignatureRef.current = signature
    flow.setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node] as const))
      return projectedFlowNodesRef.current.map((node) => {
        const current = currentById.get(node.id)
        return current?.measured
          ? { ...node, measured: current.measured }
          : node
      })
    })
    flow.setEdges([...projectedFlowEdgesRef.current])
  }, [])
  const handleReactFlowInit = useCallback((flow: typeof reactFlow) => {
    reactFlowRef.current = flow
    setReactFlowReady(true)
  }, [])
  useEffect(() => {
    if (!reactFlowReady) return
    syncProjectionToReactFlow()
  }, [flowNodeSignature, projectionEdgeSignature, reactFlowReady, syncProjectionToReactFlow])
  const focusNodeIds = useMemo(
    () => resolveWorkspaceCanvasFocusNodeIds(flowNodes),
    [flowNodes],
  )
  const focusRequestKey = focusNodeIds.length > 0
    ? activeAssistantFocusRequest?.requestKey ?? null
    : null
  const {
    pendingFocusNodeIds,
    focusNow: focusCurrentRunningNodes,
    notifyUserInteraction: notifyCanvasUserInteraction,
  } = useCanvasFocusFollow({
    reactFlow,
    containerRef: canvasRef,
    enabled: autoFollowEnabled,
    focusNodeIds,
    focusRequestKey,
  })

  useEffect(() => {
    const projectedNodeIds = new Set(projectedNodes.map((node) => node.id))
    setUserNodePositions((current) => {
      let changed = false
      const next = new Map<string, WorkspaceCanvasUserPosition>()
      current.forEach((position, nodeId) => {
        if (projectedNodeIds.has(nodeId)) {
          next.set(nodeId, position)
        } else {
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [projectedNodes, projectionNodeSignature])

  const persistCurrentLayout = useCallback(async (nextNodes: readonly WorkspaceCanvasFlowNode[]) => {
    if (!episodeId) return

    const input = buildWorkspaceCanvasLayoutInput({
      episodeId,
      nodes: nextNodes,
    })

    await saveLayout(input)
  }, [episodeId, saveLayout])

  const persistCurrentLayoutSafely = useCallback((nextNodes: readonly WorkspaceCanvasFlowNode[]) => {
    void persistCurrentLayout(nextNodes).catch((error: unknown) => {
      _ulogWarn('[ProjectWorkspaceCanvas] canvas layout save failed', error)
    })
  }, [persistCurrentLayout])

  const handleNodeDragStart = useCallback<OnNodeDrag<WorkspaceCanvasFlowNode>>(() => {
    notifyCanvasUserInteraction()
  }, [notifyCanvasUserInteraction])

  const applyUserNodePositions = useCallback((nodes: readonly WorkspaceCanvasFlowNode[]) => {
    setUserNodePositions((current) => {
      const next = new Map(current)
      nodes.forEach((node) => {
        next.set(node.id, { x: node.position.x, y: node.position.y })
      })
      return next
    })
  }, [])

  const handleNodeDrag = useCallback<OnNodeDrag<WorkspaceCanvasFlowNode>>((_event, node, draggedNodes) => {
    applyUserNodePositions([node, ...draggedNodes])
  }, [applyUserNodePositions])

  const handleNodeDragStop = useCallback<OnNodeDrag<WorkspaceCanvasFlowNode>>((_event, node, draggedNodes) => {
    notifyCanvasUserInteraction()
    const movedNodes = [node, ...draggedNodes]
    const nextPositions = new Map(userNodePositionsRef.current)
    movedNodes.forEach((movedNode) => {
      nextPositions.set(movedNode.id, { x: movedNode.position.x, y: movedNode.position.y })
    })
    applyUserNodePositions(movedNodes)
    const nextNodes = applyWorkspaceCanvasUserPositions({
      nodes: resolvedProjectedNodesRef.current,
      positions: nextPositions,
    })
    persistCurrentLayoutSafely(nextNodes)
  }, [applyUserNodePositions, notifyCanvasUserInteraction, persistCurrentLayoutSafely])

  const handleNodeClick = useCallback<NodeMouseHandler<WorkspaceCanvasFlowNode>>((_event, node) => {
    setSelectedNodeId(node.id)
  }, [])
  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])
  const handleMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) notifyCanvasUserInteraction()
  }, [notifyCanvasUserInteraction])
  const handleMoveEnd = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) notifyCanvasUserInteraction()
  }, [notifyCanvasUserInteraction])

  const applyWheelZoom = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (isWorkspaceCanvasWheelLockedTarget(event.target)) return

    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return

    event.preventDefault()

    const viewport = reactFlow.getViewport()
    const nextZoom = getNextWorkspaceCanvasWheelZoom(viewport.zoom, event.deltaY)
    if (nextZoom === viewport.zoom) return
    notifyCanvasUserInteraction()

    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    const zoomRatio = nextZoom / viewport.zoom
    const nextViewport: Viewport = {
      x: pointerX - (pointerX - viewport.x) * zoomRatio,
      y: pointerY - (pointerY - viewport.y) * zoomRatio,
      zoom: nextZoom,
    }

    void reactFlow.setViewport(nextViewport)
  }, [notifyCanvasUserInteraction, reactFlow])

  const resetLayout = useCallback(() => {
    if (!episodeId) return
    setUserNodePositions(new Map())
    void resetSavedLayout().catch((error: unknown) => {
      _ulogWarn('[ProjectWorkspaceCanvas] canvas layout reset failed', error)
    })
  }, [episodeId, resetSavedLayout])

  const fitView = useCallback(() => {
    notifyCanvasUserInteraction()
    void reactFlow.fitView({ padding: 0.14, duration: 180 })
  }, [notifyCanvasUserInteraction, reactFlow])
  const zoomIn = useCallback(() => {
    notifyCanvasUserInteraction()
    void reactFlow.zoomIn({ duration: 160 })
  }, [notifyCanvasUserInteraction, reactFlow])
  const zoomOut = useCallback(() => {
    notifyCanvasUserInteraction()
    void reactFlow.zoomOut({ duration: 160 })
  }, [notifyCanvasUserInteraction, reactFlow])
  const toggleAutoFollow = useCallback(() => {
    setAutoFollowEnabled((current) => !current)
  }, [])
  const selectedNode = useMemo(
    () => flowNodes.find((node) => node.id === selectedNodeId) ?? null,
    [flowNodes, selectedNodeId],
  )
  const assistantSelection = useMemo<WorkspaceAssistantSelectionContext>(() => {
    if (!selectedNode) return {}
    const targetType = selectedNode.data.targetType
    const targetId = selectedNode.data.targetId
    return {
      selectedScopeRef: `${targetType}:${targetId}`,
      selectedAssetId: null,
    }
  }, [selectedNode])

  useEffect(() => {
    const signature = JSON.stringify(assistantSelection)
    if (assistantSelectionSignatureRef.current === signature) return
    assistantSelectionSignatureRef.current = signature
    onAssistantSelectionChange?.(assistantSelection)
  }, [assistantSelection, onAssistantSelectionChange])

  if (!episodeId) return null

  return (
    <div className="workspace-canvas-layout-animated h-full min-h-0 w-full overflow-hidden bg-[var(--glass-bg-canvas)]">
      <div ref={canvasRef} className="h-full" onWheelCapture={applyWheelZoom}>
        <ReactFlow
          defaultNodes={initialReactFlowNodesRef.current}
          defaultEdges={initialReactFlowEdgesRef.current}
          nodeTypes={workspaceNodeTypes}
          onInit={handleReactFlowInit}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onMoveStart={handleMoveStart}
          onMoveEnd={handleMoveEnd}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={WORKSPACE_CANVAS_MIN_ZOOM}
          maxZoom={WORKSPACE_CANVAS_MAX_ZOOM}
          zoomOnScroll={false}
          defaultViewport={DEFAULT_WORKSPACE_CANVAS_VIEWPORT}
          proOptions={WORKSPACE_REACT_FLOW_PRO_OPTIONS}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          {selectedNode ? <WorkspaceNodeDetailsCard node={selectedNode} /> : null}
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            bgColor="rgba(255,255,255,0.82)"
            maskColor="rgba(100,116,139,0.2)"
            maskStrokeColor="rgba(71,85,105,0.68)"
            nodeColor="rgba(148,163,184,0.7)"
            nodeStrokeColor="rgba(71,85,105,0.46)"
            nodeBorderRadius={10}
            offsetScale={0}
            className="!z-[60] !m-0 !overflow-hidden !rounded-[22px] !border-0 !bg-white/82 !shadow-lg !ring-1 !ring-[var(--glass-stroke-base)]/70 !backdrop-blur-2xl"
            style={{
              left: 16,
              bottom: CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX + 72,
              width: 180,
              height: 96,
            }}
          />
          <Panel
            position="bottom-left"
            className="!z-[70] !m-0"
            style={{
              left: 16,
              bottom: CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX + 16,
            }}
          >
            <CanvasViewportControls
              resetLabel={t('toolbar.resetLayout')}
              fitViewLabel={t('toolbar.fitView')}
              zoomInLabel={t('toolbar.zoomIn')}
              zoomOutLabel={t('toolbar.zoomOut')}
              autoFollowLabel={t('toolbar.autoFollow')}
              autoFollowEnabled={autoFollowEnabled}
              onResetLayout={resetLayout}
              onFitView={fitView}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onToggleAutoFollow={toggleAutoFollow}
            />
          </Panel>
          {pendingFocusNodeIds.length > 0 ? (
            <Panel
              position="bottom-right"
              className="!z-[70] !m-0"
              style={{ right: 16, bottom: CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX + 16 }}
            >
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 px-4 py-2 text-sm font-medium text-[var(--glass-text-primary)] shadow-lg backdrop-blur-md transition hover:bg-[var(--glass-bg-hover)]"
                onClick={focusCurrentRunningNodes}
              >
                <AppIcon name="crosshair" className="h-4 w-4" />
                {t('focusFollow.jumpToActive')}
              </button>
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
    </div>
  )
}

interface ProjectWorkspaceCanvasProps {
  onAssistantSelectionChange?: (selection: WorkspaceAssistantSelectionContext) => void
  activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
}

export default function ProjectWorkspaceCanvas({
  onAssistantSelectionChange,
  activeAssistantFocusRequest = null,
}: ProjectWorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProjectWorkspaceCanvasContent
        onAssistantSelectionChange={onAssistantSelectionChange}
        activeAssistantFocusRequest={activeAssistantFocusRequest}
      />
    </ReactFlowProvider>
  )
}
