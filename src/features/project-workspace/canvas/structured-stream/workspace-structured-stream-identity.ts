const MAX_TERMINAL_STREAM_RUNS = 512

export function trimOldestMapEntries<TKey, TValue>(map: Map<TKey, TValue>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value as TKey | undefined
    if (oldest === undefined) return
    map.delete(oldest)
  }
}

export function addBoundedIdentity(
  current: ReadonlySet<string>,
  identity: string,
  limit = MAX_TERMINAL_STREAM_RUNS,
): ReadonlySet<string> {
  const next = new Set(current)
  next.delete(identity)
  next.add(identity)
  while (next.size > limit) {
    const oldest = next.values().next().value as string | undefined
    if (!oldest) break
    next.delete(oldest)
  }
  return next
}

export function createStructuredStreamAccumulatorKey(input: {
  readonly taskId: string
  readonly streamRunId: string
  readonly stepAttempt: number
  readonly stepId: string | null
  readonly lane: string
  readonly adapterKey: string
}): string {
  return [
    input.taskId,
    input.streamRunId,
    String(input.stepAttempt),
    input.stepId ?? '__step',
    input.lane,
    input.adapterKey,
  ].join('|')
}
