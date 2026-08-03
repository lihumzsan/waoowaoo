'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
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
import { useProjectData, useWorkspaceResources } from '@/lib/query/hooks'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import {
  WORKSPACE_RESOURCE_ROOT_FOLDER_KEY,
  type WorkspaceResourceAncestorView,
  type WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import type { WorkspaceAssistantActiveFocusRequest } from '../workspace-assistant-focus'
import { useCanvasLayoutPersistence } from './hooks/useCanvasLayoutPersistence'
import { useWorkspaceNodeCanvasProjection } from './hooks/useWorkspaceNodeCanvasProjection'
import { resolveWorkspaceCanvasFocusNodeIds, useCanvasFocusFollow } from './hooks/useCanvasFocusFollow'
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
import {
  WorkspaceCanvasFolderOpenContext,
  type WorkspaceCanvasFolderOpenTarget,
} from './nodes/renderers/folder-card'
import type { WorkspaceCanvasFlowEdge, WorkspaceCanvasFlowNode } from './node-canvas-types'
import type { WorkspaceCanvasFolderNodeData, WorkspaceCanvasNodeRecord } from './node-canvas-types'
import { collectWorkspaceNodeRuntimeTargets, resolveWorkspaceCanvasNodeData } from './workspace-node-runtime'
import type {
  WorkspaceAssistantDraftRequest,
  WorkspaceCanvasCreateRequest,
  WorkspaceCanvasResourceOperationView,
  WorkspaceCanvasSelection,
  WorkspaceResourceCardMemberView,
} from './contracts/workspace-canvas-interactions'
import { useCanvasOperationAction } from './actions/useCanvasOperationAction'
import { CanvasOperationConfirmationModal } from './actions/CanvasOperationConfirmationModal'
import { WorkspaceResourcePreviewModal } from './preview/WorkspaceResourcePreviewModal'
import { useCanvasActions } from '@/lib/query/hooks/useCanvasActions'
import { WorkspaceCanvasCreateDock } from './create/WorkspaceCanvasCreateDock'
import { workspaceNodeId } from './workspace-canvas-node-ids'
import { useCanvasUploadQueue, type CanvasUploadQueueItem } from './upload/useCanvasUploadQueue'
import { CanvasUploadQueue } from './upload/CanvasUploadQueue'
import { CanvasViewportControls } from './controls/CanvasViewportControls'
import { CanvasFolderNavigation } from './controls/CanvasFolderNavigation'
import { buildWorkspaceCanvasCreateOperationInput } from './create/canvas-create-input'
import { buildCanvasCreationOutputPath } from './create/canvas-output-path'
import { useCanvasUploadBridge } from './upload/useCanvasUploadBridge'

const EMPTY_SAVED_NODE_LAYOUTS: readonly CanvasNodeLayout[] = []
const CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX = 56
const WORKSPACE_REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const

interface CurrentCanvasFolder {
  readonly folderKey: string
  readonly name: string
  readonly workspacePath: string
  readonly ancestors: readonly WorkspaceResourceAncestorView[]
}

interface ProjectWorkspaceCanvasContentProps {
  readonly selection: WorkspaceCanvasSelection | null
  readonly onSelectionChange: (selection: WorkspaceCanvasSelection | null) => void
  readonly onAssistantDraftRequest: (request: WorkspaceAssistantDraftRequest) => void
  readonly activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
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
      data: { ...node.data, layoutBasePosition: position },
    }
  })
}

function flattenResources(data: ReturnType<typeof useWorkspaceResources>['data']): WorkspaceResourceView[] {
  const byId = new Map<string, WorkspaceResourceView>()
  for (const page of data?.pages ?? []) {
    for (const resource of page.items) byId.set(resource.resourceId, resource)
  }
  return [...byId.values()]
}

function folderFromResource(resource: WorkspaceResourceView): CurrentCanvasFolder {
  if (resource.resourceKind !== 'folder') {
    throw new Error(`WORKSPACE_CANVAS_FOLDER_REQUIRED:${resource.resourceId}`)
  }
  return {
    folderKey: resource.resourceId,
    name: resource.name,
    workspacePath: resource.workspacePath,
    ancestors: resource.ancestors,
  }
}

function parentFolderFromResource(resource: WorkspaceResourceView, rootName: string): CurrentCanvasFolder {
  const parent = resource.ancestors.at(-1)
  if (!parent) {
    return {
      folderKey: WORKSPACE_RESOURCE_ROOT_FOLDER_KEY,
      name: rootName,
      workspacePath: '',
      ancestors: [],
    }
  }
  return {
    folderKey: parent.resourceId,
    name: parent.name,
    workspacePath: parent.workspacePath,
    ancestors: resource.ancestors.slice(0, -1),
  }
}

function isFolderNodeData(
  data: WorkspaceCanvasNodeRecord,
): data is WorkspaceCanvasFolderNodeData & Record<string, unknown> {
  return data.kind === 'folder'
}

function ProjectWorkspaceFolderCanvas({
  folder,
  rootName,
  pendingLocateResourceId,
  onNavigate,
  onLocateConsumed,
  selection,
  onSelectionChange,
  onAssistantDraftRequest,
  activeAssistantFocusRequest = null,
}: ProjectWorkspaceCanvasContentProps & {
  readonly folder: CurrentCanvasFolder
  readonly rootName: string
  readonly pendingLocateResourceId: string | null
  readonly onNavigate: (folder: CurrentCanvasFolder, locateResourceId?: string | null) => void
  readonly onLocateConsumed: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const { projectId } = useWorkspaceProvider()
  const { data: projectData } = useProjectData(projectId)
  const projectAspectRatio = projectData?.videoRatio ?? null
  const {
    data: canvasActions,
    isLoading: canvasActionsLoading,
    isError: canvasActionsFailed,
    refetch: retryCanvasActions,
  } = useCanvasActions(projectId)
  const folderQuery = useWorkspaceResources({
    projectId,
    prefix: folder.workspacePath || null,
    search: null,
    scope: 'subtree',
  })
  const resources = useMemo(() => flattenResources(folderQuery.data), [folderQuery.data])
  const fetchNextFolderPage = folderQuery.fetchNextPage
  const folderHasNextPage = folderQuery.hasNextPage
  const folderFetchingNextPage = folderQuery.isFetchingNextPage
  useEffect(() => {
    if (!folderHasNextPage || folderFetchingNextPage) return
    void fetchNextFolderPage()
  }, [fetchNextFolderPage, folderFetchingNextPage, folderHasNextPage])

  const [search, setSearch] = useState('')
  const normalizedSearch = search.trim()
  const searchQuery = useWorkspaceResources({
    projectId,
    prefix: null,
    search: normalizedSearch || null,
    enabled: Boolean(normalizedSearch),
  })
  const searchResults = useMemo(() => flattenResources(searchQuery.data), [searchQuery.data])
  const [createDrafts, setCreateDrafts] = useState<readonly {
    readonly id: string
    readonly position: WorkspaceCanvasCreateRequest['position']
  }[]>([])
  const reactFlow = useReactFlow<WorkspaceCanvasFlowNode>()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [userNodePositions, setUserNodePositions] = useState<ReadonlyMap<string, WorkspaceCanvasUserPosition>>(() => new Map())
  const [preview, setPreview] = useState<{
    readonly members: readonly WorkspaceResourceCardMemberView[]
    readonly initialResourceId: string
  } | null>(null)
  const [reactFlowReady, setReactFlowReady] = useState(false)
  const resolvedProjectedNodesRef = useRef<readonly WorkspaceCanvasFlowNode[]>([])
  const projectedFlowNodesRef = useRef<readonly WorkspaceCanvasFlowNode[]>([])
  const projectedFlowEdgesRef = useRef<readonly WorkspaceCanvasFlowEdge[]>([])
  const initialReactFlowNodesRef = useRef<WorkspaceCanvasFlowNode[] | null>(null)
  const initialReactFlowEdgesRef = useRef<WorkspaceCanvasFlowEdge[] | null>(null)
  const appliedProjectionSignatureRef = useRef<string | null>(null)
  const appliedInitialViewportRef = useRef(false)
  const projectionSignatureRef = useRef('')
  const reactFlowRef = useRef(reactFlow)
  reactFlowRef.current = reactFlow
  const userNodePositionsRef = useRef<ReadonlyMap<string, WorkspaceCanvasUserPosition>>(new Map())
  const layoutWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingPlacementNodeIdsRef = useRef<Set<string>>(new Set())
  const operationAction = useCanvasOperationAction({ projectId })
  const placeUploadedResource = useCallback((item: CanvasUploadQueueItem, resourceId: string, reused: boolean) => {
    if (reused) return
    const nodeId = workspaceNodeId.resourceCard(resourceId)
    pendingPlacementNodeIdsRef.current.add(nodeId)
    setUserNodePositions((current) => new Map(current).set(nodeId, item.position))
  }, [])
  const uploadQueue = useCanvasUploadQueue({
    projectId,
    directoryPath: folder.workspacePath,
    onMaterialized: placeUploadedResource,
  })
  const {
    layout,
    isLoading: layoutLoading,
    loadError: layoutLoadError,
    reloadLayout,
    saveLayout,
  } = useCanvasLayoutPersistence({ projectId, folderKey: folder.folderKey })
  const projectionComplete = !folderQuery.isLoading
    && !folderQuery.isError
    && !folderQuery.hasNextPage
    && !folderQuery.isFetchingNextPage
    && !layoutLoading
    && !layoutLoadError

  const savedNodeLayouts = layout?.nodeLayouts ?? EMPTY_SAVED_NODE_LAYOUTS
  // Session-monotonic collapse seed: folders folded during this canvas visit
  // never pop back open mid-session (the ref resets with the per-folder mount).
  const collapsedFoldersRef = useRef<ReadonlySet<string>>(new Set())
  const projection = useWorkspaceNodeCanvasProjection({
    projectId,
    projectAspectRatio,
    currentFolderPath: folder.workspacePath || null,
    collapsedSeed: collapsedFoldersRef.current,
    workspaceResources: resources,
    savedLayouts: savedNodeLayouts,
    translate: t,
  })
  const projectedNodes = projection.nodes
  const projectionEdges = projection.edges
  useEffect(() => {
    const next = new Set<string>()
    for (const node of projectedNodes) {
      if (node.data.kind === 'folder' && node.data.folder.display === 'card') {
        next.add(node.data.folder.resourceId)
      }
    }
    const current = collapsedFoldersRef.current
    if (next.size === current.size && [...next].every((id) => current.has(id))) return
    collapsedFoldersRef.current = next
  }, [projectedNodes])
  const workspaceRuntimeTargets = useMemo(
    () => collectWorkspaceNodeRuntimeTargets(projectedNodes),
    [projectedNodes],
  )
  const workspaceTaskStateMap = useTaskTargetStateMap(projectId, workspaceRuntimeTargets, {
    enabled: Boolean(projectId && workspaceRuntimeTargets.length > 0),
    staleTime: 1000,
  })
  const attachNodeUiState = useCallback((inputNodes: readonly WorkspaceCanvasFlowNode[]) => (
    inputNodes.map((node) => {
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
  ), [selection?.nodeId, workspaceTaskStateMap.byQueryKey])
  const resolvedProjectedNodes = useMemo(
    () => attachNodeUiState(projectedNodes),
    [attachNodeUiState, projectedNodes],
  )
  resolvedProjectedNodesRef.current = resolvedProjectedNodes
  userNodePositionsRef.current = userNodePositions
  const flowNodes = useMemo(() => applyWorkspaceCanvasUserPositions({
    nodes: resolvedProjectedNodes,
    positions: userNodePositions,
  }), [resolvedProjectedNodes, userNodePositions])
  const flowNodeSignature = useMemo(() => buildWorkspaceCanvasNodeSignature(flowNodes), [flowNodes])
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
        return current?.measured ? { ...node, measured: current.measured } : node
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
  useEffect(() => {
    if (!reactFlowReady || layoutLoading || appliedInitialViewportRef.current) return
    appliedInitialViewportRef.current = true
    void reactFlow.setViewport(layout?.viewport ?? DEFAULT_WORKSPACE_CANVAS_VIEWPORT, { duration: 0 })
  }, [layout?.viewport, layoutLoading, reactFlow, reactFlowReady])
  const focusNodeIds = useMemo(() => resolveWorkspaceCanvasFocusNodeIds(
    flowNodes,
    activeAssistantFocusRequest?.taskTargets ?? [],
  ), [activeAssistantFocusRequest?.taskTargets, flowNodes])
  const { notifyUserInteraction: notifyCanvasUserInteraction } = useCanvasFocusFollow({
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
        if (projectedNodeIds.has(nodeId)) next.set(nodeId, position)
        else changed = true
      })
      return changed ? next : current
    })
  }, [projectedNodes, projectionNodeSignature])

  const persistCurrentLayout = useCallback(async (nextNodes: readonly WorkspaceCanvasFlowNode[]) => {
    if (!projectionComplete) return
    const input = buildWorkspaceCanvasLayoutInput({
      folderKey: folder.folderKey,
      viewport: reactFlowRef.current.getViewport(),
      nodes: nextNodes,
    })
    const write = layoutWriteChainRef.current
      .catch(() => undefined)
      .then(async () => { await saveLayout(input) })
    layoutWriteChainRef.current = write.catch(() => undefined)
    await write
  }, [folder.folderKey, projectionComplete, saveLayout])

  useEffect(() => {
    if (pendingPlacementNodeIdsRef.current.size === 0) return
    const projectedNodeIds = new Set(resolvedProjectedNodes.map((node) => node.id))
    const matched = [...pendingPlacementNodeIdsRef.current].filter((nodeId) => projectedNodeIds.has(nodeId))
    if (matched.length === 0) return
    matched.forEach((nodeId) => pendingPlacementNodeIdsRef.current.delete(nodeId))
    void persistCurrentLayout(applyWorkspaceCanvasUserPositions({
      nodes: resolvedProjectedNodes,
      positions: userNodePositionsRef.current,
    })).catch((error: unknown) => {
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
      nodes.forEach((node) => next.set(node.id, { x: node.position.x, y: node.position.y }))
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
    movedNodes.forEach((movedNode) => nextPositions.set(movedNode.id, movedNode.position))
    applyUserNodePositions(movedNodes)
    persistCurrentLayoutSafely(applyWorkspaceCanvasUserPositions({
      nodes: resolvedProjectedNodesRef.current,
      positions: nextPositions,
    }))
  }, [applyUserNodePositions, notifyCanvasUserInteraction, persistCurrentLayoutSafely])

  const selectionForNode = useCallback((node: WorkspaceCanvasFlowNode): WorkspaceCanvasSelection | null => {
    if (node.data.kind !== 'resourceCard') return null
    const summary = node.data.resourceDetails.presentation.summary
    return {
      nodeId: node.id,
      targetType: 'workspaceResource',
      targetId: node.data.targetId,
      selectedScopeRef: `workspaceResource:${node.data.targetId}`,
      selectedAssetId: null,
      name: node.data.title,
      mediaType: node.data.resourceDetails.resource.mediaType,
      previewUrl: summary.kind === 'media' ? summary.url : null,
    }
  }, [])
  const openProjectedFolder = useCallback((target: WorkspaceCanvasFolderOpenTarget) => {
    const parent: WorkspaceResourceAncestorView[] = folder.folderKey === WORKSPACE_RESOURCE_ROOT_FOLDER_KEY
      ? []
      : [...folder.ancestors, {
          resourceId: folder.folderKey,
          name: folder.name,
          workspacePath: folder.workspacePath,
        }]
    onNavigate({
      folderKey: target.resourceId,
      name: target.name,
      workspacePath: target.workspacePath,
      ancestors: parent,
    })
  }, [folder, onNavigate])
  const handleNodeClick = useCallback<NodeMouseHandler<WorkspaceCanvasFlowNode>>((_event, node) => {
    canvasRef.current?.focus()
    if (isFolderNodeData(node.data)) {
      // Expanded section frames behave like canvas background on single click;
      // only the collapsed folder card keeps click-to-enter (CN-02C).
      if (node.data.folder.display === 'section') {
        onSelectionChange(null)
        return
      }
      openProjectedFolder({
        resourceId: node.data.folder.resourceId,
        name: node.data.title,
        workspacePath: node.data.folder.workspacePath,
      })
      return
    }
    onSelectionChange(selectionForNode(node))
  }, [onSelectionChange, openProjectedFolder, selectionForNode])
  const handleNodeDoubleClick = useCallback<NodeMouseHandler<WorkspaceCanvasFlowNode>>((_event, node) => {
    if (!isFolderNodeData(node.data)) return
    openProjectedFolder({
      resourceId: node.data.folder.resourceId,
      name: node.data.title,
      workspacePath: node.data.folder.workspacePath,
    })
  }, [openProjectedFolder])
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
    () => flowNodes.find((node) => node.id === selection?.nodeId && node.data.kind === 'resourceCard') ?? null,
    [flowNodes, selection?.nodeId],
  )
  useEffect(() => {
    if (!selection || folderQuery.isLoading || selectedNode) return
    onSelectionChange(null)
  }, [folderQuery.isLoading, onSelectionChange, selectedNode, selection])
  useEffect(() => {
    if (!pendingLocateResourceId || !reactFlowReady) return
    const node = flowNodes.find((candidate) => candidate.data.targetId === pendingLocateResourceId)
    if (!node) return
    const nextSelection = selectionForNode(node)
    if (nextSelection) onSelectionChange(nextSelection)
    void reactFlow.fitView({ nodes: [node], padding: 0.35, maxZoom: 1, duration: 180 })
    onLocateConsumed()
  }, [flowNodes, onLocateConsumed, onSelectionChange, pendingLocateResourceId, reactFlow, reactFlowReady, selectionForNode])

  const requestAssistantDraft = useCallback((text: string | null) => {
    onAssistantDraftRequest({ requestId: crypto.randomUUID(), text, focus: true })
  }, [onAssistantDraftRequest])
  const beginResourceOperation = useCallback((operation: WorkspaceCanvasResourceOperationView) => {
    void operationAction.begin({
      operationId: operation.operationId,
      input: operation.input,
      confirmation: operation.confirmation,
    })
  }, [operationAction])
  const placePlannedResources = useCallback((request: WorkspaceCanvasCreateRequest, targetIds: readonly string[]) => {
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
    const outputPath = buildCanvasCreationOutputPath({
      directoryPath: folder.workspacePath,
      name: request.name || request.capability.mediaKind,
      kind: request.capability.mediaKind,
      uniqueSuffix: crypto.randomUUID(),
    })
    void operationAction.begin({
      operationId: request.capability.operationId,
      input: buildWorkspaceCanvasCreateOperationInput(request, outputPath),
      confirmation: 'billable_media',
      onAccepted: (plan) => {
        closeCreateDraft(draftId)
        if (plan) placePlannedResources(request, plan.tasks.map((task) => task.targetId))
      },
    })
  }, [closeCreateDraft, folder.workspacePath, operationAction, placePlannedResources])
  const selectionForCard = useCallback((card: WorkspaceResourceCardMemberView): WorkspaceCanvasSelection | null => {
    const node = flowNodes.find((candidate) => candidate.data.targetId === card.resource.resourceId)
    return node ? selectionForNode(node) : null
  }, [flowNodes, selectionForNode])
  const handleGoBack = useCallback(() => {
    if (folder.folderKey === WORKSPACE_RESOURCE_ROOT_FOLDER_KEY) return
    const parent = folder.ancestors.at(-1)
    onNavigate(parent ? {
      folderKey: parent.resourceId,
      name: parent.name,
      workspacePath: parent.workspacePath,
      ancestors: folder.ancestors.slice(0, -1),
    } : {
      folderKey: WORKSPACE_RESOURCE_ROOT_FOLDER_KEY,
      name: rootName,
      workspacePath: '',
      ancestors: [],
    })
  }, [folder.ancestors, folder.folderKey, onNavigate, rootName])
  const handleSearchResult = useCallback((resource: WorkspaceResourceView) => {
    setSearch('')
    if (resource.resourceKind === 'folder') onNavigate(folderFromResource(resource))
    else onNavigate(parentFolderFromResource(resource, rootName), resource.resourceId)
  }, [onNavigate, rootName])

  const loading = folderQuery.isLoading || layoutLoading
  const failed = folderQuery.isError || Boolean(layoutLoadError)
  return (
    <WorkspaceCanvasFolderOpenContext.Provider value={openProjectedFolder}>
      <div
      className="workspace-canvas-layout-animated relative h-full min-h-0 w-full overflow-hidden bg-[var(--glass-bg-canvas)]"
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
          defaultNodes={initialReactFlowNodesRef.current ?? []}
          defaultEdges={initialReactFlowEdgesRef.current ?? []}
          nodeTypes={workspaceNodeTypes}
          onInit={handleReactFlowInit}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={handlePaneClick}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onMoveStart={handleMoveStart}
          onMoveEnd={handleMoveEnd}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          onlyRenderVisibleElements
          minZoom={WORKSPACE_CANVAS_MIN_ZOOM}
          maxZoom={WORKSPACE_CANVAS_MAX_ZOOM}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          defaultViewport={layout?.viewport ?? DEFAULT_WORKSPACE_CANVAS_VIEWPORT}
          proOptions={WORKSPACE_REACT_FLOW_PRO_OPTIONS}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Panel position="top-left" className="!z-[80] !m-0" style={{ left: 16, top: 72 }}>
            <CanvasFolderNavigation
              canGoBack={folder.folderKey !== WORKSPACE_RESOURCE_ROOT_FOLDER_KEY}
              onBack={handleGoBack}
              search={search}
              backLabel={t('folderNavigation.back')}
              searchPlaceholder={t('folderNavigation.searchPlaceholder')}
              searchResultsLabel={t('folderNavigation.searchResults')}
              noResultsLabel={t('folderNavigation.noResults')}
              loadingLabel={t('folderNavigation.loading')}
              loadFailedLabel={t('folderNavigation.loadFailed')}
              retryLabel={t('folderNavigation.retry')}
              loadMoreLabel={t('folderNavigation.loadMore')}
              searchResults={searchResults}
              searchLoading={searchQuery.isLoading || searchQuery.isFetching}
              searchFailed={searchQuery.isError}
              searchHasMore={Boolean(searchQuery.hasNextPage)}
              onSearchChange={setSearch}
              onSearchResult={handleSearchResult}
              onRetrySearch={() => { void searchQuery.refetch() }}
              onLoadMoreSearch={() => { void searchQuery.fetchNextPage() }}
            />
          </Panel>
          {folderQuery.isFetchingNextPage ? (
            <Panel position="top-right" className="!m-0" style={{ right: 16, top: 16 }}>
              <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs text-[var(--glass-text-secondary)] shadow-sm">
                {t('folderNavigation.loading')}
              </span>
            </Panel>
          ) : null}
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
                busy: operationAction.busy,
                onAssistantPrefill: requestAssistantDraft,
                onPreview: () => {
                  const card = selectedNode.data.kind === 'resourceCard'
                    ? selectedNode.data.resourceDetails
                    : null
                  if (!card) return
                  setPreview({
                    members: card.alternativeGroup?.members ?? [card],
                    initialResourceId: card.resource.resourceId,
                  })
                },
                onOperation: beginResourceOperation,
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
            style={{ left: 16, bottom: CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX + 72, width: 180, height: 96 }}
          />
          <Panel
            position="bottom-left"
            className="!z-[70] !m-0"
            style={{ left: 16, bottom: CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX + 16 }}
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
      {loading || failed ? (
        <div className="pointer-events-none absolute inset-0 z-[75] flex items-center justify-center bg-[var(--glass-bg-canvas)]/45 backdrop-blur-[1px]">
          <div className="pointer-events-auto rounded-2xl bg-white px-5 py-4 text-sm text-[var(--glass-text-secondary)] shadow-lg ring-1 ring-[var(--glass-stroke-base)]">
            {failed ? (
              <div className="flex items-center gap-3">
                <span>{t('folderNavigation.loadFailed')}</span>
                <button
                  type="button"
                  className="font-semibold text-[var(--glass-text-primary)]"
                  onClick={() => {
                    void folderQuery.refetch()
                    if (layoutLoadError) void reloadLayout()
                  }}
                >
                  {t('folderNavigation.retry')}
                </button>
              </div>
            ) : t('folderNavigation.loading')}
          </div>
        </div>
      ) : null}
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
      <CanvasUploadQueue items={uploadQueue.items} onRetry={uploadQueue.retry} onDismiss={uploadQueue.dismiss} />
      </div>
    </WorkspaceCanvasFolderOpenContext.Provider>
  )
}

function ProjectWorkspaceCanvasContent(props: ProjectWorkspaceCanvasContentProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const rootName = t('folderNavigation.root')
  const [folder, setFolder] = useState<CurrentCanvasFolder>({
    folderKey: WORKSPACE_RESOURCE_ROOT_FOLDER_KEY,
    name: rootName,
    workspacePath: '',
    ancestors: [],
  })
  const [pendingLocateResourceId, setPendingLocateResourceId] = useState<string | null>(null)
  const navigate = useCallback((nextFolder: CurrentCanvasFolder, locateResourceId: string | null = null) => {
    props.onSelectionChange(null)
    setPendingLocateResourceId(locateResourceId)
    setFolder(nextFolder)
  }, [props])
  return (
    <ProjectWorkspaceFolderCanvas
      key={folder.folderKey}
      {...props}
      folder={folder}
      rootName={rootName}
      pendingLocateResourceId={pendingLocateResourceId}
      onNavigate={navigate}
      onLocateConsumed={() => setPendingLocateResourceId(null)}
    />
  )
}

export default function ProjectWorkspaceCanvas(props: ProjectWorkspaceCanvasContentProps) {
  return (
    <ReactFlowProvider>
      <ProjectWorkspaceCanvasContent {...props} />
    </ReactFlowProvider>
  )
}
