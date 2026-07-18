interface PromptAutoEnsureQueueOptions {
  concurrency?: number
  isCancelled?: () => boolean
}

export interface PromptAutoEnsureQueue {
  enqueue: (panelKeys: readonly string[]) => void
  replace: (panelKeys: readonly string[]) => void
  dispose: () => void
  whenIdle: () => Promise<void>
}

function resolveConcurrency(concurrency?: number) {
  return Math.max(1, Math.min(concurrency ?? 2, 2))
}

export function createPromptAutoEnsureQueue(
  ensure: (panelKey: string) => Promise<void>,
  options: Omit<PromptAutoEnsureQueueOptions, 'isCancelled'> = {},
): PromptAutoEnsureQueue {
  const concurrency = resolveConcurrency(options.concurrency)
  const pending: string[] = []
  const scheduled = new Set<string>()
  const idleResolvers = new Set<() => void>()
  let active = 0
  let disposed = false

  const resolveIdle = () => {
    if (active > 0 || pending.length > 0) return
    for (const resolve of idleResolvers) resolve()
    idleResolvers.clear()
  }

  const schedule = () => {
    while (!disposed && active < concurrency && pending.length > 0) {
      const panelKey = pending.shift()!
      active += 1
      const settle = () => {
        active -= 1
        scheduled.delete(panelKey)
        schedule()
        resolveIdle()
      }
      try {
        void ensure(panelKey).catch(() => undefined).then(settle)
      } catch {
        settle()
      }
    }
    resolveIdle()
  }

  return {
    enqueue: (panelKeys) => {
      if (disposed) return
      for (const panelKey of panelKeys) {
        if (scheduled.has(panelKey)) continue
        scheduled.add(panelKey)
        pending.push(panelKey)
      }
      schedule()
    },
    replace: (panelKeys) => {
      if (disposed) return
      const nextKeys = new Set(panelKeys)
      const retainedPending: string[] = []
      for (const panelKey of pending) {
        if (nextKeys.has(panelKey)) {
          retainedPending.push(panelKey)
        } else {
          scheduled.delete(panelKey)
        }
      }
      pending.length = 0
      pending.push(...retainedPending)
      for (const panelKey of nextKeys) {
        if (scheduled.has(panelKey)) continue
        scheduled.add(panelKey)
        pending.push(panelKey)
      }
      schedule()
    },
    dispose: () => {
      disposed = true
      for (const panelKey of pending) scheduled.delete(panelKey)
      pending.length = 0
      resolveIdle()
    },
    whenIdle: () => new Promise((resolve) => {
      if (active === 0 && pending.length === 0) {
        resolve()
        return
      }
      idleResolvers.add(resolve)
    }),
  }
}

export async function runPromptAutoEnsureQueue(
  panelKeys: readonly string[],
  ensure: (panelKey: string) => Promise<void>,
  options: PromptAutoEnsureQueueOptions = {},
) {
  const concurrency = Math.min(resolveConcurrency(options.concurrency), panelKeys.length || 1)
  let cursor = 0

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!options.isCancelled?.() && cursor < panelKeys.length) {
      const panelKey = panelKeys[cursor]
      cursor += 1
      await ensure(panelKey)
    }
  }))
}
