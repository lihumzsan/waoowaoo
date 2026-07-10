import { describe, expect, it } from 'vitest'
import { inspectTaskReconcilerContract } from '../../../scripts/guards/single-task-reconciler-guard.mjs'

const reconciler = `
  export type TaskJobObservation = 'alive' | 'terminal' | 'absent' | 'unavailable'
  buildTaskJobEnvelope(task)
`

describe('single task reconciler guard', () => {
  it('accepts a single shared reconciler with four-state observation', () => {
    expect(inspectTaskReconcilerContract({
      watchdogExists: false,
      packageJson: '{"scripts":{"start":"next"}}',
      instrumentation: 'startTaskReconciler()',
      reconcile: reconciler,
    })).toEqual([])
  })

  it('rejects a second watchdog and startup Task mutation', () => {
    expect(inspectTaskReconcilerContract({
      watchdogExists: true,
      packageJson: '{"scripts":{"start:watchdog":"tsx scripts/watchdog.ts"}}',
      instrumentation: 'prisma.task.updateMany({})',
      reconcile: reconciler,
    })).toEqual([
      'scripts/watchdog.ts must not own Task recovery or lifecycle writes',
      'package scripts must not start a second Task watchdog',
      'instrumentation must start the shared Task reconciler',
      'instrumentation must not write or reconstruct Task state: prisma.task',
      'instrumentation must not write or reconstruct Task state: updateMany({',
    ])
  })
})
