import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'

const runtime = vi.hoisted(() => ({
  useQueryCalls: [] as Array<Record<string, unknown>>,
  apiStates: [] as TaskTargetState[],
  overlayStates: {} as Record<string, {
    targetType: string
    targetId: string
    phase: 'queued' | 'processing'
    runningTaskId: string | null
    runningTaskType: string | null
    intent: 'generate' | 'process' | 'regenerate'
    hasOutputAtStart: boolean | null
    progress: number | null
    stage: string | null
    stageLabel: string | null
    updatedAt: string | null
    lastError: null
    expiresAt: number
  }>,
}))

const overlayNow = new Date().toISOString()

function findTargetStatesQueryCall() {
  return runtime.useQueryCalls.find((call) => {
    const queryKey = call.queryKey as unknown[] | undefined
    return queryKey?.[0] === 'task-target-states'
  })
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: Record<string, unknown>) => {
    runtime.useQueryCalls.push(options)

    const queryKey = (options.queryKey || []) as unknown[]
    const first = queryKey[0]
    if (first === 'task-target-states-overlay') {
      return {
        data: runtime.overlayStates,
      }
    }

    return {
      data: runtime.apiStates,
    }
  },
}))

export { beforeEach, describe, expect, it, vi } from 'vitest'
export type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
export { findTargetStatesQueryCall, overlayNow, runtime }
