'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateByTarget } from '@/lib/query/invalidation/invalidate-by-target'
import type { TaskTargetState } from './useTaskTargetStateMap'
import {
  isTaskRuntimeRunningPhase,
  taskRuntimeTargetQueryKey,
} from '@/lib/task/runtime-targets'

type UseTaskTargetTerminalInvalidationInput = {
  projectId: string | null | undefined
  episodeId?: string | null
  states: readonly TaskTargetState[]
  enabled?: boolean
  isGlobalAssetProject?: boolean
}

type PreviousTaskRuntime = {
  phase: string | null
  runningTaskId: string | null
  runningTaskType: string | null
}

function isTerminalPhase(phase: string | null | undefined): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'canceled'
}

function stateRuntimeKey(state: TaskTargetState): string {
  return taskRuntimeTargetQueryKey({
    targetType: state.targetType,
    targetId: state.targetId,
    types: state.runningTaskType ? [state.runningTaskType] : undefined,
  })
}

export function useTaskTargetTerminalInvalidation({
  projectId,
  episodeId = null,
  states,
  enabled = true,
  isGlobalAssetProject,
}: UseTaskTargetTerminalInvalidationInput) {
  const queryClient = useQueryClient()
  const previousByKeyRef = useRef<Map<string, PreviousTaskRuntime>>(new Map())
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!enabled || !projectId) return

    const nextByKey = new Map<string, PreviousTaskRuntime>()
    const terminalTargets: TaskTargetState[] = []

    for (const state of states) {
      const key = stateRuntimeKey(state)
      const previous = previousByKeyRef.current.get(key)
      const wasRunning = isTaskRuntimeRunningPhase(previous?.phase)
      const isNowTerminal = isTerminalPhase(state.phase)
      if (initializedRef.current && wasRunning && isNowTerminal) {
        terminalTargets.push(state)
      }
      nextByKey.set(key, {
        phase: state.phase,
        runningTaskId: state.runningTaskId,
        runningTaskType: state.runningTaskType,
      })
    }

    previousByKeyRef.current = nextByKey
    initializedRef.current = true

    for (const state of terminalTargets) {
      invalidateByTarget({
        queryClient,
        projectId,
        targetType: state.targetType,
        episodeId,
        isGlobalAssetProject,
      })
    }
  }, [enabled, episodeId, isGlobalAssetProject, projectId, queryClient, states])
}
