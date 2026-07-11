import { describe, expect, it } from 'vitest'
import { inspectTerminalResourceRefetchContract } from '../../../scripts/guards/terminal-resource-refetch-guard.mjs'

const valid = {
  schema: 'model ProjectEpisode { id String @id }',
  taskTypes: 'affectedResources?: readonly WorkspaceResourceRef[]',
  workerLifecycle: 'saveTaskHandlerCheckpoint',
  terminalService: 'buildTaskLifecycleEventPayload',
  checkpoint: "state: 'ready'",
  sseSync: 'readWorkspaceResourceRefs(payloadRecord?.affectedResources) syncWorkspaceResourceChanges affectedResources',
  resourceSync: "invalidateQueries refetchQueries type: 'active'",
  packageJson: '"db:push": "prisma db push --skip-generate"',
}

describe('terminal resource refetch guard', () => {
  it('accepts notification-only terminal events and canonical Query refetch', () => {
    expect(inspectTerminalResourceRefetchContract(valid)).toEqual([])
  })

  it('rejects a restored terminal payload cache writer', () => {
    expect(inspectTerminalResourceRefetchContract({
      ...valid,
      sseSync: `${valid.sseSync} materializedResources setQueryData(`,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('SSE sync restores removed terminal resource protocol'),
      'terminal SSE must not write business Query data directly',
    ]))
  })

  it('rejects the removed two-stage checkpoint and trigger setup', () => {
    expect(inspectTerminalResourceRefetchContract({
      ...valid,
      checkpoint: "state: 'executed' finalizeTaskHandlerCheckpoint",
      packageJson: '"db:prepare": "prisma db push && install-resource-revision-triggers"',
    })).toEqual(expect.arrayContaining([
      'handler checkpoint must become ready immediately after the persisted handler result',
      'handler checkpoint must not restore the materialization-only executed/finalize stage',
      'database setup must be the single Prisma db push command',
      'database setup restores the removed trigger installation path',
    ]))
  })
})
