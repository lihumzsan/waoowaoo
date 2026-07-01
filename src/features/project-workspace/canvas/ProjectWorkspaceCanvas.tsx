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
import type { BillingActionQuotePreview } from '@/lib/billing/action-quote-preview'
import {
  isTaskRuntimeRunningPhase,
  taskRuntimeStateMapSignature,
  TASK_RUNTIME_TARGETS,
  type TaskRuntimeStateLike,
} from '@/lib/task/runtime-targets'
import { EDIT_FIRST_CANVAS_PENDING_WORKFLOW } from '@/lib/project-workflow/edit-first-canvas-visibility'
import { useTaskTargetTerminalInvalidation } from '@/lib/query/hooks/useTaskTargetTerminalInvalidation'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import { useProjectContext, useProjectEditScreenplay, useProjectEditScript, useProjectEditShotExecutionPlan } from '@/lib/query/hooks'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import { useWorkspaceEpisodeCanvasData } from '../hooks/useWorkspaceEpisodeCanvasData'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import { useWorkspaceRuntime } from '../WorkspaceRuntimeContext'
import type { WorkspaceAssistantActiveFocusRequest } from '../workspace-assistant-focus'
import { useCanvasLayoutPersistence } from './hooks/useCanvasLayoutPersistence'
import {
  useWorkspaceCanvasActionBillingPreviews,
  workspaceCanvasActionBillingPreviewKey,
} from './hooks/useWorkspaceCanvasActionBillingPreviews'
import {
  buildWorkspaceNodeCanvasProjection,
  useWorkspaceNodeCanvasProjection,
} from './hooks/useWorkspaceNodeCanvasProjection'
import { useWorkspaceNodeCanvasActions } from './hooks/useWorkspaceNodeCanvasActions'
import {
  resolveWorkspaceCanvasFocusNodeIds,
  resolveWorkspaceCanvasStyleBibleFocusNodeIds,
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
import { workspaceNodeTypes } from './nodes/workspaceNodeTypes'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeAction,
} from './node-canvas-types'
import GenerationSegmentArrangementModal from './GenerationSegmentArrangementModal'
import {
  getWorkspaceCanvasNodePresentationProfile,
  resolveCompletedWorkspaceCanvasStreamingDisclosureNodeIds,
  resolveWorkspaceCanvasMeasuredNodeHeight,
  resolveWorkspaceCanvasNodeDisclosure,
  resolveWorkspaceCanvasNodeSize,
} from './node-presentation-profiles'
import {
  alignExecutionPlanNodesToMeasuredEditScript,
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
import {
  collectWorkspaceNodeRuntimeTargets,
  resolveWorkspaceNodeRuntimePatch,
} from './workspace-node-runtime'
import {
  applyWorkspaceStructuredStreamPatches,
  useWorkspaceStructuredStreamRuntime,
} from './structured-stream/useWorkspaceStructuredStreamRuntime'

const EMPTY_SAVED_NODE_LAYOUTS: readonly CanvasNodeLayout[] = []
const CANVAS_FLOATING_PANEL_BOTTOM_OFFSET_PX = 56
const OPTIMISTIC_NODE_RUNNING_TIMEOUT_MS = 15000
const FOCUS_HIGHLIGHT_TIMEOUT_MS = 3200
const MEASURED_NODE_SIZE_EPSILON = 1

export interface WorkspaceAssistantSelectionContext {
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedAssetId?: string | null
}

interface ProjectWorkspaceCanvasContentProps {
  onAssistantSelectionChange?: (selection: WorkspaceAssistantSelectionContext) => void
  editScriptPending?: boolean
  activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
  styleBibleFocusRequestId?: number
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

function numericStyleDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

function attachWorkspaceCanvasBillingPreviewLabels(params: {
  readonly projectId?: string | null
  readonly episodeId?: string | null
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly previews: ReadonlyMap<string, BillingActionQuotePreview>
}): WorkspaceCanvasFlowNode[] {
  return params.nodes.map((node) => {
    const actionKey = workspaceCanvasActionBillingPreviewKey({
      projectId: params.projectId,
      episodeId: params.episodeId,
      action: node.data.action,
    })
    const secondaryActionKey = workspaceCanvasActionBillingPreviewKey({
      projectId: params.projectId,
      episodeId: params.episodeId,
      action: node.data.secondaryAction,
    })
    const tertiaryActionKey = workspaceCanvasActionBillingPreviewKey({
      projectId: params.projectId,
      episodeId: params.episodeId,
      action: node.data.tertiaryAction,
    })
    const actionBillingQuote = actionKey ? params.previews.get(actionKey) : undefined
    const secondaryActionBillingQuote = secondaryActionKey ? params.previews.get(secondaryActionKey) : undefined
    const tertiaryActionBillingQuote = tertiaryActionKey ? params.previews.get(tertiaryActionKey) : undefined
    if (!actionBillingQuote && !secondaryActionBillingQuote && !tertiaryActionBillingQuote) return node
    return {
      ...node,
      data: {
        ...node.data,
        ...(actionBillingQuote ? { actionBillingQuote } : {}),
        ...(secondaryActionBillingQuote ? { secondaryActionBillingQuote } : {}),
        ...(tertiaryActionBillingQuote ? { tertiaryActionBillingQuote } : {}),
      },
    }
  })
}

function ProjectWorkspaceCanvasContent({
  onAssistantSelectionChange,
  editScriptPending = false,
  activeAssistantFocusRequest = null,
  styleBibleFocusRequestId = 0,
}: ProjectWorkspaceCanvasContentProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace')
  const billingT = useTranslations('assistantAgent')
  const { projectId, episodeId } = useWorkspaceProvider()
  const runtime = useWorkspaceRuntime()
  const { episodeName, novelText, storyboards, finalVideo, videoGroups } = useWorkspaceEpisodeCanvasData()
  const { data: projectContext } = useProjectContext(projectId, episodeId ?? null)
  const { data: editScreenplay } = useProjectEditScreenplay(projectId, episodeId ?? null)
  const { data: editScript } = useProjectEditScript(projectId, episodeId ?? null)
  const { data: editShotExecutionPlan } = useProjectEditShotExecutionPlan(projectId, episodeId ?? null)
  const editFirstWorkflow = projectContext?.editFirstWorkflow ?? EDIT_FIRST_CANVAS_PENDING_WORKFLOW
  const reactFlow = useReactFlow<WorkspaceCanvasFlowNode>()
  const runNodeAction = useWorkspaceNodeCanvasActions()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [sourceNodes, setSourceNodes] = useState<WorkspaceCanvasFlowNode[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true)
  const [handledStyleBibleFocusRequestId, setHandledStyleBibleFocusRequestId] = useState(0)
  const [generationSegmentArrangementInitialIndex, setGenerationSegmentArrangementInitialIndex] = useState<number | null>(null)
  const [nodeExpansionOverrides, setNodeExpansionOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const streamingDisclosureNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  const optimisticRunningNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  const optimisticRunningClearTimersRef = useRef<Map<string, number>>(new Map())
  const focusHighlightedNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  const focusHighlightClearTimersRef = useRef<Map<string, number>>(new Map())
  const workspaceTaskStateByQueryKeyRef = useRef<ReadonlyMap<string, TaskRuntimeStateLike>>(new Map())
  const projectedNodeByIdRef = useRef<ReadonlyMap<string, WorkspaceCanvasFlowNode>>(new Map())
  const expansionAnchorNodePositionsRef = useRef<ReadonlyMap<string, { readonly x: number; readonly y: number }>>(new Map())
  const appliedProjectionNodeSignatureRef = useRef<string | null>(null)
  const stableEdgesRef = useRef<{
    signature: string
    edges: WorkspaceCanvasFlowEdge[]
  } | null>(null)
  const activeAssistantOperationId = activeAssistantFocusRequest?.operationId ?? null

  const {
    layout,
    saveLayout,
    resetLayout: resetSavedLayout,
  } = useCanvasLayoutPersistence({
    projectId,
    episodeId: episodeId ?? '',
  })

  const savedNodeLayouts = layout?.nodeLayouts ?? EMPTY_SAVED_NODE_LAYOUTS
  const savedNodeLayoutPositions = useMemo(() => {
    const positions = new Map<string, { readonly x: number; readonly y: number }>()
    savedNodeLayouts.forEach((nodeLayout) => {
      positions.set(nodeLayout.nodeKey, {
        x: nodeLayout.x,
        y: nodeLayout.y,
      })
    })
    return positions
  }, [savedNodeLayouts])
  const editScriptGenerationTargets = useMemo(
    () => {
      const target = TASK_RUNTIME_TARGETS.projectEpisodeEditScriptGeneration(episodeId)
      return target ? [target] : []
    },
    [episodeId],
  )
  const editScriptGenerationTaskStateMap = useTaskTargetStateMap(projectId, editScriptGenerationTargets, {
    enabled: Boolean(projectId && episodeId),
    staleTime: 1000,
  })
  const editScriptGenerationTaskState = editScriptGenerationTaskStateMap.getQueryState(editScriptGenerationTargets[0] ?? { targetType: '', targetId: '' })
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
  const effectiveEditScriptPending = editScriptPending
    || activeAssistantOperationId === 'generate_edit_script'
    || (editScriptGenerationActive && !editScript)
  const nodeRunningStatusLabel = useCallback((): string => (
    t('status.processing')
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
  const restoreNodeRuntimeBaseline = useCallback((nodeId: string) => {
    setSourceNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== nodeId) return node
      const projectedNode = projectedNodeByIdRef.current.get(nodeId)
      if (!projectedNode) {
        return {
          ...node,
          data: {
            ...node.data,
            isRunning: false,
          },
        }
      }
      const runtimePatch = resolveWorkspaceNodeRuntimePatch({
        node: projectedNode,
        statesByQueryKey: workspaceTaskStateByQueryKeyRef.current,
        isOptimisticallyRunning: false,
        labels: {
          running: nodeRunningStatusLabel(),
          failed: t('status.failed'),
        },
      })
      return {
        ...node,
        data: {
          ...node.data,
          ...runtimePatch,
        },
      }
    }))
  }, [nodeRunningStatusLabel, t])
  const markNodeOptimisticallyRunning = useCallback((nodeId: string) => {
    const previousTimer = optimisticRunningClearTimersRef.current.get(nodeId)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const nextIds = new Set(optimisticRunningNodeIdsRef.current)
    nextIds.add(nodeId)
    optimisticRunningNodeIdsRef.current = nextIds
    const timer = window.setTimeout(() => {
      clearOptimisticRunningNode(nodeId)
      restoreNodeRuntimeBaseline(nodeId)
    }, OPTIMISTIC_NODE_RUNNING_TIMEOUT_MS)
    optimisticRunningClearTimersRef.current.set(nodeId, timer)
    setSourceNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            artifactPhase: 'running',
            isRunning: true,
            statusLabel: nodeRunningStatusLabel(),
          },
        }
      : node))
  }, [clearOptimisticRunningNode, nodeRunningStatusLabel, restoreNodeRuntimeBaseline])
  const clearFocusHighlightedNode = useCallback((nodeId: string) => {
    const timer = focusHighlightClearTimersRef.current.get(nodeId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      focusHighlightClearTimersRef.current.delete(nodeId)
    }
    const nextIds = new Set(focusHighlightedNodeIdsRef.current)
    nextIds.delete(nodeId)
    focusHighlightedNodeIdsRef.current = nextIds
    setSourceNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId && node.data.focusHighlighted === true
      ? {
          ...node,
          data: {
            ...node.data,
            focusHighlighted: false,
          },
        }
      : node))
  }, [])
  const markNodesFocusHighlighted = useCallback((nodeIds: readonly string[]) => {
    if (nodeIds.length === 0) return
    const nextIds = new Set(focusHighlightedNodeIdsRef.current)
    nodeIds.forEach((nodeId) => {
      const existingTimer = focusHighlightClearTimersRef.current.get(nodeId)
      if (existingTimer !== undefined) window.clearTimeout(existingTimer)
      nextIds.add(nodeId)
    })
    focusHighlightedNodeIdsRef.current = nextIds
    const nodeIdSet = new Set(nodeIds)
    setSourceNodes((currentNodes) => currentNodes.map((node) => nodeIdSet.has(node.id)
      ? {
          ...node,
          data: {
            ...node.data,
            focusHighlighted: true,
          },
        }
      : node))
    nodeIds.forEach((nodeId) => {
      const timer = window.setTimeout(() => clearFocusHighlightedNode(nodeId), FOCUS_HIGHLIGHT_TIMEOUT_MS)
      focusHighlightClearTimersRef.current.set(nodeId, timer)
    })
  }, [clearFocusHighlightedNode])
  const onNodeAction = useCallback(async (action: WorkspaceCanvasNodeAction, nodeId?: string) => {
    if (action.type === 'open_video_block_arrangement') {
      setGenerationSegmentArrangementInitialIndex(action.segmentIndex)
      return
    }

    if (nodeId) markNodeOptimisticallyRunning(nodeId)
    try {
      await runNodeAction(action)
    } catch (error: unknown) {
      if (nodeId) {
        clearOptimisticRunningNode(nodeId)
        restoreNodeRuntimeBaseline(nodeId)
      }
      _ulogWarn('[ProjectWorkspaceCanvas] node action failed', error)
      throw error
    }
  }, [clearOptimisticRunningNode, markNodeOptimisticallyRunning, restoreNodeRuntimeBaseline, runNodeAction])
  const toggleNodeExpanded = useCallback((nodeId: string) => {
    const anchorNode = reactFlow.getNode(nodeId)
    if (anchorNode?.data.disclosure && !anchorNode.data.disclosure.canToggle) return
    if (anchorNode) {
      const nextAnchors = new Map(expansionAnchorNodePositionsRef.current)
      nextAnchors.set(nodeId, anchorNode.position)
      expansionAnchorNodePositionsRef.current = nextAnchors
    }
    setNodeExpansionOverrides((current) => {
      const currentExpanded = anchorNode?.data.disclosure?.effectiveExpanded ?? current.get(nodeId) ?? false
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
        savedNodeLayoutPositions,
        expansionAnchorNodePositionsRef.current,
        measuredNodePosition,
      )
      const alignOptions = { preservedNodeIds: preservedNodeIdSet(preservedNodePositions) }
      const alignedNodes = alignExecutionPlanNodesToMeasuredEditScript(relayoutedNodes, alignOptions)
      const baseAlignedNodes = measuredKind === 'editScript'
        ? captureLayoutBasePositions(alignedNodes)
        : alignedNodes
      return composeWorkspaceCanvasLegacyLayout({
        nodes: baseAlignedNodes,
        model: buildWorkspaceCanvasLegacyLayoutModel(baseAlignedNodes, { preservedNodePositions }),
        preservedNodePositions,
      })
    })
  }, [savedNodeLayoutPositions])
  const attachNodeUiState = useCallback((
    inputNodes: readonly WorkspaceCanvasFlowNode[],
    options?: WorkspaceNodeDynamicLayoutOptions,
  ) => {
    const baseNodes = preserveWorkspaceNodePositions(
      normalizeNodesToLayoutBasePositions(inputNodes),
      options?.preservedNodePositions,
    )
    const nextNodes = baseNodes.map((node) => {
      const isOptimisticallyRunning = optimisticRunningNodeIdsRef.current.has(node.id)
      const runtimePatch = resolveWorkspaceNodeRuntimePatch({
        node,
        statesByQueryKey: workspaceTaskStateByQueryKeyRef.current,
        isOptimisticallyRunning,
        labels: {
          running: nodeRunningStatusLabel(),
          failed: t('status.failed'),
        },
      })
      const profile = getWorkspaceCanvasNodePresentationProfile(node.data.kind)
      const patchedData = {
        ...node.data,
        ...runtimePatch,
      }
      const isStreaming = patchedData.streamPresentation?.isStreaming === true
      const shouldCollapseCompletedStream = !isStreaming
        && streamingDisclosureNodeIdsRef.current.has(node.id)
        && profile.disclosure.kind === 'collapsible'
        && profile.disclosure.collapseWhenStreamCompletes
      const disclosure = resolveWorkspaceCanvasNodeDisclosure({
        kind: patchedData.kind,
        userExpandedOverride: shouldCollapseCompletedStream ? false : nodeExpansionOverrides.get(node.id),
        defaultExpanded: patchedData.defaultExpanded,
        isStreaming,
      })
      const expanded = disclosure.effectiveExpanded
      const size = resolveWorkspaceCanvasNodeSize({
        kind: patchedData.kind,
        expanded,
        collapsedSize: {
          width: patchedData.width,
          height: patchedData.height,
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
          ...patchedData,
          focusHighlighted: focusHighlightedNodeIdsRef.current.has(node.id) ? true : undefined,
          disclosure,
          expanded,
          expandedLayout: expanded ? profile.expandedLayout : undefined,
          onToggleExpanded: toggleNodeExpanded,
          onMeasureNodeSize: handleMeasuredNodeSize,
        },
      }
    })
    return composeWorkspaceCanvasLegacyLayout({
      nodes: nextNodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nextNodes, options),
      preservedNodePositions: options?.preservedNodePositions,
    })
  }, [handleMeasuredNodeSize, nodeExpansionOverrides, nodeRunningStatusLabel, t, toggleNodeExpanded])
  const readCanvasManualNodePositions = useCallback((
    additionalNodePositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  ) => mergePreservedNodePositions(
    savedNodeLayoutPositions,
    expansionAnchorNodePositionsRef.current,
    additionalNodePositions,
  ), [savedNodeLayoutPositions])

  const structuredStreamRuntime = useWorkspaceStructuredStreamRuntime({
    episodeId: episodeId ?? 'pending-episode',
    translate: t,
  })
  const projection = useWorkspaceNodeCanvasProjection({
    projectId,
    episodeId: episodeId ?? 'pending-episode',
    episodeName,
    storyText: novelText,
    storyboards,
    editFirstWorkflow,
    editScreenplay,
    editScript: projectedEditScript,
    editShotExecutionPlan,
    activeAssistantOperationId,
    editScriptPending: effectiveEditScriptPending,
    streamTargets: structuredStreamRuntime.targets,
    finalVideo,
    videoGroups,
    defaultVideoModel: runtime.singleShotVideoModel ?? runtime.videoModel ?? null,
    defaultSequenceVideoModel: runtime.sequenceVideoModel ?? null,
    savedLayouts: savedNodeLayouts,
    translate: t,
    onAction: onNodeAction,
  })
  const projectedNodes = useMemo(
    () => applyWorkspaceStructuredStreamPatches(projection.nodes, structuredStreamRuntime.patches),
    [projection.nodes, structuredStreamRuntime.patches],
  )
  const billingQuoteWithCredits = useCallback(
    (values: { count: number; cost: number }) => billingT('cards.billingQuoteWithCredits', values),
    [billingT],
  )
  const billingQuoteWithoutCredits = useCallback(
    (values: { count: number }) => billingT('cards.billingQuoteWithoutCredits', values),
    [billingT],
  )
  const actionBillingPreviews = useWorkspaceCanvasActionBillingPreviews({
    projectId,
    episodeId,
    nodes: projectedNodes,
    withCredits: billingQuoteWithCredits,
    withoutCredits: billingQuoteWithoutCredits,
  })
  const projectedNodesWithBilling = useMemo(
    () => attachWorkspaceCanvasBillingPreviewLabels({
      projectId,
      episodeId,
      nodes: projectedNodes,
      previews: actionBillingPreviews,
    }),
    [actionBillingPreviews, episodeId, projectId, projectedNodes],
  )
  const projectionEdges = projection.edges
  projectedNodeByIdRef.current = new Map(projectedNodesWithBilling.map((node) => [node.id, node]))
  const workspaceRuntimeTargets = useMemo(
    () => collectWorkspaceNodeRuntimeTargets(projectedNodesWithBilling),
    [projectedNodesWithBilling],
  )
  const workspaceTaskStateMap = useTaskTargetStateMap(projectId, workspaceRuntimeTargets, {
    enabled: Boolean(projectId && workspaceRuntimeTargets.length > 0),
    staleTime: 1000,
  })
  const workspaceTaskStateSignature = useMemo(
    () => taskRuntimeStateMapSignature(workspaceTaskStateMap.byQueryKey),
    [workspaceTaskStateMap.byQueryKey],
  )
  workspaceTaskStateByQueryKeyRef.current = workspaceTaskStateMap.byQueryKey
  const terminalInvalidationStates = useMemo(
    () => [
      ...editScriptGenerationTaskStateMap.data,
      ...workspaceTaskStateMap.data,
    ],
    [editScriptGenerationTaskStateMap.data, workspaceTaskStateMap.data],
  )
  useTaskTargetTerminalInvalidation({
    projectId,
    episodeId,
    states: terminalInvalidationStates,
    enabled: terminalInvalidationStates.length > 0,
  })

  const projectionNodeSignature = useMemo(
    () => buildWorkspaceCanvasNodeSignature(projectedNodesWithBilling),
    [projectedNodesWithBilling],
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
  const operationFocusNodeIds = useMemo(
    () => resolveWorkspaceCanvasFocusNodeIds(sourceNodes, activeAssistantOperationId),
    [activeAssistantOperationId, sourceNodes],
  )
  const hasUnhandledStyleBibleFocusRequest = styleBibleFocusRequestId > handledStyleBibleFocusRequestId
  const styleBibleFocusNodeIds = useMemo(
    () => (
      hasUnhandledStyleBibleFocusRequest
        ? resolveWorkspaceCanvasStyleBibleFocusNodeIds(sourceNodes)
        : []
    ),
    [hasUnhandledStyleBibleFocusRequest, sourceNodes],
  )
  const styleBibleFocusRequestKey = styleBibleFocusNodeIds.length > 0
    ? `style-bible-confirmed:${String(styleBibleFocusRequestId)}`
    : null
  const focusNodeIds = styleBibleFocusNodeIds.length > 0 ? styleBibleFocusNodeIds : operationFocusNodeIds
  const operationFocusRequestKey = operationFocusNodeIds.length > 0
    ? activeAssistantFocusRequest?.requestKey ?? null
    : null
  const focusRequestKey = styleBibleFocusRequestKey ?? operationFocusRequestKey
  const handleFocusComplete = useCallback((focusKey: string) => {
    if (!styleBibleFocusRequestKey) return
    if (!focusKey.startsWith(`${styleBibleFocusRequestKey}:`)) return
    markNodesFocusHighlighted(styleBibleFocusNodeIds)
    setHandledStyleBibleFocusRequestId(styleBibleFocusRequestId)
  }, [markNodesFocusHighlighted, styleBibleFocusNodeIds, styleBibleFocusRequestId, styleBibleFocusRequestKey])
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
    onFocusComplete: handleFocusComplete,
  })

  useEffect(() => {
    if (appliedProjectionNodeSignatureRef.current === projectionNodeSignature) return
    appliedProjectionNodeSignatureRef.current = projectionNodeSignature
    setSourceNodes(attachNodeUiState(projectedNodesWithBilling, {
      preservedNodePositions: readCanvasManualNodePositions(),
    }))
  }, [attachNodeUiState, projectedNodesWithBilling, projectionNodeSignature, readCanvasManualNodePositions])

  useEffect(() => {
    setSourceNodes((currentNodes) => attachNodeUiState(currentNodes, {
      preservedNodePositions: readCanvasManualNodePositions(),
    }))
  }, [
    attachNodeUiState,
    workspaceTaskStateSignature,
    readCanvasManualNodePositions,
  ])

  useEffect(() => {
    const projectionByNodeId = new Map(projectedNodesWithBilling.map((node) => [node.id, node]))
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
  }, [projectedNodesWithBilling, projectionNodeSignature])

  useEffect(() => () => {
    optimisticRunningClearTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    optimisticRunningClearTimersRef.current.clear()
    focusHighlightClearTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    focusHighlightClearTimersRef.current.clear()
  }, [])

  useEffect(() => {
    setSourceNodes((currentNodes) => attachNodeUiState(currentNodes, {
      preservedNodePositions: readCanvasManualNodePositions(),
    }))
  }, [attachNodeUiState, readCanvasManualNodePositions])

  useEffect(() => {
    const currentStreamingNodeIds = new Set<string>()
    sourceNodes.forEach((node) => {
      const disclosure = node.data.disclosure
      if (disclosure?.isStreamingExpanded === true && disclosure.collapseWhenStreamCompletes) {
        currentStreamingNodeIds.add(node.id)
      }
    })
    const completedStreamingNodeIds = resolveCompletedWorkspaceCanvasStreamingDisclosureNodeIds({
      previousStreamingNodeIds: streamingDisclosureNodeIdsRef.current,
      currentStreamingNodeIds,
    })
    streamingDisclosureNodeIdsRef.current = currentStreamingNodeIds
    if (completedStreamingNodeIds.length === 0) return

    setNodeExpansionOverrides((current) => {
      let changed = false
      const next = new Map(current)
      completedStreamingNodeIds.forEach((nodeId) => {
        changed = next.delete(nodeId) || changed
      })
      return changed ? next : current
    })
  }, [sourceNodes])

  useEffect(() => {
    const projectedNodeIds = new Set(projectedNodesWithBilling.map((node) => node.id))
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
  }, [projectedNodesWithBilling, projectionNodeSignature])

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

  const handleNodeDragStart = useCallback<OnNodeDrag<WorkspaceCanvasFlowNode>>(() => {
    notifyCanvasUserInteraction()
  }, [notifyCanvasUserInteraction])

  const handleNodeDragStop = useCallback<OnNodeDrag<WorkspaceCanvasFlowNode>>((_event, node, draggedNodes) => {
    notifyCanvasUserInteraction()
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
  }, [attachNodeUiState, notifyCanvasUserInteraction, persistCurrentLayoutSafely, reactFlow])

  const handleNodeClick = useCallback<NodeMouseHandler<WorkspaceCanvasFlowNode>>((_event, node) => {
    if (node.data.kind === 'analysis') return
    setSelectedNodeId(node.id)
  }, [])

  const applyWheelZoom = useCallback((event: WheelEvent<HTMLDivElement>) => {
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
    expansionAnchorNodePositionsRef.current = new Map()
    const defaultProjection = buildWorkspaceNodeCanvasProjection({
      projectId,
      episodeId,
      episodeName,
      storyText: novelText,
      storyboards,
      editFirstWorkflow,
      editScreenplay,
      editScript: projectedEditScript,
      editShotExecutionPlan,
      activeAssistantOperationId,
      editScriptPending: effectiveEditScriptPending,
      finalVideo,
      videoGroups,
      defaultVideoModel: runtime.singleShotVideoModel ?? runtime.videoModel ?? null,
      defaultSequenceVideoModel: runtime.sequenceVideoModel ?? null,
      savedLayouts: EMPTY_SAVED_NODE_LAYOUTS,
      translate: t,
      onAction: onNodeAction,
    })
    setSourceNodes(attachNodeUiState(defaultProjection.nodes))
    void resetSavedLayout().catch((error: unknown) => {
      _ulogWarn('[ProjectWorkspaceCanvas] canvas layout reset failed', error)
    })
  }, [activeAssistantOperationId, attachNodeUiState, editFirstWorkflow, editScreenplay, editShotExecutionPlan, effectiveEditScriptPending, episodeId, episodeName, finalVideo, novelText, onNodeAction, projectId, projectedEditScript, resetSavedLayout, runtime.sequenceVideoModel, runtime.singleShotVideoModel, runtime.videoModel, storyboards, t, videoGroups])

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
      selectedAssetId: null,
    }
  }, [selectedNode])

  useEffect(() => {
    onAssistantSelectionChange?.(assistantSelection)
  }, [assistantSelection, onAssistantSelectionChange])

  const handleArrangeGenerationSegments = useCallback(async (segments: readonly { readonly shotNumbers: readonly number[]; readonly continuity: string }[]) => {
    if (!projectedEditScript) throw new Error('EDIT_SCRIPT_REQUIRED')
    await runtime.onArrangeGenerationSegments(projectedEditScript.id, segments)
    setGenerationSegmentArrangementInitialIndex(null)
  }, [projectedEditScript, runtime])

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
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onMoveStart={(event) => {
            if (event) notifyCanvasUserInteraction()
          }}
          onMoveEnd={(event) => {
            if (event) notifyCanvasUserInteraction()
          }}
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
      {projectedEditScript && generationSegmentArrangementInitialIndex !== null ? (
        <GenerationSegmentArrangementModal
          editScript={projectedEditScript}
          storyboards={storyboards}
          initialSegmentIndex={generationSegmentArrangementInitialIndex}
          onClose={() => setGenerationSegmentArrangementInitialIndex(null)}
          onSubmit={handleArrangeGenerationSegments}
        />
      ) : null}
    </div>
  )
}

interface ProjectWorkspaceCanvasProps {
  onAssistantSelectionChange?: (selection: WorkspaceAssistantSelectionContext) => void
  editScriptPending?: boolean
  activeAssistantFocusRequest?: WorkspaceAssistantActiveFocusRequest | null
  styleBibleFocusRequestId?: number
}

export default function ProjectWorkspaceCanvas({
  onAssistantSelectionChange,
  editScriptPending = false,
  activeAssistantFocusRequest = null,
  styleBibleFocusRequestId = 0,
}: ProjectWorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProjectWorkspaceCanvasContent
        onAssistantSelectionChange={onAssistantSelectionChange}
        editScriptPending={editScriptPending}
        activeAssistantFocusRequest={activeAssistantFocusRequest}
        styleBibleFocusRequestId={styleBibleFocusRequestId}
      />
    </ReactFlowProvider>
  )
}
