import { describe, expect, it } from 'vitest'
import { assertAsyncMigrationPreflightClear } from '../../../scripts/check-async-migration-preflight'

const clear = {
  activeTasks: 0,
  legacyStyleParentTasks: 0,
  pendingOutboxCommands: 0,
  activeAssistantRuns: 0,
  activeAssistantWaits: 0,
} as const

describe('async migration preflight', () => {
  it('accepts only a fully drained async system', () => {
    expect(() => assertAsyncMigrationPreflightClear(clear)).not.toThrow()
  })

  it('reports every non-zero blocker without guessing or mutating it', () => {
    expect(() => assertAsyncMigrationPreflightClear({
      ...clear,
      activeTasks: 2,
      pendingOutboxCommands: 3,
      activeAssistantWaits: 1,
    })).toThrow('ASYNC_MIGRATION_PREFLIGHT_BLOCKED:activeTasks=2,pendingOutboxCommands=3,activeAssistantWaits=1')
  })
})
