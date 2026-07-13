interface TaskOwnedEntry {
  readonly taskId: string
}

interface TerminalHandoffEntry extends TaskOwnedEntry {
  readonly terminalHandoff: boolean
}

interface TargetedTerminalHandoffEntry extends TerminalHandoffEntry {
  readonly targetType: string | null
  readonly targetId: string | null
}

export function isTerminalHandoffResourceCurrent(input: {
  readonly terminalHandoff: boolean
  readonly streamTaskId: string
  readonly resourceTaskId: string | null | undefined
  readonly resourcePhase: string
}): boolean {
  return input.terminalHandoff
    && input.streamTaskId.trim().length > 0
    && input.resourceTaskId === input.streamTaskId
    && (
      input.resourcePhase === 'succeeded'
      || input.resourcePhase === 'failed'
      || input.resourcePhase === 'canceled'
    )
}

export function removeTaskEntries<T extends TaskOwnedEntry>(
  current: ReadonlyMap<string, T>,
  taskIds: string | ReadonlySet<string>,
): ReadonlyMap<string, T> {
  const identities = typeof taskIds === 'string' ? new Set([taskIds]) : taskIds
  if (identities.size === 0) return current
  const next = new Map(current)
  let changed = false
  next.forEach((entry, key) => {
    if (!identities.has(entry.taskId)) return
    next.delete(key)
    changed = true
  })
  return changed ? next : current
}

export function markTaskEntriesForTerminalHandoff<T extends TerminalHandoffEntry>(
  current: ReadonlyMap<string, T>,
  taskId: string,
): ReadonlyMap<string, T> {
  const next = new Map(current)
  let changed = false
  next.forEach((entry, key) => {
    if (entry.taskId !== taskId || entry.terminalHandoff) return
    next.set(key, { ...entry, terminalHandoff: true })
    changed = true
  })
  return changed ? next : current
}

export function removeTargetTerminalHandoffs<T extends TargetedTerminalHandoffEntry>(
  current: ReadonlyMap<string, T>,
  targetType: string | null,
  targetId: string | null,
): ReadonlyMap<string, T> {
  const next = new Map(current)
  let changed = false
  next.forEach((entry, key) => {
    if (!entry.terminalHandoff || entry.targetType !== targetType || entry.targetId !== targetId) return
    next.delete(key)
    changed = true
  })
  return changed ? next : current
}

export function areAllTerminalHandoffs(
  snapshots: readonly { readonly terminalHandoff?: boolean }[],
): boolean {
  return snapshots.length > 0 && snapshots.every((snapshot) => snapshot.terminalHandoff === true)
}
