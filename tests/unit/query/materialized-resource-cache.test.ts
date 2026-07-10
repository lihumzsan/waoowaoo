import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { applyWorkspaceMaterializedResourcesToCache } from '@/lib/query/materialized-resource-cache'
import type { WorkspaceMaterializedResourceEnvelope } from '@/lib/task/types'

function editBibleData(version: number, title: string) {
  return {
    editBible: {
      id: 'bible-1',
      version,
      title,
      chapters: [],
    },
    chapters: [],
  }
}

function editBibleEnvelope(params: {
  taskId: string
  version: number
  title: string
}): WorkspaceMaterializedResourceEnvelope {
  return {
    kind: 'editBible',
    projectId: 'project-1',
    episodeId: 'episode-1',
    resourceKey: 'editBible:project-1:episode-1',
    resourceVersion: { scheme: 'revision', value: params.version },
    taskId: params.taskId,
    data: editBibleData(params.version, params.title),
  }
}

function episodeData(updatedAt: string, name: string) {
  return {
    id: 'episode-1',
    updatedAt,
    name,
  }
}

function episodeEnvelope(params: {
  taskId: string
  updatedAt: string
  name: string
}): WorkspaceMaterializedResourceEnvelope {
  return {
    kind: 'episodeData',
    projectId: 'project-1',
    episodeId: 'episode-1',
    resourceKey: 'episodeData:project-1:episode-1',
    resourceVersion: { scheme: 'updated_at', value: params.updatedAt },
    taskId: params.taskId,
    data: episodeData(params.updatedAt, params.name),
  }
}

function apply(queryClient: QueryClient, envelope: WorkspaceMaterializedResourceEnvelope) {
  return applyWorkspaceMaterializedResourcesToCache({
    queryClient,
    taskId: envelope.taskId,
    projectId: envelope.projectId,
    value: [envelope],
  })
}

describe('materialized resource cache version gate', () => {
  it('accepts consecutive editBible revisions and ignores duplicate or stale envelopes across tasks', () => {
    const queryClient = new QueryClient()
    const queryKey = queryKeys.project.editBible('project-1', 'episode-1')
    queryClient.setQueryData(queryKey, { editBible: null, chapters: [] })

    const first = apply(queryClient, editBibleEnvelope({
      taskId: 'task-1',
      version: 1,
      title: 'revision 1',
    }))
    const second = apply(queryClient, editBibleEnvelope({
      taskId: 'task-2',
      version: 2,
      title: 'revision 2',
    }))
    expect(first).toMatchObject({ applied: [{ taskId: 'task-1' }], ignored: [], errors: [] })
    expect(second).toMatchObject({ applied: [{ taskId: 'task-2' }], ignored: [], errors: [] })
    expect(queryClient.getQueryData(queryKey)).toEqual(editBibleData(2, 'revision 2'))

    const setQueryData = vi.spyOn(queryClient, 'setQueryData')
    const duplicate = apply(queryClient, editBibleEnvelope({
      taskId: 'task-3',
      version: 2,
      title: 'conflicting duplicate must not replace',
    }))
    const stale = apply(queryClient, editBibleEnvelope({
      taskId: 'task-4',
      version: 1,
      title: 'late revision 1',
    }))

    expect(duplicate).toMatchObject({
      applied: [],
      ignored: [{ reason: 'duplicate', envelope: { taskId: 'task-3' } }],
      errors: [],
    })
    expect(stale).toMatchObject({
      applied: [],
      ignored: [{ reason: 'stale', envelope: { taskId: 'task-4' } }],
      errors: [],
    })
    expect(setQueryData).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(queryKey)).toEqual(editBibleData(2, 'revision 2'))
  })

  it('orders episodeData timestamps across refetch, SSE, and a cache rebuilt after refresh', () => {
    const queryClient = new QueryClient()
    const queryKey = queryKeys.episodeData('project-1', 'episode-1')
    queryClient.setQueryData(
      queryKey,
      episodeData('2026-07-11T00:02:00.000Z', 'newer refetch'),
    )

    const staleSse = apply(queryClient, episodeEnvelope({
      taskId: 'task-old-sse',
      updatedAt: '2026-07-11T00:01:00.000Z',
      name: 'older SSE',
    }))
    expect(staleSse.ignored).toEqual([expect.objectContaining({ reason: 'stale' })])
    expect(queryClient.getQueryData(queryKey)).toEqual(
      episodeData('2026-07-11T00:02:00.000Z', 'newer refetch'),
    )

    const newerSse = apply(queryClient, episodeEnvelope({
      taskId: 'task-new-sse',
      updatedAt: '2026-07-11T00:03:00.000Z',
      name: 'newer SSE',
    }))
    expect(newerSse.applied).toEqual([expect.objectContaining({ taskId: 'task-new-sse' })])
    expect(queryClient.getQueryData(queryKey)).toEqual(
      episodeData('2026-07-11T00:03:00.000Z', 'newer SSE'),
    )

    const refreshedClient = new QueryClient()
    refreshedClient.setQueryData(
      queryKey,
      episodeData('2026-07-11T00:04:00.000Z', 'refresh snapshot'),
    )
    const replayedTerminal = apply(refreshedClient, episodeEnvelope({
      taskId: 'task-replayed',
      updatedAt: '2026-07-11T00:03:00.000Z',
      name: 'replayed terminal',
    }))
    expect(replayedTerminal.ignored).toEqual([expect.objectContaining({ reason: 'stale' })])
    expect(refreshedClient.getQueryData(queryKey)).toEqual(
      episodeData('2026-07-11T00:04:00.000Z', 'refresh snapshot'),
    )
  })

  it('cancels an older in-flight refetch before installing a newer terminal snapshot', async () => {
    const queryClient = new QueryClient()
    const queryKey = queryKeys.episodeData('project-1', 'episode-1')
    queryClient.setQueryData(
      queryKey,
      episodeData('2026-07-11T00:01:00.000Z', 'initial snapshot'),
    )
    let resolveRefetch!: (value: ReturnType<typeof episodeData>) => void
    const refetchResult = new Promise<ReturnType<typeof episodeData>>((resolve) => {
      resolveRefetch = resolve
    })
    const queryFn = vi.fn(() => refetchResult)
    const refetch = queryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: 0,
    }).catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))

    const terminal = apply(queryClient, episodeEnvelope({
      taskId: 'task-terminal',
      updatedAt: '2026-07-11T00:03:00.000Z',
      name: 'terminal snapshot',
    }))
    expect(terminal.applied).toEqual([expect.objectContaining({ taskId: 'task-terminal' })])
    resolveRefetch(episodeData('2026-07-11T00:02:00.000Z', 'late refetch'))
    await refetch

    expect(queryClient.getQueryData(queryKey)).toEqual(
      episodeData('2026-07-11T00:03:00.000Z', 'terminal snapshot'),
    )
  })

  it('fails explicitly for missing, malformed, mismatched, or incomparable versions', () => {
    const queryClient = new QueryClient()
    const invalidWireVersion = {
      ...episodeEnvelope({
        taskId: 'task-invalid-wire',
        updatedAt: '2026-07-11T00:01:00.000Z',
        name: 'invalid wire',
      }),
      resourceVersion: '2026-07-11T00:01:00.000Z',
    }
    const invalidResult = applyWorkspaceMaterializedResourcesToCache({
      queryClient,
      taskId: 'task-invalid-wire',
      projectId: 'project-1',
      value: [invalidWireVersion],
    })
    expect(invalidResult.errors).toEqual([
      'CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:episodeData:0',
    ])

    const mismatched = editBibleEnvelope({
      taskId: 'task-mismatch',
      version: 3,
      title: 'mismatch',
    })
    const mismatchResult = applyWorkspaceMaterializedResourcesToCache({
      queryClient,
      taskId: mismatched.taskId,
      projectId: mismatched.projectId,
      value: [{
        ...mismatched,
        resourceVersion: { scheme: 'revision', value: 4 },
      }],
    })
    expect(mismatchResult.errors).toEqual([
      'CANVAS_TERMINAL_RESOURCE_DATA_VERSION_MISMATCH:editBible:project-1:episode-1',
    ])

    const queryKey = queryKeys.project.editBible('project-1', 'episode-1')
    queryClient.setQueryData(queryKey, {
      editBible: { id: 'bible-1', title: 'missing version' },
      chapters: [],
    })
    const setQueryData = vi.spyOn(queryClient, 'setQueryData')
    const incomparableCurrent = apply(queryClient, editBibleEnvelope({
      taskId: 'task-current-invalid',
      version: 5,
      title: 'must not replace invalid current data',
    }))
    expect(incomparableCurrent.errors).toEqual([
      'CANVAS_TERMINAL_RESOURCE_CURRENT_VERSION_INVALID:editBible:project-1:episode-1',
    ])
    expect(setQueryData).not.toHaveBeenCalled()
  })
})
