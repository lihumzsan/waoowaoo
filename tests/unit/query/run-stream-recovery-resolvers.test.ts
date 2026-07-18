import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
const useRunStreamStateMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: apiFetchMock,
}))

vi.mock('@/lib/query/hooks/useRunStreamState', () => ({
  useRunStreamState: useRunStreamStateMock,
}))

import { useScriptToStoryboardRunStream } from '@/lib/query/hooks/useScriptToStoryboardRunStream'
import { useStoryToScriptRunStream } from '@/lib/query/hooks/useStoryToScriptRunStream'

type RecoveryResolver = (context: {
  projectId: string
  storageScopeKey?: string
}) => Promise<string | null>

type RunStreamHook = (options: {
  projectId: string
  episodeId: string
}) => unknown

function getRecoveryResolver(runStreamHook: RunStreamHook): RecoveryResolver {
  runStreamHook({
    projectId: 'project-1',
    episodeId: 'episode-1',
  })
  const options = useRunStreamStateMock.mock.calls.at(-1)?.[0] as {
    resolveActiveRunId?: RecoveryResolver
  }
  if (!options.resolveActiveRunId) {
    throw new Error('expected recovery resolver')
  }
  return options.resolveActiveRunId
}

const hookCases = [
  ['story-to-script', useStoryToScriptRunStream],
  ['script-to-storyboard', useScriptToStoryboardRunStream],
] as const

describe('run stream recovery resolvers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(hookCases)('%s accepts a confirmed empty runs array', async (_name, runStreamHook) => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    })

    await expect(getRecoveryResolver(runStreamHook)({
      projectId: 'project-1',
      storageScopeKey: 'episode-1',
    })).resolves.toBeNull()
  })

  it.each([
    [{ runs: [{}] }],
    [{ runs: [null] }],
  ])('rejects malformed non-empty runs rows for both hooks', async (payload) => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => payload,
    })

    for (const [, runStreamHook] of hookCases) {
      await expect(getRecoveryResolver(runStreamHook)({
        projectId: 'project-1',
        storageScopeKey: 'episode-1',
      })).rejects.toThrow()
    }
  })

  it.each([
    [{
      runs: [{
        id: 'run-terminal',
        status: 'completed',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        leaseExpiresAt: null,
        heartbeatAt: null,
      }],
    }],
    [{
      runs: [{
        id: 'run-expired',
        status: 'running',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
        leaseExpiresAt: '2020-01-01T00:01:00.000Z',
        heartbeatAt: '2020-01-01T00:00:30.000Z',
      }],
    }],
  ])('rejects non-empty active-query responses without a recoverable run', async (payload) => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => payload,
    })

    for (const [, runStreamHook] of hookCases) {
      await expect(getRecoveryResolver(runStreamHook)({
        projectId: 'project-1',
        storageScopeKey: 'episode-1',
      })).rejects.toThrow()
    }
  })
})
