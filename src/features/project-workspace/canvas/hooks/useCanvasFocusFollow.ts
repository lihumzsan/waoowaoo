'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
} from '../node-canvas-types'

const FOCUS_FOLLOW_DEBOUNCE_MS = 240
const FOCUS_FIT_PADDING = 0.3
const FOCUS_FIT_MAX_ZOOM = 1
const FOCUS_FIT_DURATION_MS = 500

export type CanvasFocusFollowDecision = 'idle' | 'focus' | 'pending' | 'skip_already_focused'

interface ResolveCanvasFocusFollowDecisionInput {
  readonly focusKey: string
  readonly enabled: boolean
  readonly suppressedFocusKey: string | null
  readonly lastFocusedKey: string | null
}

export interface UseCanvasFocusFollowParams {
  readonly reactFlow: ReactFlowInstance<WorkspaceCanvasFlowNode>
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly enabled: boolean
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
}

export interface CanvasFocusFollowResult {
  readonly pendingFocusNodeIds: readonly string[]
  readonly focusNow: () => void
  readonly notifyUserInteraction: () => void
}

export function getWorkspaceCanvasRunningNodeIds(
  nodes: readonly WorkspaceCanvasFlowNode[],
): string[] {
  return nodes
    .filter((node) => node.data.isRunning === true)
    .map((node) => node.id)
}

export function buildWorkspaceCanvasFocusKey(nodeIds: readonly string[]): string {
  return [...nodeIds].sort().join('|')
}

export function resolveCanvasFocusFollowDecision({
  focusKey,
  enabled,
  suppressedFocusKey,
  lastFocusedKey,
}: ResolveCanvasFocusFollowDecisionInput): CanvasFocusFollowDecision {
  if (!focusKey) return 'idle'
  if (!enabled || focusKey === suppressedFocusKey) return 'pending'
  if (focusKey === lastFocusedKey) return 'skip_already_focused'
  return 'focus'
}

export function applyWorkspaceCanvasRunningEdgeAnimation(
  edges: readonly WorkspaceCanvasFlowEdge[],
  runningNodeIds: readonly string[],
): WorkspaceCanvasFlowEdge[] {
  const runningNodeIdSet = new Set(runningNodeIds)
  return edges.map((edge) => ({
    ...edge,
    animated: runningNodeIdSet.has(edge.target),
  }))
}

export function useCanvasFocusFollow({
  reactFlow,
  containerRef,
  enabled,
  nodes,
}: UseCanvasFocusFollowParams): CanvasFocusFollowResult {
  const debounceTimerRef = useRef<number | null>(null)
  const focusNodeIdsRef = useRef<readonly string[]>([])
  const currentFocusKeyRef = useRef('')
  const suppressedFocusKeyRef = useRef<string | null>(null)
  const lastFocusedKeyRef = useRef<string | null>(null)
  const [pendingFocusNodeIds, setPendingFocusNodeIds] = useState<readonly string[]>([])

  const focusNodeIds = useMemo(() => getWorkspaceCanvasRunningNodeIds(nodes), [nodes])
  const focusKey = useMemo(() => buildWorkspaceCanvasFocusKey(focusNodeIds), [focusNodeIds])
  focusNodeIdsRef.current = focusNodeIds
  currentFocusKeyRef.current = focusKey

  const collectFocusNodes = useCallback((): WorkspaceCanvasFlowNode[] => {
    const idSet = new Set(focusNodeIdsRef.current)
    if (idSet.size === 0) return []
    return reactFlow.getNodes().filter((node) => idSet.has(node.id))
  }, [reactFlow])

  const runFitView = useCallback((focusNodes: readonly WorkspaceCanvasFlowNode[]) => {
    if (focusNodes.length === 0) return
    void reactFlow.fitView({
      nodes: focusNodes.map((node) => ({ id: node.id })),
      padding: FOCUS_FIT_PADDING,
      maxZoom: FOCUS_FIT_MAX_ZOOM,
      duration: FOCUS_FIT_DURATION_MS,
    })
  }, [reactFlow])

  const focusNow = useCallback(() => {
    const focusNodes = collectFocusNodes()
    const activeFocusKey = currentFocusKeyRef.current
    suppressedFocusKeyRef.current = null
    lastFocusedKeyRef.current = activeFocusKey || null
    setPendingFocusNodeIds([])
    runFitView(focusNodes)
  }, [collectFocusNodes, runFitView])

  const notifyUserInteraction = useCallback(() => {
    const activeFocusKey = currentFocusKeyRef.current
    if (!activeFocusKey) return
    suppressedFocusKeyRef.current = activeFocusKey
    setPendingFocusNodeIds(focusNodeIdsRef.current)
  }, [])

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    if (!focusKey) {
      setPendingFocusNodeIds([])
      return undefined
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      if (!containerRef.current) return

      const decision = resolveCanvasFocusFollowDecision({
        focusKey,
        enabled,
        suppressedFocusKey: suppressedFocusKeyRef.current,
        lastFocusedKey: lastFocusedKeyRef.current,
      })

      if (decision === 'idle' || decision === 'skip_already_focused') {
        setPendingFocusNodeIds([])
        return
      }

      if (decision === 'pending') {
        setPendingFocusNodeIds(focusNodeIdsRef.current)
        return
      }

      const focusNodes = collectFocusNodes()
      if (focusNodes.length === 0) {
        setPendingFocusNodeIds([])
        return
      }

      lastFocusedKeyRef.current = focusKey
      setPendingFocusNodeIds([])
      runFitView(focusNodes)
    }, FOCUS_FOLLOW_DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [collectFocusNodes, containerRef, enabled, focusKey, runFitView])

  return {
    pendingFocusNodeIds,
    focusNow,
    notifyUserInteraction,
  }
}
