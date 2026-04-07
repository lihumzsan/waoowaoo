'use client'

const PROBE_SUCCESS_COOLDOWN_MS = 60_000
const PROBE_RETRY_INTERVAL_MS = 2_000
const successfulProbeScopes = new Map<string, number>()

type RecoveryProbeContext = {
  projectId: string
  storageScopeKey?: string
}

type StartRecoveryProbeArgs = {
  projectId: string
  storageKey: string
  storageScopeKey?: string
  hasRunState: () => boolean
  resolveActiveRunId: (context: RecoveryProbeContext) => Promise<string | null>
  onRecovered: (runId: string) => void
}

function scheduleProbe(
  callback: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  return globalThis.setTimeout(callback, delayMs)
}

export function startRecoveryProbe(args: StartRecoveryProbeArgs): () => void {
  let cancelled = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const clearRetryTimer = () => {
    if (retryTimer) {
      globalThis.clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const scheduleRetry = (delayMs: number) => {
    if (cancelled || args.hasRunState()) return
    clearRetryTimer()
    retryTimer = scheduleProbe(() => {
      void probe()
    }, delayMs)
  }

  const probe = async () => {
    if (cancelled || args.hasRunState()) return

    const lastSuccessAt = successfulProbeScopes.get(args.storageKey)
    if (lastSuccessAt) {
      const cooldownRemainingMs =
        PROBE_SUCCESS_COOLDOWN_MS - (Date.now() - lastSuccessAt)
      if (cooldownRemainingMs > 0) {
        scheduleRetry(cooldownRemainingMs)
        return
      }
    }

    const activeRunId = await args.resolveActiveRunId({
      projectId: args.projectId,
      storageScopeKey: args.storageScopeKey,
    }).catch(() => null)

    if (cancelled || args.hasRunState()) return

    if (!activeRunId) {
      scheduleRetry(PROBE_RETRY_INTERVAL_MS)
      return
    }

    successfulProbeScopes.set(args.storageKey, Date.now())
    args.onRecovered(activeRunId)
  }

  void probe()

  return () => {
    cancelled = true
    clearRetryTimer()
  }
}

export const recoveryProbeTestUtils = {
  clearSuccessfulProbeScopes() {
    successfulProbeScopes.clear()
  },
  PROBE_RETRY_INTERVAL_MS,
  PROBE_SUCCESS_COOLDOWN_MS,
}
