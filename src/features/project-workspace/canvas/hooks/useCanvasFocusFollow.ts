'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { isWorkspaceCanvasLifecycleRunning } from '../lifecycle/workspace-canvas-lifecycle'
import {
  getWorkspaceCanvasOperationFocusKindPriority,
  WORKSPACE_CANVAS_RUNNING_FOCUS_KIND_PRIORITY,
} from '../registry/workspace-canvas-focus-policy'

const FOCUS_FOLLOW_DEBOUNCE_MS = 240
export const FOCUS_FOLLOW_MANUAL_PAUSE_MS = 3000
const FOCUS_FIT_PADDING = 0.3
const FOCUS_FIT_MAX_ZOOM = 1
const FOCUS_FIT_DURATION_MS = 500

export type CanvasFocusFollowDecision = 'idle' | 'focus' | 'pending' | 'skip_already_focused'

interface ResolveCanvasFocusFollowDecisionInput {
  readonly focusKey: string
  readonly enabled: boolean
  readonly manualPauseActive: boolean
  readonly lastFocusedKey: string | null
}

export interface UseCanvasFocusFollowParams {
  readonly reactFlow: ReactFlowInstance<WorkspaceCanvasFlowNode>
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly enabled: boolean
  readonly focusNodeIds: readonly string[]
  readonly focusRequestKey?: string | null
  readonly onFocusComplete?: (focusKey: string) => void
}

export interface CanvasFocusFollowResult {
  readonly pendingFocusNodeIds: readonly string[]
  readonly focusNow: () => void
  readonly notifyUserInteraction: () => void
}

export function buildWorkspaceCanvasFocusKey(nodeIds: readonly string[], focusRequestKey?: string | null): string {
  const nodeKey = [...nodeIds].sort().join('|')
  if (!nodeKey) return ''
  const normalizedRequestKey = focusRequestKey?.trim()
  return normalizedRequestKey ? `${normalizedRequestKey}:${nodeKey}` : nodeKey
}

function firstNodeIdByKind(
  nodes: readonly WorkspaceCanvasFlowNode[],
  kinds: readonly WorkspaceCanvasFlowNode['data']['kind'][],
  runningOnly: boolean,
): string | null {
  for (const kind of kinds) {
    const node = nodes.find(
      (candidate) =>
        candidate.data.kind === kind && (!runningOnly || isWorkspaceCanvasLifecycleRunning(candidate.data.lifecycle)),
    )
    if (node) return node.id
  }
  return null
}

export function resolveWorkspaceCanvasFocusNodeIds(
  nodes: readonly WorkspaceCanvasFlowNode[],
  activeAssistantOperationId: string | null | undefined,
): string[] {
  const operationKindPriority = getWorkspaceCanvasOperationFocusKindPriority(activeAssistantOperationId)
  if (operationKindPriority) {
    const runningOperationNodeId = firstNodeIdByKind(nodes, operationKindPriority, true)
    if (runningOperationNodeId) return [runningOperationNodeId]

    const operationNodeId = firstNodeIdByKind(nodes, operationKindPriority, false)
    return operationNodeId ? [operationNodeId] : []
  }

  const runningPriorityNodeId = firstNodeIdByKind(nodes, WORKSPACE_CANVAS_RUNNING_FOCUS_KIND_PRIORITY, true)
  if (runningPriorityNodeId) return [runningPriorityNodeId]

  const runningNodeId = nodes.find((node) => isWorkspaceCanvasLifecycleRunning(node.data.lifecycle))?.id
  return runningNodeId ? [runningNodeId] : []
}

export function resolveWorkspaceCanvasStyleBibleFocusNodeIds(nodes: readonly WorkspaceCanvasFlowNode[]): string[] {
  const styleBibleNodeId = firstNodeIdByKind(nodes, ['editStyleBible'], false)
  return styleBibleNodeId ? [styleBibleNodeId] : []
}

export function resolveCanvasFocusFollowDecision({
  focusKey,
  enabled,
  manualPauseActive,
  lastFocusedKey,
}: ResolveCanvasFocusFollowDecisionInput): CanvasFocusFollowDecision {
  if (!focusKey) return 'idle'
  if (!enabled || manualPauseActive) return 'pending'
  if (focusKey === lastFocusedKey) return 'skip_already_focused'
  return 'focus'
}

export function useCanvasFocusFollow({
  reactFlow,
  containerRef,
  enabled,
  focusNodeIds,
  focusRequestKey = null,
  onFocusComplete,
}: UseCanvasFocusFollowParams): CanvasFocusFollowResult {
  const debounceTimerRef = useRef<number | null>(null)
  const manualPauseTimerRef = useRef<number | null>(null)
  const manualPauseUntilRef = useRef<number | null>(null)
  const focusNodeIdsRef = useRef<readonly string[]>([])
  const currentFocusKeyRef = useRef('')
  const lastFocusedKeyRef = useRef<string | null>(null)
  const [pendingFocusNodeIds, setPendingFocusNodeIds] = useState<readonly string[]>([])
  const [manualPauseRevision, setManualPauseRevision] = useState(0)

  const focusKey = useMemo(
    () => buildWorkspaceCanvasFocusKey(focusNodeIds, focusRequestKey),
    [focusNodeIds, focusRequestKey],
  )
  focusNodeIdsRef.current = focusNodeIds
  currentFocusKeyRef.current = focusKey

  const updatePendingFocusNodeIds = useCallback((next: readonly string[]) => {
    setPendingFocusNodeIds((current) =>
      current.length === next.length && current.every((id, index) => id === next[index]) ? current : [...next],
    )
  }, [])

  const collectFocusNodes = useCallback((): WorkspaceCanvasFlowNode[] => {
    const idSet = new Set(focusNodeIdsRef.current)
    if (idSet.size === 0) return []
    return reactFlow.getNodes().filter((node) => idSet.has(node.id))
  }, [reactFlow])

  const runFitView = useCallback(
    (focusNodes: readonly WorkspaceCanvasFlowNode[]) => {
      if (focusNodes.length === 0) return
      void reactFlow.fitView({
        nodes: focusNodes.map((node) => ({ id: node.id })),
        padding: FOCUS_FIT_PADDING,
        maxZoom: FOCUS_FIT_MAX_ZOOM,
        duration: FOCUS_FIT_DURATION_MS,
      })
    },
    [reactFlow],
  )

  const clearManualPauseTimer = useCallback(() => {
    if (manualPauseTimerRef.current === null) return
    window.clearTimeout(manualPauseTimerRef.current)
    manualPauseTimerRef.current = null
  }, [])

  const clearManualPause = useCallback(() => {
    clearManualPauseTimer()
    manualPauseUntilRef.current = null
  }, [clearManualPauseTimer])

  const focusNow = useCallback(() => {
    const focusNodes = collectFocusNodes()
    const activeFocusKey = currentFocusKeyRef.current
    clearManualPause()
    lastFocusedKeyRef.current = activeFocusKey || null
    updatePendingFocusNodeIds([])
    runFitView(focusNodes)
    if (focusNodes.length > 0 && activeFocusKey) onFocusComplete?.(activeFocusKey)
  }, [clearManualPause, collectFocusNodes, onFocusComplete, runFitView, updatePendingFocusNodeIds])

  const notifyUserInteraction = useCallback(() => {
    const activeFocusKey = currentFocusKeyRef.current
    if (!activeFocusKey) return
    const pauseUntil = Date.now() + FOCUS_FOLLOW_MANUAL_PAUSE_MS
    manualPauseUntilRef.current = pauseUntil
    clearManualPauseTimer()
    manualPauseTimerRef.current = window.setTimeout(() => {
      if (manualPauseUntilRef.current !== pauseUntil) return
      manualPauseUntilRef.current = null
      manualPauseTimerRef.current = null
      setManualPauseRevision((current) => current + 1)
    }, FOCUS_FOLLOW_MANUAL_PAUSE_MS)
    updatePendingFocusNodeIds(focusNodeIdsRef.current)
    setManualPauseRevision((current) => current + 1)
  }, [clearManualPauseTimer, updatePendingFocusNodeIds])

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    if (!focusKey) {
      clearManualPause()
      lastFocusedKeyRef.current = null
      updatePendingFocusNodeIds([])
      return undefined
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      if (!containerRef.current) return

      const decision = resolveCanvasFocusFollowDecision({
        focusKey,
        enabled,
        manualPauseActive: Boolean(manualPauseUntilRef.current && Date.now() < manualPauseUntilRef.current),
        lastFocusedKey: lastFocusedKeyRef.current,
      })

      if (decision === 'idle' || decision === 'skip_already_focused') {
        updatePendingFocusNodeIds([])
        return
      }

      if (decision === 'pending') {
        updatePendingFocusNodeIds(focusNodeIdsRef.current)
        return
      }

      const focusNodes = collectFocusNodes()
      if (focusNodes.length === 0) {
        updatePendingFocusNodeIds([])
        return
      }

      lastFocusedKeyRef.current = focusKey
      updatePendingFocusNodeIds([])
      runFitView(focusNodes)
      onFocusComplete?.(focusKey)
    }, FOCUS_FOLLOW_DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [
    clearManualPause,
    collectFocusNodes,
    containerRef,
    enabled,
    focusKey,
    manualPauseRevision,
    onFocusComplete,
    runFitView,
    updatePendingFocusNodeIds,
  ])

  useEffect(
    () => () => {
      clearManualPauseTimer()
    },
    [clearManualPauseTimer],
  )

  return {
    pendingFocusNodeIds,
    focusNow,
    notifyUserInteraction,
  }
}
