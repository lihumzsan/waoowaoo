import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('worker log context concurrency', () => {
  it('preserves each Task attempt in the real tsx worker runtime', () => {
    const probe = `
      import { getLogContext, withLogContext } from './src/lib/logging/context'
      void (async () => {
        const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
        const observed = await Promise.all([
          withLogContext({ taskId: 'task-a', taskAttempt: 1 }, async () => {
            await delay(10)
            return getLogContext()
          }),
          withLogContext({ taskId: 'task-b', taskAttempt: 2 }, async () => {
            await delay(30)
            return getLogContext()
          }),
        ])
        const passed = observed[0]?.taskId === 'task-a'
          && observed[0]?.taskAttempt === 1
          && observed[1]?.taskId === 'task-b'
          && observed[1]?.taskAttempt === 2
        if (!passed) {
          console.error(JSON.stringify(observed))
          process.exitCode = 2
        }
      })()
    `
    const result = spawnSync(`${process.cwd()}/node_modules/.bin/tsx`, [
      '--eval',
      probe,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(result.status, result.stderr || result.stdout).toBe(0)
  })
})
