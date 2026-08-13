export type LatestSaveResult<T> =
  | { ok: true; value: T; isLatest: boolean }
  | { ok: false; error: unknown; isLatest: boolean }

type Resolver<T> = (result: LatestSaveResult<T>) => void

interface PendingSave<Input, Output> {
  input: Input
  version: number
  resolvers: Resolver<Output>[]
}

/**
 * Runs at most one write at a time and collapses pending submissions to the
 * newest input. Every collapsed caller observes the result of that newest
 * write, so navigation flushes can wait for the actual persisted state.
 */
export class LatestSaveQueue<Input, Output> {
  private running = false
  private queued: PendingSave<Input, Output> | null = null
  private latestVersion = 0
  private lastResult: LatestSaveResult<Output> | null = null
  private idleResolvers: Resolver<Output>[] = []

  constructor(private readonly write: (input: Input) => Promise<Output>) {}

  submit(input: Input): Promise<LatestSaveResult<Output>> {
    const version = this.latestVersion + 1
    this.latestVersion = version

    return new Promise((resolve) => {
      if (this.running) {
        if (this.queued) {
          this.queued.input = input
          this.queued.version = version
          this.queued.resolvers.push(resolve)
        } else {
          this.queued = { input, version, resolvers: [resolve] }
        }
        return
      }

      this.running = true
      void this.run({ input, version, resolvers: [resolve] })
    })
  }

  waitForIdle(): Promise<LatestSaveResult<Output>> {
    if (!this.running) {
      if (!this.lastResult) {
        return Promise.reject(new Error('LATEST_SAVE_QUEUE_HAS_NO_RESULT'))
      }
      return Promise.resolve(this.lastResult)
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private async run(current: PendingSave<Input, Output>): Promise<void> {
    let result: LatestSaveResult<Output>
    try {
      const value = await this.write(current.input)
      result = {
        ok: true,
        value,
        isLatest: current.version === this.latestVersion,
      }
    } catch (error) {
      result = {
        ok: false,
        error,
        isLatest: current.version === this.latestVersion,
      }
    }

    this.lastResult = result
    for (const resolve of current.resolvers) resolve(result)

    const next = this.queued
    this.queued = null
    if (next) {
      await this.run(next)
      return
    }
    this.running = false
    const idleResolvers = this.idleResolvers
    this.idleResolvers = []
    for (const resolve of idleResolvers) resolve(result)
  }
}
