export interface TaskCoveredTarget {
  readonly targetType: string
  readonly targetId: string
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (typeof value !== 'string') return null
    try {
      return parseObject(JSON.parse(value) as unknown)
    } catch {
      return null
    }
  }
  return value as Record<string, unknown>
}

export function resolveTaskCoveredTargets(input: {
  readonly taskType: string | null | undefined
  readonly targetType: string | null | undefined
  readonly targetId: string | null | undefined
  readonly payload: unknown
}): readonly TaskCoveredTarget[] {
  const targets: TaskCoveredTarget[] = []
  const targetType = typeof input.targetType === 'string' && input.targetType.trim()
    ? input.targetType.trim()
    : null
  const targetId = typeof input.targetId === 'string' && input.targetId.trim()
    ? input.targetId.trim()
    : null

  if (targetType && targetId) {
    targets.push({ targetType, targetId })
  }

  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.targetType}:${target.targetId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function withTaskCoveredTargetsPayload(input: {
  readonly taskType: string | null | undefined
  readonly targetType: string | null | undefined
  readonly targetId: string | null | undefined
  readonly payload: Record<string, unknown> | null | undefined
  readonly coveragePayload?: unknown
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(input.payload || {}) }
  delete next.coveredTargets
  const coveredTargets = resolveTaskCoveredTargets({
    taskType: input.taskType,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.coveragePayload ?? next,
  })
  if (coveredTargets.length > 0) {
    next.coveredTargets = coveredTargets
  }
  return next
}

export function readTaskCoveredTargets(value: unknown): readonly TaskCoveredTarget[] {
  if (!Array.isArray(value)) return []
  const targets = value.flatMap((item) => {
    const record = parseObject(item)
    const targetType = typeof record?.targetType === 'string' && record.targetType.trim()
      ? record.targetType.trim()
      : null
    const targetId = typeof record?.targetId === 'string' && record.targetId.trim()
      ? record.targetId.trim()
      : null
    return targetType && targetId ? [{ targetType, targetId }] : []
  })
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.targetType}:${target.targetId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
