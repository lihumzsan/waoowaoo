'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  WheelEvent,
} from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport,
  useReactFlow,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
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
import type { WorkspaceCanvasSelection } from './contracts/workspace-canvas-interactions'
import type {
  WorkspaceAssistantDraftRequest,
  WorkspaceCreativeResourceCardMemberView,
  WorkspaceCanvasResourceOperationView,
} from './contracts/workspace-canvas-interactions'
import { useCanvasOperationAction } from './actions/useCanvasOperationAction'
import { CanvasOperationConfirmationModal } from './actions/CanvasOperationConfirmationModal'
import { WorkspaceResourcePreviewModal } from './preview/WorkspaceResourcePreviewModal'
import { useCanvasResourceArchive } from './actions/useCanvasResourceArchive'
import { useCanvasActions } from '@/lib/query/hooks/useCanvasActions'
import { WorkspaceCanvasCreateDock } from './create/WorkspaceCanvasCreateDock'
import type {
  WorkspaceCanvasCreateCapabilityView,
  WorkspaceCanvasCreateRequest,
} from './contracts/workspace-canvas-interactions'
import { workspaceNodeId } from './workspace-canvas-node-ids'
import { useCanvasUploadQueue, type CanvasUploadQueueItem } from './upload/useCanvasUploadQueue'
import { CanvasUploadQueue } from './upload/CanvasUploadQueue'
import { CanvasViewportControls } from './controls/CanvasViewportControls'
import { buildWorkspaceCanvasCreateOperationInput } from './create/canvas-create-input'
import { useCanvasUploadBridge } from './upload/useCanvasUploadBridge'
import { useToast } from '@/contexts/ToastContext'

const EMPTY_SAVED_NODE_LAYOUTS: readonly CanvasNodeLayout[] = []
const CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX = 56
const WORKSPACE_REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const

interface ProjectWorkspaceCanvasContentProps {
  selection: WorkspaceCanvasSelection | null
  onSelectionChange: (selection: WorkspaceCanvasSelection | null) => void
  onAssistantDraftRequest: (request: WorkspaceAssistantDraftRequest) => void
  activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
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

function ProjectWorkspaceCanvasContent({
  selection,
  onSelectionChange,
  onAssistantDraftRequest,
  activeAssistantFocusRequest = null,
}: ProjectWorkspaceCanvasContentProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const { showError } = useToast()
  const { projectId, episodeId } = useWorkspaceProvider()
  const { data: episodeData } = useEpisodeData(projectId, episodeId ?? null)
  const episodeName = typeof episodeData?.name === 'string' ? episodeData.name : undefined
  const { data: projectData } = useProjectData(projectId)
  const projectAspectRatio = projectData?.videoRatio ?? null
  const {
    data: canvasActions,
    isLoading: canvasActionsLoading,
    isError: canvasActionsFailed,
    refetch: retryCanvasActions,
  } = useCanvasActions(projectId)
  const [createDrafts, setCreateDrafts] = useState<readonly {
    readonly id: string
    readonly position: WorkspaceCanvasCreateRequest['position']
  }[]>([])
  const { data: creativeResourcesResponse } = useCreativeResources(
    projectId,
    episodeId ?? null,
    { includeArchived: true },
  )
  const reactFlow = useReactFlow<WorkspaceCanvasFlowNode>()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [userNodePositions, setUserNodePositions] = useState<ReadonlyMap<string, WorkspaceCanvasUserPosition>>(() => new Map())
  const [hiddenNodeKeys, setHiddenNodeKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [preview, setPreview] = useState<{
    readonly members: readonly WorkspaceCreativeResourceCardMemberView[]
    readonly initialResourceId: string
  } | null>(null)
  const [reactFlowReady, setReactFlowReady] = useState(false)
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
  const hiddenNodeKeysRef = useRef<ReadonlySet<string>>(new Set())
  const layoutWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  hiddenNodeKeysRef.current = hiddenNodeKeys
  const pendingPlacementNodeIdsRef = useRef<Set<string>>(new Set())
  const operationAction = useCanvasOperationAction({
    projectId,
    episodeId: episodeId ?? null,
  })
  const archiveAction = useCanvasResourceArchive({ projectId })
  const placeUploadedResource = useCallback((item: CanvasUploadQueueItem, resourceId: string, reused: boolean) => {
    if (reused) return
    const nodeId = workspaceNodeId.resourceCard(resourceId)
    pendingPlacementNodeIdsRef.current.add(nodeId)
    setUserNodePositions((current) => {
      const next = new Map(current)
      next.set(nodeId, item.position)
      return next
    })
  }, [])
  const uploadQueue = useCanvasUploadQueue({
    projectId,
    onMaterialized: placeUploadedResource,
  })
  const {
    layout,
    saveLayout,
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
      const isSelected = node.id === selection?.nodeId
      return {
        ...node,
        zIndex: isSelected ? 30 : undefined,
        data: { ...resolvedData, uiSelected: isSelected },
      }
    })
  }, [
    selection?.nodeId,
    workspaceTaskStateMap.byQueryKey,
  ])
  const resolvedProjectedNodes = useMemo(
    () => attachNodeUiState(projectedNodes),
    [attachNodeUiState, projectedNodes],
  )
  resolvedProjectedNodesRef.current = resolvedProjectedNodes
  userNodePositionsRef.current = userNodePositions
  const visibleResolvedProjectedNodes = useMemo(
    () => resolvedProjectedNodes.filter((node) => (
      !hiddenNodeKeys.has(node.id)
      && !node.data.resourceDetails.resource.archivedAt
    )),
    [hiddenNodeKeys, resolvedProjectedNodes],
  )
  const candidateFlowNodes = useMemo(() => applyWorkspaceCanvasUserPositions({
    nodes: visibleResolvedProjectedNodes,
    positions: userNodePositions,
  }), [userNodePositions, visibleResolvedProjectedNodes])
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
  const visibleNodeIds = useMemo(() => new Set(flowNodes.map((node) => node.id)), [flowNodes])
  const visibleProjectionEdges = useMemo(
    () => projectionEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [projectionEdges, visibleNodeIds],
  )
  const projectionEdgeSignature = useMemo(
    () => buildWorkspaceCanvasEdgeSignature(visibleProjectionEdges),
    [visibleProjectionEdges],
  )
  projectedFlowEdgesRef.current = visibleProjectionEdges
  if (initialReactFlowEdgesRef.current === null) initialReactFlowEdgesRef.current = [...visibleProjectionEdges]
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
    () => resolveWorkspaceCanvasFocusNodeIds(
      flowNodes,
      activeAssistantFocusRequest?.taskTargets ?? [],
    ),
    [activeAssistantFocusRequest?.taskTargets, flowNodes],
  )
  const {
    notifyUserInteraction: notifyCanvasUserInteraction,
  } = useCanvasFocusFollow({
    reactFlow,
    containerRef: canvasRef,
    enabled: true,
    focusNodeIds,
    focusRequestKey: activeAssistantFocusRequest?.requestKey ?? null,
  })
  const {
    accept: uploadAccept,
    uploadInputRef,
    openPicker: openUploadPicker,
    handleInputChange: handleUploadInputChange,
    handleDrop: handleCanvasDrop,
    handlePaste: handleCanvasPaste,
    handleDragOver: handleCanvasDragOver,
  } = useCanvasUploadBridge({
    canvasRef,
    screenToFlowPosition: reactFlow.screenToFlowPosition,
    addFiles: uploadQueue.addFiles,
    onUserInteraction: notifyCanvasUserInteraction,
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

  useEffect(() => {
    setHiddenNodeKeys(new Set(
      savedNodeLayouts
        .filter((nodeLayout) => nodeLayout.hidden)
        .map((nodeLayout) => nodeLayout.nodeKey),
    ))
  }, [savedNodeLayouts])

  const persistCurrentLayout = useCallback(async (
    nextNodes: readonly WorkspaceCanvasFlowNode[],
    nextHiddenNodeKeys: ReadonlySet<string> = hiddenNodeKeysRef.current,
  ) => {
    if (!episodeId) return

    const input = buildWorkspaceCanvasLayoutInput({
      episodeId,
      nodes: nextNodes,
      hiddenNodeKeys: nextHiddenNodeKeys,
    })

    const write = layoutWriteChainRef.current
      .catch(() => undefined)
      .then(async () => { await saveLayout(input) })
    layoutWriteChainRef.current = write.catch(() => undefined)
    await write
  }, [episodeId, saveLayout])

  useEffect(() => {
    if (pendingPlacementNodeIdsRef.current.size === 0) return
    const projectedNodeIds = new Set(resolvedProjectedNodes.map((node) => node.id))
    const matched = [...pendingPlacementNodeIdsRef.current]
      .filter((nodeId) => projectedNodeIds.has(nodeId))
    if (matched.length === 0) return
    matched.forEach((nodeId) => pendingPlacementNodeIdsRef.current.delete(nodeId))
    const positionedNodes = applyWorkspaceCanvasUserPositions({
      nodes: resolvedProjectedNodes,
      positions: userNodePositionsRef.current,
    })
    void persistCurrentLayout(positionedNodes).catch((error: unknown) => {
      _ulogWarn('[ProjectWorkspaceCanvas] generated Resource placement save failed', error)
    })
  }, [persistCurrentLayout, resolvedProjectedNodes, userNodePositions])

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
    canvasRef.current?.focus()
    const summary = node.data.resourceDetails.presentation.summary
    onSelectionChange({
      nodeId: node.id,
      targetType: 'creativeResource',
      targetId: node.data.targetId,
      selectedScopeRef: `${node.data.targetType}:${node.data.targetId}`,
      selectedAssetId: null,
      name: node.data.title,
      mediaType: node.data.resourceDetails.resource.mediaType,
      previewUrl: summary.kind === 'media' ? summary.url ?? null : null,
    })
  }, [onSelectionChange])
  const handlePaneClick = useCallback((event: ReactMouseEvent<Element, globalThis.MouseEvent>) => {
    canvasRef.current?.focus()
    onSelectionChange(null)
    if (event.detail !== 2) return
    notifyCanvasUserInteraction()
    const flow = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    setCreateDrafts((current) => [...current, { id: crypto.randomUUID(), position: flow }])
  }, [notifyCanvasUserInteraction, onSelectionChange, reactFlow])
  const closeCreateDraft = useCallback((draftId: string) => {
    setCreateDrafts((current) => current.filter((draft) => draft.id !== draftId))
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
  const selectedNode = useMemo(
    () => flowNodes.find((node) => node.id === selection?.nodeId) ?? null,
    [flowNodes, selection?.nodeId],
  )

  useEffect(() => {
    if (!selection || !creativeResourcesResponse) return
    if (selectedNode) return
    onSelectionChange(null)
  }, [creativeResourcesResponse, onSelectionChange, selectedNode, selection])

  const requestAssistantDraft = useCallback((text: string | null) => {
    onAssistantDraftRequest({
      requestId: crypto.randomUUID(),
      text,
      focus: true,
    })
  }, [onAssistantDraftRequest])

  const changeNodeVisibility = useCallback((nodeId: string, hidden: boolean) => {
    const previous = hiddenNodeKeysRef.current
    const next = new Set(previous)
    if (hidden) next.add(nodeId)
    else next.delete(nodeId)
    setHiddenNodeKeys(next)
    if (hidden && selection?.nodeId === nodeId) onSelectionChange(null)
    const positionedNodes = applyWorkspaceCanvasUserPositions({
      nodes: resolvedProjectedNodesRef.current,
      positions: userNodePositionsRef.current,
    })
    void persistCurrentLayout(positionedNodes, next).catch((error: unknown) => {
      _ulogWarn('[ProjectWorkspaceCanvas] canvas visibility save failed', error)
      setHiddenNodeKeys((current) => current === next ? previous : current)
      showError(error, t('layoutSaveFailed'))
    })
  }, [onSelectionChange, persistCurrentLayout, selection?.nodeId, showError, t])

  const beginResourceOperation = useCallback((operation: WorkspaceCanvasResourceOperationView) => {
    void operationAction.begin({
      operationId: operation.operationId,
      input: operation.input,
      confirmation: operation.confirmation,
    })
  }, [operationAction])

  const placePlannedResources = useCallback((
    request: WorkspaceCanvasCreateRequest,
    targetIds: readonly string[],
  ) => {
    const uniqueTargetIds = [...new Set(targetIds)]
    setUserNodePositions((current) => {
      const next = new Map(current)
      uniqueTargetIds.forEach((targetId, index) => {
        const nodeId = workspaceNodeId.resourceCard(targetId)
        pendingPlacementNodeIdsRef.current.add(nodeId)
        next.set(nodeId, {
          x: request.position.x + (index % 3) * 36,
          y: request.position.y + Math.floor(index / 3) * 36,
        })
      })
      return next
    })
  }, [])

  const submitCanvasCreation = useCallback((draftId: string, request: WorkspaceCanvasCreateRequest) => {
    const input = buildWorkspaceCanvasCreateOperationInput(request, episodeId ?? '')
    void operationAction.begin({
      operationId: request.capability.operationId,
      input,
      confirmation: 'billable_media',
      onAccepted: (plan) => {
        closeCreateDraft(draftId)
        if (!plan) return
        placePlannedResources(request, plan.tasks.map((task) => task.targetId))
      },
    })
  }, [closeCreateDraft, episodeId, operationAction, placePlannedResources])

  const selectionForCard = useCallback((card: WorkspaceCreativeResourceCardMemberView): WorkspaceCanvasSelection | null => {
    const node = flowNodes.find((candidate) => candidate.data.targetId === card.resource.resourceId)
    if (!node) return null
    const summary = card.presentation.summary
    return {
      nodeId: node.id,
      targetType: 'creativeResource',
      targetId: card.resource.resourceId,
      selectedScopeRef: `creativeResource:${card.resource.resourceId}`,
      selectedAssetId: null,
      name: card.resource.name,
      mediaType: card.resource.mediaType,
      previewUrl: summary.kind === 'media' ? summary.url ?? null : null,
    }
  }, [flowNodes])

  if (!episodeId) return null

  return (
    <div
      className="workspace-canvas-layout-animated h-full min-h-0 w-full overflow-hidden bg-[var(--glass-bg-canvas)]"
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onPaste={handleCanvasPaste}
    >
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept={uploadAccept}
        className="hidden"
        onChange={handleUploadInputChange}
      />
      <div ref={canvasRef} className="h-full outline-none" tabIndex={0} onWheelCapture={applyWheelZoom}>
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
          zoomOnDoubleClick={false}
          defaultViewport={DEFAULT_WORKSPACE_CANVAS_VIEWPORT}
          proOptions={WORKSPACE_REACT_FLOW_PRO_OPTIONS}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          {createDrafts.map((draft) => (
            <ViewportPortal key={draft.id}>
              <WorkspaceCanvasCreateDock
                position={draft.position}
                capabilities={canvasActions?.creation ?? []}
                loading={canvasActionsLoading}
                loadFailed={canvasActionsFailed}
                projectAspectRatio={projectAspectRatio}
                onRetryCapabilities={() => { void retryCanvasActions() }}
                onSubmit={(request) => submitCanvasCreation(draft.id, request)}
                onUpload={() => {
                  openUploadPicker(draft.position)
                  closeCreateDraft(draft.id)
                }}
                onClose={() => closeCreateDraft(draft.id)}
              />
            </ViewportPortal>
          ))}
          {selectedNode ? (
            <WorkspaceNodeDetailsCard
              node={selectedNode}
              actions={{
                busy: operationAction.busy || archiveAction.busy,
                hidden: hiddenNodeKeys.has(selectedNode.id),
                onAssistantPrefill: requestAssistantDraft,
                onPreview: () => {
                  const card = selectedNode.data.resourceDetails
                  const members = (card.alternativeGroup?.members ?? [card])
                    .filter((member) => (
                      !member.resource.archivedAt
                      && !hiddenNodeKeys.has(workspaceNodeId.resourceCard(member.resource.resourceId))
                    ))
                  setPreview({
                    members,
                    initialResourceId: card.resource.resourceId,
                  })
                },
                onOperation: beginResourceOperation,
                onSetArchived: (archived) => {
                  void archiveAction.request(
                    selectedNode.data.resourceDetails.resource.resourceId,
                    archived,
                  )
                },
                onVisibilityChange: (hidden) => changeNodeVisibility(selectedNode.id, hidden),
              }}
            />
          ) : null}
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
              fitViewLabel={t('toolbar.fitView')}
              zoomInLabel={t('toolbar.zoomIn')}
              zoomOutLabel={t('toolbar.zoomOut')}
              onFitView={fitView}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
            />
          </Panel>
        </ReactFlow>
      </div>
      {preview ? (
        <WorkspaceResourcePreviewModal
          members={preview.members}
          initialResourceId={preview.initialResourceId}
          onClose={() => setPreview(null)}
          onDiscuss={(card) => {
            const nextSelection = selectionForCard(card)
            if (nextSelection) onSelectionChange(nextSelection)
            setPreview(null)
            requestAssistantDraft(null)
          }}
        />
      ) : null}
      {operationAction.pending ? (
        <CanvasOperationConfirmationModal
          plan={operationAction.pending.plan}
          destructive={false}
          executing={operationAction.phase === 'executing'}
          onConfirm={() => { void operationAction.confirm() }}
          onCancel={operationAction.cancel}
        />
      ) : null}
      {archiveAction.pending ? (
        <CanvasOperationConfirmationModal
          plan={null}
          destructive
          executing={archiveAction.executing}
          onConfirm={() => { void archiveAction.confirm() }}
          onCancel={archiveAction.cancel}
        />
      ) : null}
      <CanvasUploadQueue
        items={uploadQueue.items}
        onRetry={uploadQueue.retry}
        onDismiss={uploadQueue.dismiss}
      />
    </div>
  )
}

interface ProjectWorkspaceCanvasProps {
  selection: WorkspaceCanvasSelection | null
  onSelectionChange: (selection: WorkspaceCanvasSelection | null) => void
  onAssistantDraftRequest: (request: WorkspaceAssistantDraftRequest) => void
  activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
}

export default function ProjectWorkspaceCanvas({
  selection,
  onSelectionChange,
  onAssistantDraftRequest,
  activeAssistantFocusRequest = null,
}: ProjectWorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProjectWorkspaceCanvasContent
        selection={selection}
        onSelectionChange={onSelectionChange}
        onAssistantDraftRequest={onAssistantDraftRequest}
        activeAssistantFocusRequest={activeAssistantFocusRequest}
      />
    </ReactFlowProvider>
  )
}
