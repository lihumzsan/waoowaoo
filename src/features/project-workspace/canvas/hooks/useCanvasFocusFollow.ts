'use client'

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import { taskRuntimeTargetQueryKey } from '@/lib/task/runtime-targets'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'

const FOCUS_FOLLOW_DEBOUNCE_MS = 240
const FOCUS_FIT_PADDING = 0.14
const FOCUS_FIT_MAX_ZOOM = 1
const FOCUS_FIT_DURATION_MS = 180

export interface UseCanvasFocusFollowParams {
  readonly reactFlow: ReactFlowInstance<WorkspaceCanvasFlowNode>
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly enabled: boolean
  readonly focusNodeIds: readonly string[]
  readonly focusRequestKey: string | null
}

export interface CanvasFocusFollowResult {
  readonly notifyUserInteraction: () => void
}

/**
 * A Task batch becomes focusable only after at least one of its durable
 * targets has materialized as a Canvas node. The returned ids are a trigger,
 * not the fitView target: the viewport always fits the whole Canvas once.
 */
export function resolveWorkspaceCanvasFocusNodeIds(
  nodes: readonly WorkspaceCanvasFlowNode[],
  taskTargets: readonly TaskRuntimeTarget[],
): string[] {
  const targetKeys = new Set(taskTargets.map(taskRuntimeTargetQueryKey))
  if (targetKeys.size === 0) return []
  return nodes.flatMap((node) => (
    (node.data.runtimeTargets ?? []).some((target) => targetKeys.has(taskRuntimeTargetQueryKey(target)))
      ? [node.id]
      : []
  ))
}

export function useCanvasFocusFollow({
  reactFlow,
  containerRef,
  enabled,
  focusNodeIds,
  focusRequestKey,
}: UseCanvasFocusFollowParams): CanvasFocusFollowResult {
  const debounceTimerRef = useRef<number | null>(null)
  const currentFocusKeyRef = useRef<string | null>(null)
  const handledFocusKeysRef = useRef(new Set<string>())
  const focusNodesReady = focusNodeIds.length > 0
  const focusNodeSignature = useMemo(() => [...focusNodeIds].sort().join('|'), [focusNodeIds])
  currentFocusKeyRef.current = focusRequestKey

  const clearPendingFocus = useCallback(() => {
    if (debounceTimerRef.current === null) return
    window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }, [])

  const notifyUserInteraction = useCallback(() => {
    clearPendingFocus()
    const currentFocusKey = currentFocusKeyRef.current
    if (currentFocusKey) handledFocusKeysRef.current.add(currentFocusKey)
    void reactFlow.setViewport(reactFlow.getViewport(), { duration: 0 })
  }, [clearPendingFocus, reactFlow])

  useEffect(() => {
    clearPendingFocus()
    const focusKey = focusRequestKey?.trim() || null
    if (
      !enabled
      || !focusKey
      || !focusNodesReady
      || handledFocusKeysRef.current.has(focusKey)
    ) {
      return undefined
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      if (
        !containerRef.current
        || handledFocusKeysRef.current.has(focusKey)
      ) {
        return
      }
      handledFocusKeysRef.current.add(focusKey)
      void reactFlow.fitView({
        padding: FOCUS_FIT_PADDING,
        maxZoom: FOCUS_FIT_MAX_ZOOM,
        duration: FOCUS_FIT_DURATION_MS,
      })
    }, FOCUS_FOLLOW_DEBOUNCE_MS)

    return clearPendingFocus
  }, [
    clearPendingFocus,
    containerRef,
    enabled,
    focusNodeSignature,
    focusNodesReady,
    focusRequestKey,
    reactFlow,
  ])

  useEffect(() => clearPendingFocus, [clearPendingFocus])

  return { notifyUserInteraction }
}
