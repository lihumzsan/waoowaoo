import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './keys'
import type { TaskIntent } from '@/lib/task/intent'
import type {
  TaskTargetState,
  TaskTargetStateQuery,
} from './hooks/useTaskTargetStateMap'

type TerminalPhase = 'completed' | 'failed' | 'canceled'

interface ApplyTaskTargetTerminalStateInput {
  readonly projectId: string
  readonly targetType: string | null
  readonly targetId: string | null
  readonly phase: TerminalPhase
  readonly taskId: string | null
  readonly taskType: string | null
  readonly progressGroupId?: string | null
  readonly intent: TaskIntent
  readonly hasOutputAtStart: boolean | null
  readonly progress: number | null
  readonly stage: string | null
  readonly stageLabel: string | null
  readonly errorCode: string | null
  readonly eventTs: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTypes(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const types = value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item))
  return types.length > 0 ? types : undefined
}

function parseTaskTargetStateQueries(queryKey: QueryKey): readonly TaskTargetStateQuery[] {
  if (!Array.isArray(queryKey)) return []
  const serializedTargets = queryKey[2]
  if (typeof serializedTargets !== 'string') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedTargets)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const targets: TaskTargetStateQuery[] = []
  for (const item of parsed) {
    if (!isRecord(item)) continue
    const targetType = normalizeString(item.targetType)
    const targetId = normalizeString(item.targetId)
    if (!targetType || !targetId) continue
    const types = normalizeTypes(item.types)
    targets.push({
      targetType,
      targetId,
      ...(types ? { types } : {}),
    })
  }
  return targets
}

function sameTaskType(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  return left.toLowerCase() === right.toLowerCase()
}

function matchesTaskTypeWhitelist(
  whitelist: readonly string[] | undefined,
  taskType: string | null,
): boolean {
  if (!whitelist || whitelist.length === 0) return true
  if (!taskType) return false
  const normalizedTaskType = taskType.toLowerCase()
  return whitelist.some((type) => type.toLowerCase() === normalizedTaskType)
}

function isIncomingOlder(currentUpdatedAt: string | null, incomingUpdatedAt: string | null): boolean {
  if (!currentUpdatedAt || !incomingUpdatedAt) return false
  const currentTime = new Date(currentUpdatedAt).getTime()
  const incomingTime = new Date(incomingUpdatedAt).getTime()
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime)) return false
  return incomingTime < currentTime
}

function shouldApplyTerminalState(params: {
  readonly target: TaskTargetStateQuery | null
  readonly state: TaskTargetState
  readonly input: ApplyTaskTargetTerminalStateInput & {
    readonly targetType: string
    readonly targetId: string
  }
}): boolean {
  if (params.state.targetType !== params.input.targetType) return false
  if (params.state.targetId !== params.input.targetId) return false
  const taskTypeForWhitelist = params.input.taskType || params.state.runningTaskType
  if (params.target && !matchesTaskTypeWhitelist(params.target.types, taskTypeForWhitelist)) return false

  if (
    params.input.taskId &&
    params.state.runningTaskId &&
    params.state.runningTaskId !== params.input.taskId
  ) {
    return false
  }

  if (
    params.input.taskType &&
    params.state.runningTaskType &&
    !sameTaskType(params.state.runningTaskType, params.input.taskType)
  ) {
    return false
  }

  if (
    (params.state.phase === 'completed' || params.state.phase === 'failed' || params.state.phase === 'canceled') &&
    isIncomingOlder(params.state.updatedAt, params.input.eventTs)
  ) {
    return false
  }

  return true
}

function terminalLastError(input: ApplyTaskTargetTerminalStateInput): TaskTargetState['lastError'] {
  const isHandoffContractError = input.errorCode?.startsWith('CANVAS_TERMINAL_RESOURCE_') === true
  if (input.phase !== 'failed' && !isHandoffContractError) return null
  if (!input.errorCode) return null
  return {
    code: input.errorCode,
  }
}

function applyTerminalStateToData(
  data: readonly TaskTargetState[] | undefined,
  targets: readonly TaskTargetStateQuery[],
  input: ApplyTaskTargetTerminalStateInput & {
    readonly targetType: string
    readonly targetId: string
  },
): readonly TaskTargetState[] | undefined {
  if (!data) return data

  let changed = false
  const next = data.map((state, index): TaskTargetState => {
    const target = targets[index] ?? null
    if (!shouldApplyTerminalState({ target, state, input })) return state
    changed = true
    return {
      ...state,
      phase: input.phase,
      taskId: input.taskId,
      runningTaskId: null,
      runningTaskType: input.taskType || state.runningTaskType,
      progressGroupId: input.progressGroupId ?? state.progressGroupId ?? null,
      intent: input.intent,
      hasOutputAtStart: input.hasOutputAtStart ?? state.hasOutputAtStart,
      progress: input.phase === 'completed' ? 100 : input.progress,
      stage: input.stage ?? state.stage,
      stageLabel: input.stageLabel ?? state.stageLabel,
      lastError: terminalLastError(input),
      updatedAt: input.eventTs || state.updatedAt,
    }
  })

  return changed ? next : data
}

export function applyTaskTargetTerminalStateToCache(
  queryClient: QueryClient,
  input: ApplyTaskTargetTerminalStateInput,
) {
  const targetType = normalizeString(input.targetType)
  const targetId = normalizeString(input.targetId)
  if (!targetType || !targetId) return

  const entries = queryClient.getQueriesData<readonly TaskTargetState[]>({
    queryKey: queryKeys.tasks.targetStatesAll(input.projectId),
    exact: false,
  })

  for (const [queryKey, data] of entries) {
    const targets = parseTaskTargetStateQueries(queryKey)
    const next = applyTerminalStateToData(data, targets, {
      ...input,
      targetType,
      targetId,
    })
    if (next !== data) {
      queryClient.setQueryData(queryKey, next)
    }
  }
}
