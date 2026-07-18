import { describe, expect, it } from 'vitest'
import { runPromptAutoEnsureQueue } from '@/lib/novel-promotion/stages/video-stage-runtime/prompt-auto-ensure-queue'

describe('runPromptAutoEnsureQueue', () => {
  it('limits automatic prompt ensures to two concurrent panel keys', async () => {
    let active = 0
    let maxActive = 0
    const completed: string[] = []

    await runPromptAutoEnsureQueue(['a', 'b', 'c', 'd'], async (panelKey) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      completed.push(panelKey)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
    }, { concurrency: 2 })

    expect(maxActive).toBe(2)
    expect(completed).toEqual(['a', 'b', 'c', 'd'])
  })

  it('stops scheduling queued panel keys after cancellation', async () => {
    const completed: string[] = []
    let cancelled = false

    await runPromptAutoEnsureQueue(['a', 'b', 'c'], async (panelKey) => {
      completed.push(panelKey)
      cancelled = true
    }, { isCancelled: () => cancelled })

    expect(completed).toEqual(['a'])
  })
})
