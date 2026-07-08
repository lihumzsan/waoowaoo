'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'

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

export function buildWorkspaceCanvasFocusKey(
  nodeIds: readonly string[],
  focusRequestKey?: string | null,
): string {
  const nodeKey = [...nodeIds].sort().join('|')
  if (!nodeKey) return ''
  const normalizedRequestKey = focusRequestKey?.trim()
  return normalizedRequestKey ? `${normalizedRequestKey}:${nodeKey}` : nodeKey
}

type WorkspaceCanvasFocusNodeKind = WorkspaceCanvasFlowNode['data']['kind']

const OPERATION_FOCUS_KIND_PRIORITY: Readonly<Record<string, readonly WorkspaceCanvasFocusNodeKind[]>> = {
  ingest_script: ['editBible'],
  revise_script: ['editBible'],
  generate_bible_from_script: ['editBible'],
  revise_bible: ['editBible'],
  generate_edit_style_previews: ['editBible', 'editStyleBible'],
  plan_chapters: ['editScript'],
  generate_edit_script: ['editScript'],
  generate_edit_script_assets: ['editAssetGroup'],
  generate_edit_shot_execution_plan: ['editShotExecutionPlan'],
  generate_edit_script_storyboard: ['shot', 'editShotExecutionPlan'],
  generate_edit_script_storyboard_images: ['shot'],
  generate_episode_videos: ['videoPlan'],
  generate_episode_videos_auto: ['videoPlan'],
  generate_panel_video: ['videoPlan'],
  generate_video_group: ['videoPlan'],
  generate_episode_bgm_score: ['bgmScore'],
  generate_project_music: ['bgmScore'],
  render_chapters: ['finalTimeline', 'videoPlan'],
  render_final_video: ['finalTimeline'],
}

const RUNNING_FOCUS_KIND_PRIORITY: readonly WorkspaceCanvasFocusNodeKind[] = [
  'editBible',
  'editScript',
  'editAssetGroup',
  'editShotExecutionPlan',
  'editPipelineStep',
  'shot',
  'videoPlan',
  'bgmScore',
  'finalTimeline',
  'editProcessGroup',
]

function firstNodeIdByKind(
  nodes: readonly WorkspaceCanvasFlowNode[],
  kinds: readonly WorkspaceCanvasFocusNodeKind[],
  runningOnly: boolean,
): string | null {
  for (const kind of kinds) {
    const node = nodes.find((candidate) => (
      candidate.data.kind === kind
      && (!runningOnly || candidate.data.isRunning === true)
    ))
    if (node) return node.id
  }
  return null
}

export function resolveWorkspaceCanvasFocusNodeIds(
  nodes: readonly WorkspaceCanvasFlowNode[],
  activeAssistantOperationId: string | null | undefined,
): string[] {
  const operationKindPriority = activeAssistantOperationId
    ? OPERATION_FOCUS_KIND_PRIORITY[activeAssistantOperationId]
    : undefined
  if (operationKindPriority) {
    const runningOperationNodeId = firstNodeIdByKind(nodes, operationKindPriority, true)
    if (runningOperationNodeId) return [runningOperationNodeId]

    const operationNodeId = firstNodeIdByKind(nodes, operationKindPriority, false)
    return operationNodeId ? [operationNodeId] : []
  }

  const runningPriorityNodeId = firstNodeIdByKind(nodes, RUNNING_FOCUS_KIND_PRIORITY, true)
  if (runningPriorityNodeId) return [runningPriorityNodeId]

  const runningNodeId = nodes.find((node) => node.data.isRunning === true)?.id
  return runningNodeId ? [runningNodeId] : []
}

export function resolveWorkspaceCanvasStyleBibleFocusNodeIds(
  nodes: readonly WorkspaceCanvasFlowNode[],
): string[] {
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
    setPendingFocusNodeIds([])
    runFitView(focusNodes)
    if (focusNodes.length > 0 && activeFocusKey) onFocusComplete?.(activeFocusKey)
  }, [clearManualPause, collectFocusNodes, onFocusComplete, runFitView])

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
    setPendingFocusNodeIds(focusNodeIdsRef.current)
    setManualPauseRevision((current) => current + 1)
  }, [clearManualPauseTimer])

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    if (!focusKey) {
      clearManualPause()
      lastFocusedKeyRef.current = null
      setPendingFocusNodeIds([])
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
      onFocusComplete?.(focusKey)
    }, FOCUS_FOLLOW_DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [clearManualPause, collectFocusNodes, containerRef, enabled, focusKey, manualPauseRevision, onFocusComplete, runFitView])

  useEffect(() => () => {
    clearManualPauseTimer()
  }, [clearManualPauseTimer])

  return {
    pendingFocusNodeIds,
    focusNow,
    notifyUserInteraction,
  }
}
