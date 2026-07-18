interface PromptAutoEnsureQueueOptions {
  concurrency?: number
  isCancelled?: () => boolean
}

export async function runPromptAutoEnsureQueue(
  panelKeys: readonly string[],
  ensure: (panelKey: string) => Promise<void>,
  options: PromptAutoEnsureQueueOptions = {},
) {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, panelKeys.length || 1))
  let cursor = 0

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!options.isCancelled?.() && cursor < panelKeys.length) {
      const panelKey = panelKeys[cursor]
      cursor += 1
      await ensure(panelKey)
    }
  }))
}
