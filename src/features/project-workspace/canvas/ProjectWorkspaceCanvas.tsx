'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WheelEvent } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type OnNodeDrag,
  type NodeChange,
  type Viewport,
  useReactFlow,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { logWarn as _ulogWarn } from '@/lib/logging/core'
import {
  isTaskRuntimeRunningPhase,
  taskRuntimeStateMapSignature,
  taskTargetPairKey,
  TASK_RUNTIME_TARGETS,
} from '@/lib/task/runtime-targets'
import { useTaskTargetTerminalInvalidation } from '@/lib/query/hooks/useTaskTargetTerminalInvalidation'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import { useProjectEditScreenplay, useProjectEditScript } from '@/lib/query/hooks'
import { useTaskTargetStateMap, type TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import { useWorkspaceRuntime } from '../WorkspaceRuntimeContext'
import { useCanvasLayoutPersistence } from './hooks/useCanvasLayoutPersistence'
import {
  buildWorkspaceNodeCanvasProjection,
  useWorkspaceNodeCanvasProjection,
} from './hooks/useWorkspaceNodeCanvasProjection'
import { useWorkspaceNodeCanvasActions } from './hooks/useWorkspaceNodeCanvasActions'
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
import { workspaceNodeTypes } from './nodes/workspaceNodeTypes'
import type { WorkspaceCanvasFlowEdge, WorkspaceCanvasFlowNode, WorkspaceCanvasNodeAction } from './node-canvas-types'
import {
  getWorkspaceCanvasNodePresentationProfile,
  resolveWorkspaceCanvasMeasuredNodeHeight,
  resolveWorkspaceCanvasNodeSize,
} from './node-presentation-profiles'
import {
  alignSpaceConsistencyNodesToMeasuredEditScript,
  preserveWorkspaceNodePositions,
  type WorkspaceNodeDynamicLayoutOptions,
} from './layout/workspace-node-auto-layout'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  captureLayoutBasePositions,
  composeWorkspaceCanvasLegacyLayout,
  mergePreservedNodePositions,
  normalizeNodesToLayoutBasePositions,
  preservedNodeIdSet,
  relayoutEditAssetsBelowScript,
  repairWorkspaceCanvasDraggedLayout,
} from './layout/workspace-layout-composer'

const EMPTY_SAVED_NODE_LAYOUTS: readonly CanvasNodeLayout[] = []
const CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX = 56
const OPTIMISTIC_NODE_RUNNING_TIMEOUT_MS = 15000
const MEASURED_NODE_SIZE_EPSILON = 1

export interface WorkspaceAssistantSelectionContext {
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedClipId?: string | null
  selectedAssetId?: string | null
}

interface ProjectWorkspaceCanvasContentProps {
  onAssistantSelectionChange?: (selection: WorkspaceAssistantSelectionContext) => void
  editScriptPending?: boolean
}

interface CanvasViewportControlsProps {
  readonly resetLabel: string
  readonly fitViewLabel: string
  readonly zoomInLabel: string
  readonly zoomOutLabel: string
  readonly onResetLayout: () => void
  readonly onFitView: () => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
}

function numericStyleDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function CanvasViewportControls({
  resetLabel,
  fitViewLabel,
  zoomInLabel,
  zoomOutLabel,
  onResetLayout,
  onFitView,
  onZoomIn,
  onZoomOut,
}: CanvasViewportControlsProps) {
  const buttonClassName = 'inline-flex h-10 w-10 items-center justify-center border-r border-[var(--glass-stroke-soft)] text-[var(--glass-text-primary)] transition last:border-r-0 hover:bg-[var(--glass-bg-hover)]'

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

function ProjectWorkspaceCanvasContent({ onAssistantSelectionChange, editScriptPending = false }: ProjectWorkspaceCanvasContentProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const { projectId, episodeId } = useWorkspaceProvider()
  const runtime = useWorkspaceRuntime()
  const { episodeName, novelText, clips, storyboards, shots, finalVideo, videoGroups } = useWorkspaceEpisodeStageData()
  const { data: editScreenplay } = useProjectEditScreenplay(projectId, episodeId ?? null)
  const { data: editScript } = useProjectEditScript(projectId, episodeId ?? null)
  const reactFlow = useReactFlow<WorkspaceCanvasFlowNode>()
  const runNodeAction = useWorkspaceNodeCanvasActions()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [sourceNodes, setSourceNodes] = useState<WorkspaceCanvasFlowNode[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodeExpansionOverrides, setNodeExpansionOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const defaultExpandedNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  const optimisticRunningNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  const optimisticRunningClearTimersRef = useRef<Map<string, number>>(new Map())
  const panelImageTaskStateByKeyRef = useRef<ReadonlyMap<string, TaskTargetState>>(new Map())
  const storyboardConsistencyTaskStateByKeyRef = useRef<ReadonlyMap<string, TaskTargetState>>(new Map())
  const editScriptConsistencyTaskStateByKeyRef = useRef<ReadonlyMap<string, TaskTargetState>>(new Map())
  const expansionAnchorNodePositionsRef = useRef<ReadonlyMap<string, { readonly x: number; readonly y: number }>>(new Map())
  const appliedProjectionNodeSignatureRef = useRef<string | null>(null)
  const stableEdgesRef = useRef<{
    signature: string
    edges: WorkspaceCanvasFlowEdge[]
  } | null>(null)

  const {
    layout,
    saveLayout,
    resetLayout: resetSavedLayout,
  } = useCanvasLayoutPersistence({
    projectId,
    episodeId: episodeId ?? '',
  })

  const savedNodeLayouts = layout?.nodeLayouts ?? EMPTY_SAVED_NODE_LAYOUTS
  const finalRenderTargets = useMemo(
    () => {
      const target = TASK_RUNTIME_TARGETS.projectEpisodeFinalRender(episodeId)
      return target ? [target] : []
    },
    [episodeId],
  )
  const bgmScoreTargets = useMemo(
    () => {
      const target = TASK_RUNTIME_TARGETS.projectEpisodeBgmScore(episodeId)
      return target ? [target] : []
    },
    [episodeId],
  )
  const editScriptGenerationTargets = useMemo(
    () => {
      const target = TASK_RUNTIME_TARGETS.projectEpisodeEditScriptGeneration(episodeId)
      return target ? [target] : []
    },
    [episodeId],
  )
  const finalRenderTaskState = useTaskTargetStateMap(projectId, finalRenderTargets, {
    enabled: Boolean(projectId && episodeId),
  }).getQueryState(finalRenderTargets[0] ?? { targetType: '', targetId: '' })
  const bgmScoreTaskState = useTaskTargetStateMap(projectId, bgmScoreTargets, {
    enabled: Boolean(projectId && episodeId),
  }).getQueryState(bgmScoreTargets[0] ?? { targetType: '', targetId: '' })
  const editScriptGenerationTaskState = useTaskTargetStateMap(projectId, editScriptGenerationTargets, {
    enabled: Boolean(projectId && episodeId),
  }).getQueryState(editScriptGenerationTargets[0] ?? { targetType: '', targetId: '' })
  const editScriptGenerationActive = isTaskRuntimeRunningPhase(editScriptGenerationTaskState?.phase)
  const projectedEditScript = useMemo(() => (
    editScript
      ? {
          ...editScript,
          status: editScriptGenerationActive
            ? 'generating'
            : editScript.status === 'generating'
              ? 'ready'
              : editScript.status,
        }
      : editScript
  ), [editScript, editScriptGenerationActive])
  const effectiveEditScriptPending = editScriptPending || (editScriptGenerationActive && !editScript)
  const nodeRunningStatusLabel = useCallback((node: WorkspaceCanvasFlowNode): string => (
    node.data.kind === 'finalTimeline'
      ? t('status.aiEditing')
      : node.data.kind === 'bgmScore'
        ? t('status.generatingBgm')
        : t('status.processing')
  ), [t])
  const clearOptimisticRunningNode = useCallback((nodeId: string) => {
    const timer = optimisticRunningClearTimersRef.current.get(nodeId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      optimisticRunningClearTimersRef.current.delete(nodeId)
    }
    const nextIds = new Set(optimisticRunningNodeIdsRef.current)
    nextIds.delete(nodeId)
    optimisticRunningNodeIdsRef.current = nextIds
  }, [])
  const markNodeOptimisticallyRunning = useCallback((nodeId: string) => {
    const previousTimer = optimisticRunningClearTimersRef.current.get(nodeId)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const nextIds = new Set(optimisticRunningNodeIdsRef.current)
    nextIds.add(nodeId)
    optimisticRunningNodeIdsRef.current = nextIds
      const timer = window.setTimeout(() => {
        clearOptimisticRunningNode(nodeId)
        setSourceNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId
          ? {
              ...node,
              data: {
              ...node.data,
              isRunning: false,
            },
          }
        : node))
      }, OPTIMISTIC_NODE_RUNNING_TIMEOUT_MS)
      optimisticRunningClearTimersRef.current.set(nodeId, timer)
    setSourceNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            isRunning: true,
            statusLabel: nodeRunningStatusLabel(node),
          },
        }
      : node))
  }, [clearOptimisticRunningNode, nodeRunningStatusLabel])
  const onNodeAction = useCallback(async (action: WorkspaceCanvasNodeAction, nodeId?: string) => {
    if (nodeId) markNodeOptimisticallyRunning(nodeId)
    try {
      await runNodeAction(action)
    } catch (error: unknown) {
      if (nodeId) {
        clearOptimisticRunningNode(nodeId)
        setSourceNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                isRunning: false,
              },
            }
          : node))
      }
      _ulogWarn('[ProjectWorkspaceCanvas] node action failed', error)
      throw error
    }
  }, [clearOptimisticRunningNode, markNodeOptimisticallyRunning, runNodeAction])
  const toggleNodeExpanded = useCallback((nodeId: string) => {
    const anchorNode = reactFlow.getNode(nodeId)
    if (anchorNode) {
      const nextAnchors = new Map(expansionAnchorNodePositionsRef.current)
      nextAnchors.set(nodeId, anchorNode.position)
      expansionAnchorNodePositionsRef.current = nextAnchors
    }
    setNodeExpansionOverrides((current) => {
      const defaultExpanded = defaultExpandedNodeIdsRef.current.has(nodeId)
      const currentExpanded = current.get(nodeId) ?? defaultExpanded
      const next = new Map(current)
      next.set(nodeId, !currentExpanded)
      return next
    })
  }, [reactFlow])
  const handleMeasuredNodeSize = useCallback((
    nodeId: string,
    size: { readonly width: number; readonly height: number },
  ) => {
    setSourceNodes((currentNodes) => {
      let changed = false
      let measuredKind: WorkspaceCanvasFlowNode['data']['kind'] | null = null
      let measuredPosition: { readonly x: number; readonly y: number } | null = null
      const measuredNodes = currentNodes.map((node) => {
        if (node.id !== nodeId) return node
        measuredKind = node.data.kind
        measuredPosition = node.position

        const nextHeight = resolveWorkspaceCanvasMeasuredNodeHeight({
          kind: node.data.kind,
          measuredHeight: size.height,
        })
        const currentStyleHeight = numericStyleDimension(node.style?.height) ?? node.data.height
        if (
          Math.abs(nextHeight - node.data.height) <= MEASURED_NODE_SIZE_EPSILON &&
          Math.abs(nextHeight - currentStyleHeight) <= MEASURED_NODE_SIZE_EPSILON
        ) {
          return node
        }

        changed = true
        return {
          ...node,
          style: {
            ...node.style,
            height: nextHeight,
          },
          data: {
            ...node.data,
            height: nextHeight,
          },
        }
      })
      if (!changed) return currentNodes

      const normalizedNodes = normalizeNodesToLayoutBasePositions(measuredNodes)
      const relayoutedNodes = relayoutEditAssetsBelowScript(normalizedNodes)
      const measuredNodePosition = measuredPosition
        ? new Map([[nodeId, measuredPosition]])
        : undefined
      const preservedNodePositions = mergePreservedNodePositions(
        expansionAnchorNodePositionsRef.current,
        measuredNodePosition,
      )
      const alignOptions = { preservedNodeIds: preservedNodeIdSet(preservedNodePositions) }
      const alignedNodes = alignSpaceConsistencyNodesToMeasuredEditScript(relayoutedNodes, alignOptions)
      const baseAlignedNodes = measuredKind === 'editScript'
        ? captureLayoutBasePositions(alignedNodes)
        : alignedNodes
      return composeWorkspaceCanvasLegacyLayout({
        nodes: baseAlignedNodes,
        model: buildWorkspaceCanvasLegacyLayoutModel(baseAlignedNodes, { preservedNodePositions }),
        preservedNodePositions,
      })
    })
  }, [])
  const attachNodeUiState = useCallback((
    inputNodes: readonly WorkspaceCanvasFlowNode[],
    options?: WorkspaceNodeDynamicLayoutOptions,
  ) => {
    const defaultExpandedNodeIds = new Set<string>()
    const baseNodes = preserveWorkspaceNodePositions(
      normalizeNodesToLayoutBasePositions(inputNodes),
      options?.preservedNodePositions,
    )
    const nextNodes = baseNodes.map((node) => {
      const editScriptId = node.data.action?.type === 'generate_edit_storyboard_coordinates'
        ? node.data.action.editScriptId
        : null
      const panelImageTaskState = node.data.kind === 'shot' && node.data.targetType === 'panel'
        ? panelImageTaskStateByKeyRef.current.get(taskTargetPairKey('ProjectPanel', node.data.targetId)) ?? null
        : null
      const storyboardConsistencyTaskState = node.data.kind === 'spaceConsistency' && node.data.targetType === 'storyboard'
        ? storyboardConsistencyTaskStateByKeyRef.current.get(taskTargetPairKey('ProjectStoryboard', node.data.targetId)) ?? null
        : null
      const editScriptConsistencyTaskState = node.data.kind === 'spaceConsistency' && editScriptId
        ? editScriptConsistencyTaskStateByKeyRef.current.get(taskTargetPairKey('ProjectEditScript', editScriptId)) ?? null
        : null
      const panelImageTaskRunning = isTaskRuntimeRunningPhase(panelImageTaskState?.phase)
      const panelImageTaskFailed = panelImageTaskState?.phase === 'failed'
      const isPanelShotNode = node.data.kind === 'shot' && node.data.targetType === 'panel'
      const storyboardConsistencyTaskRunning = isTaskRuntimeRunningPhase(storyboardConsistencyTaskState?.phase)
      const editScriptConsistencyTaskRunning = isTaskRuntimeRunningPhase(editScriptConsistencyTaskState?.phase)
      const consistencyTaskFailed = storyboardConsistencyTaskState?.phase === 'failed' || editScriptConsistencyTaskState?.phase === 'failed'
      const isSpaceConsistencyNode = node.data.kind === 'spaceConsistency'
      const isOptimisticallyRunning = optimisticRunningNodeIdsRef.current.has(node.id) && node.data.isRunning !== true
      const shouldShowRunning = panelImageTaskRunning || isOptimisticallyRunning || node.data.isRunning === true
      const shouldShowSpaceConsistencyRunning = storyboardConsistencyTaskRunning || editScriptConsistencyTaskRunning || isOptimisticallyRunning
      const profile = getWorkspaceCanvasNodePresentationProfile(node.data.kind)
      const defaultExpanded = node.data.defaultExpanded ?? profile.defaultExpanded
      if (defaultExpanded) defaultExpandedNodeIds.add(node.id)
      const expanded = nodeExpansionOverrides.get(node.id) ?? defaultExpanded
      const size = resolveWorkspaceCanvasNodeSize({
        kind: node.data.kind,
        expanded,
        collapsedSize: {
          width: node.data.width,
          height: node.data.height,
        },
      })
      return {
        ...node,
        style: {
          ...node.style,
          width: size.width,
          height: size.height,
        },
        data: {
          ...node.data,
          ...(isPanelShotNode
            ? {
                isRunning: shouldShowRunning,
                statusLabel: shouldShowRunning
                  ? nodeRunningStatusLabel(node)
                  : panelImageTaskFailed
                    ? t('status.failed')
                    : t('status.ready'),
              }
            : isSpaceConsistencyNode
              ? {
                  isRunning: shouldShowSpaceConsistencyRunning,
                  statusLabel: shouldShowSpaceConsistencyRunning
                    ? nodeRunningStatusLabel(node)
                    : consistencyTaskFailed
                      ? t('status.failed')
                      : node.data.statusLabel,
                }
            : isOptimisticallyRunning
            ? {
                isRunning: true,
                statusLabel: nodeRunningStatusLabel(node),
              }
            : {}),
          expanded,
          expandedLayout: expanded ? profile.expandedLayout : undefined,
          onToggleExpanded: toggleNodeExpanded,
          onMeasureNodeSize: handleMeasuredNodeSize,
        },
      }
    })
    defaultExpandedNodeIdsRef.current = defaultExpandedNodeIds
    return composeWorkspaceCanvasLegacyLayout({
      nodes: nextNodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nextNodes, options),
      preservedNodePositions: options?.preservedNodePositions,
    })
  }, [handleMeasuredNodeSize, nodeExpansionOverrides, nodeRunningStatusLabel, t, toggleNodeExpanded])
  const readExpansionAnchorNodePositions = useCallback(() => (
    expansionAnchorNodePositionsRef.current.size > 0 ? expansionAnchorNodePositionsRef.current : undefined
  ), [])

  const projection = useWorkspaceNodeCanvasProjection({
    projectId,
    episodeId: episodeId ?? 'pending-episode',
    episodeName,
    storyText: novelText,
    clips,
    storyboards,
    shots,
    editScreenplay,
    editScript: projectedEditScript,
    editScriptPending: effectiveEditScriptPending,
    finalVideo,
    videoGroups,
    defaultVideoModel: runtime.singleShotVideoModel ?? runtime.videoModel ?? null,
    defaultSequenceVideoModel: runtime.sequenceVideoModel ?? null,
    finalRenderPhase: finalRenderTaskState?.phase,
    finalRenderErrorMessage: finalRenderTaskState?.lastError?.message ?? null,
    bgmScorePhase: bgmScoreTaskState?.phase,
    bgmScoreErrorMessage: bgmScoreTaskState?.lastError?.message ?? null,
    savedLayouts: savedNodeLayouts,
    translate: t,
    onAction: onNodeAction,
  })
  const projectionEdges = projection.edges
  const panelImageTargets = useMemo(() => (
    projection.nodes.flatMap((node) => (
      node.data.kind === 'shot' && node.data.targetType === 'panel'
        ? [TASK_RUNTIME_TARGETS.projectPanelImage(node.data.targetId)].filter((target) => target !== null)
        : []
    ))
  ), [projection.nodes])
  const panelImageTaskStateMap = useTaskTargetStateMap(projectId, panelImageTargets, {
    enabled: Boolean(projectId && panelImageTargets.length > 0),
    staleTime: 1000,
  })
  useTaskTargetTerminalInvalidation({
    projectId,
    episodeId,
    states: panelImageTaskStateMap.data,
    enabled: panelImageTargets.length > 0,
  })
  const storyboardConsistencyTargets = useMemo(() => (
    projection.nodes.flatMap((node) => (
      node.data.kind === 'spaceConsistency' && node.data.targetType === 'storyboard'
        ? [TASK_RUNTIME_TARGETS.projectStoryboardConsistency(node.data.targetId)].filter((target) => target !== null)
        : []
    ))
  ), [projection.nodes])
  const editScriptConsistencyTargets = useMemo(() => (
    projection.nodes.flatMap((node) => {
      const action = node.data.action
      return node.data.kind === 'spaceConsistency' && action?.type === 'generate_edit_storyboard_coordinates'
        ? [TASK_RUNTIME_TARGETS.projectEditScriptStoryboardPrepare(action.editScriptId)].filter((target) => target !== null)
        : []
    })
  ), [projection.nodes])
  const storyboardConsistencyTaskStateMap = useTaskTargetStateMap(projectId, storyboardConsistencyTargets, {
    enabled: Boolean(projectId && storyboardConsistencyTargets.length > 0),
    staleTime: 1000,
  })
  const editScriptConsistencyTaskStateMap = useTaskTargetStateMap(projectId, editScriptConsistencyTargets, {
    enabled: Boolean(projectId && editScriptConsistencyTargets.length > 0),
    staleTime: 1000,
  })
  const panelImageTaskStateSignature = useMemo(
    () => taskRuntimeStateMapSignature(panelImageTaskStateMap.byKey),
    [panelImageTaskStateMap.byKey],
  )
  const storyboardConsistencyTaskStateSignature = useMemo(
    () => taskRuntimeStateMapSignature(storyboardConsistencyTaskStateMap.byKey),
    [storyboardConsistencyTaskStateMap.byKey],
  )
  const editScriptConsistencyTaskStateSignature = useMemo(
    () => taskRuntimeStateMapSignature(editScriptConsistencyTaskStateMap.byKey),
    [editScriptConsistencyTaskStateMap.byKey],
  )
  panelImageTaskStateByKeyRef.current = panelImageTaskStateMap.byKey
  storyboardConsistencyTaskStateByKeyRef.current = storyboardConsistencyTaskStateMap.byKey
  editScriptConsistencyTaskStateByKeyRef.current = editScriptConsistencyTaskStateMap.byKey

  const projectionNodeSignature = useMemo(
    () => buildWorkspaceCanvasNodeSignature(projection.nodes),
    [projection.nodes],
  )
  const projectionEdgeSignature = useMemo(
    () => buildWorkspaceCanvasEdgeSignature(projectionEdges),
    [projectionEdges],
  )
  if (stableEdgesRef.current?.signature !== projectionEdgeSignature) {
    stableEdgesRef.current = {
      signature: projectionEdgeSignature,
      edges: [...projectionEdges],
    }
  }
  const flowEdges = stableEdgesRef.current.edges

  useEffect(() => {
    if (appliedProjectionNodeSignatureRef.current === projectionNodeSignature) return
    appliedProjectionNodeSignatureRef.current = projectionNodeSignature
    setSourceNodes(attachNodeUiState(projection.nodes, {
      preservedNodePositions: readExpansionAnchorNodePositions(),
    }))
  }, [attachNodeUiState, projection.nodes, projectionNodeSignature, readExpansionAnchorNodePositions])

  useEffect(() => {
    setSourceNodes((currentNodes) => attachNodeUiState(currentNodes, {
      preservedNodePositions: readExpansionAnchorNodePositions(),
    }))
  }, [attachNodeUiState, panelImageTaskStateSignature, readExpansionAnchorNodePositions])

  useEffect(() => {
    setSourceNodes((currentNodes) => attachNodeUiState(currentNodes, {
      preservedNodePositions: readExpansionAnchorNodePositions(),
    }))
  }, [
    attachNodeUiState,
    editScriptConsistencyTaskStateSignature,
    readExpansionAnchorNodePositions,
    storyboardConsistencyTaskStateSignature,
  ])

  useEffect(() => {
    const projectionByNodeId = new Map(projection.nodes.map((node) => [node.id, node]))
    let changed = false
    const nextIds = new Set<string>()
    optimisticRunningNodeIdsRef.current.forEach((nodeId) => {
      const projectedNode = projectionByNodeId.get(nodeId)
      if (!projectedNode || projectedNode.data.isRunning === true) {
        const timer = optimisticRunningClearTimersRef.current.get(nodeId)
        if (timer !== undefined) {
          window.clearTimeout(timer)
          optimisticRunningClearTimersRef.current.delete(nodeId)
        }
        changed = true
        return
      }
      nextIds.add(nodeId)
    })
    if (changed) optimisticRunningNodeIdsRef.current = nextIds
  }, [projection.nodes, projectionNodeSignature])

  useEffect(() => () => {
    optimisticRunningClearTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    optimisticRunningClearTimersRef.current.clear()
  }, [])

  useEffect(() => {
    setSourceNodes((currentNodes) => attachNodeUiState(currentNodes, {
      preservedNodePositions: readExpansionAnchorNodePositions(),
    }))
  }, [attachNodeUiState, readExpansionAnchorNodePositions])

  useEffect(() => {
    const projectedNodeIds = new Set(projection.nodes.map((node) => node.id))
    const nextAnchorPositions = new Map<string, { readonly x: number; readonly y: number }>()
    expansionAnchorNodePositionsRef.current.forEach((position, nodeId) => {
      if (projectedNodeIds.has(nodeId)) nextAnchorPositions.set(nodeId, position)
    })
    if (nextAnchorPositions.size !== expansionAnchorNodePositionsRef.current.size) {
      expansionAnchorNodePositionsRef.current = nextAnchorPositions
    }
    setNodeExpansionOverrides((current) => {
      let changed = false
      const next = new Map<string, boolean>()
      current.forEach((expanded, nodeId) => {
        if (projectedNodeIds.has(nodeId)) {
          next.set(nodeId, expanded)
        } else {
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [projection.nodes, projectionNodeSignature])

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

  const handleNodesChange = useCallback((changes: NodeChange<WorkspaceCanvasFlowNode>[]) => {
    setSourceNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
  }, [])

  const handleNodeDragStop = useCallback<OnNodeDrag<WorkspaceCanvasFlowNode>>((_event, node, draggedNodes) => {
    const movedNodesById = new Map<string, WorkspaceCanvasFlowNode>(
      [node, ...draggedNodes].map((movedNode) => [movedNode.id, movedNode]),
    )
    const movedNodeIds = new Set(movedNodesById.keys())
    if ([...movedNodeIds].some((nodeId) => expansionAnchorNodePositionsRef.current.has(nodeId))) {
      const nextAnchors = new Map(expansionAnchorNodePositionsRef.current)
      movedNodeIds.forEach((nodeId) => nextAnchors.delete(nodeId))
      expansionAnchorNodePositionsRef.current = nextAnchors
    }
    const currentNodes = reactFlow.getNodes().map((currentNode) => movedNodesById.get(currentNode.id) ?? currentNode)
    const repairedLayoutNodes = repairWorkspaceCanvasDraggedLayout({
      nodes: currentNodes,
      movedNodeIds,
    })
    const repairedNodes = attachNodeUiState(repairedLayoutNodes)
    setSourceNodes(repairedNodes)
    persistCurrentLayoutSafely(repairedNodes)
  }, [attachNodeUiState, persistCurrentLayoutSafely, reactFlow])

  const handleNodeClick = useCallback<NodeMouseHandler<WorkspaceCanvasFlowNode>>((_event, node) => {
    if (node.data.kind === 'analysis' || node.data.kind === 'storyInput') return
    setSelectedNodeId(node.id)
  }, [])

  const applyWheelZoom = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return

    event.preventDefault()

    const viewport = reactFlow.getViewport()
    const nextZoom = getNextWorkspaceCanvasWheelZoom(viewport.zoom, event.deltaY)
    if (nextZoom === viewport.zoom) return

    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    const zoomRatio = nextZoom / viewport.zoom
    const nextViewport: Viewport = {
      x: pointerX - (pointerX - viewport.x) * zoomRatio,
      y: pointerY - (pointerY - viewport.y) * zoomRatio,
      zoom: nextZoom,
    }

    void reactFlow.setViewport(nextViewport)
  }, [reactFlow])

  const resetLayout = useCallback(() => {
    if (!episodeId) return
    expansionAnchorNodePositionsRef.current = new Map()
    const defaultProjection = buildWorkspaceNodeCanvasProjection({
      projectId,
      episodeId,
      episodeName,
      storyText: novelText,
      clips,
      storyboards,
      shots,
      editScreenplay,
      editScript: projectedEditScript,
      editScriptPending: effectiveEditScriptPending,
      finalVideo,
      videoGroups,
      defaultVideoModel: runtime.singleShotVideoModel ?? runtime.videoModel ?? null,
      defaultSequenceVideoModel: runtime.sequenceVideoModel ?? null,
      finalRenderPhase: finalRenderTaskState?.phase,
      finalRenderErrorMessage: finalRenderTaskState?.lastError?.message ?? null,
      bgmScorePhase: bgmScoreTaskState?.phase,
      bgmScoreErrorMessage: bgmScoreTaskState?.lastError?.message ?? null,
      savedLayouts: EMPTY_SAVED_NODE_LAYOUTS,
      translate: t,
      onAction: onNodeAction,
    })
    setSourceNodes(attachNodeUiState(defaultProjection.nodes))
    void resetSavedLayout().catch((error: unknown) => {
      _ulogWarn('[ProjectWorkspaceCanvas] canvas layout reset failed', error)
    })
  }, [attachNodeUiState, bgmScoreTaskState?.lastError?.message, bgmScoreTaskState?.phase, clips, editScreenplay, effectiveEditScriptPending, episodeId, episodeName, finalRenderTaskState?.lastError?.message, finalRenderTaskState?.phase, finalVideo, novelText, onNodeAction, projectId, projectedEditScript, resetSavedLayout, runtime.sequenceVideoModel, runtime.singleShotVideoModel, runtime.videoModel, shots, storyboards, t, videoGroups])

  const fitView = useCallback(() => {
    void reactFlow.fitView({ padding: 0.14, duration: 180 })
  }, [reactFlow])
  const zoomIn = useCallback(() => {
    void reactFlow.zoomIn({ duration: 160 })
  }, [reactFlow])
  const zoomOut = useCallback(() => {
    void reactFlow.zoomOut({ duration: 160 })
  }, [reactFlow])
  const selectedNode = useMemo(
    () => sourceNodes.find((node) => node.id === selectedNodeId) ?? null,
    [sourceNodes, selectedNodeId],
  )
  const assistantSelection = useMemo<WorkspaceAssistantSelectionContext>(() => {
    if (!selectedNode) return {}
    const targetType = selectedNode.data.targetType
    const targetId = selectedNode.data.targetId
    return {
      selectedScopeRef: `${targetType}:${targetId}`,
      selectedPanelId: targetType === 'panel' ? targetId : null,
      selectedClipId: targetType === 'clip' ? targetId : null,
      selectedAssetId: null,
    }
  }, [selectedNode])

  useEffect(() => {
    onAssistantSelectionChange?.(assistantSelection)
  }, [assistantSelection, onAssistantSelectionChange])

  if (!episodeId) return null

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-[var(--glass-bg-canvas)]">
      <div ref={canvasRef} className="h-full" onWheelCapture={applyWheelZoom}>
        <ReactFlow
          nodes={sourceNodes}
          edges={flowEdges}
          nodeTypes={workspaceNodeTypes}
          onNodesChange={handleNodesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedNodeId(null)}
          onNodeDragStop={handleNodeDragStop}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={WORKSPACE_CANVAS_MIN_ZOOM}
          maxZoom={WORKSPACE_CANVAS_MAX_ZOOM}
          zoomOnScroll={false}
          defaultViewport={DEFAULT_WORKSPACE_CANVAS_VIEWPORT}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
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
              onResetLayout={resetLayout}
              onFitView={fitView}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
            />
          </Panel>
        </ReactFlow>
      </div>
    </div>
  )
}

interface ProjectWorkspaceCanvasProps {
  onAssistantSelectionChange?: (selection: WorkspaceAssistantSelectionContext) => void
  editScriptPending?: boolean
}

export default function ProjectWorkspaceCanvas({ onAssistantSelectionChange, editScriptPending = false }: ProjectWorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProjectWorkspaceCanvasContent
        onAssistantSelectionChange={onAssistantSelectionChange}
        editScriptPending={editScriptPending}
      />
    </ReactFlowProvider>
  )
}
