import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recoveryProbeTestUtils,
  startRecoveryProbe,
} from '@/lib/query/hooks/run-stream/recovery-probe'

describe('recovery probe', () => {
  afterEach(() => {
    vi.useRealTimers()
    recoveryProbeTestUtils.clearSuccessfulProbeScopes()
  })

  it('waits for the success cooldown after an empty recovery lookup', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi
      .fn<({ projectId, storageScopeKey }: { projectId: string; storageScopeKey?: string }) => Promise<string | null>>()
      .mockResolvedValue(null)
    const onRecovered = vi.fn()

    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:story-to-script:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
    expect(resolveActiveRunId).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      storageScopeKey: 'episode-1',
    })
    expect(onRecovered).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(
      recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS,
    )

    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
    expect(onRecovered).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(
      recoveryProbeTestUtils.PROBE_SUCCESS_COOLDOWN_MS
        - recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS,
    )

    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)

    cleanup()
  })

  it('backs off lookup failures exponentially', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi
      .fn<({ projectId, storageScopeKey }: { projectId: string; storageScopeKey?: string }) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('runs unavailable'))
      .mockRejectedValueOnce(new Error('runs unavailable'))
      .mockResolvedValueOnce(null)

    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:story-to-script:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(
      recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS,
    )

    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(
      recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS,
    )

    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(
      recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS,
    )

    expect(resolveActiveRunId).toHaveBeenCalledTimes(3)

    cleanup()
  })

  it('resets failure backoff after a successful lookup', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi
      .fn<({ projectId, storageScopeKey }: { projectId: string; storageScopeKey?: string }) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('runs unavailable'))
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('runs unavailable again'))
      .mockResolvedValueOnce(null)

    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:story-to-script:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(recoveryProbeTestUtils.PROBE_SUCCESS_COOLDOWN_MS)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(4)

    cleanup()
  })
})
