import { describe, expect, it, vi } from 'vitest'
import {
  createPromptAutoEnsureQueue,
  runPromptAutoEnsureQueue,
} from '@/lib/novel-promotion/stages/video-stage-runtime/prompt-auto-ensure-queue'

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
    }, { concurrency: 8 })

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

  it('keeps one two-worker queue across repeated candidate enqueues', async () => {
    let active = 0
    let maxActive = 0
    const started: string[] = []
    const release = new Map<string, () => void>()
    const queue = createPromptAutoEnsureQueue(async (panelKey) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(panelKey)
      await new Promise<void>((resolve) => release.set(panelKey, resolve))
      active -= 1
    }, { concurrency: 8 })

    queue.enqueue(['a', 'b'])
    queue.enqueue(['b', 'c', 'd', 'd'])

    expect(started).toEqual(['a', 'b'])
    release.get('a')?.()
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c']))
    release.get('b')?.()
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c', 'd']))
    release.get('c')?.()
    release.get('d')?.()
    await queue.whenIdle()

    expect(maxActive).toBe(2)
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops pending keys that are no longer visible when candidates are replaced', async () => {
    const started: string[] = []
    const release = new Map<string, () => void>()
    const queue = createPromptAutoEnsureQueue(async (panelKey) => {
      started.push(panelKey)
      await new Promise<void>((resolve) => release.set(panelKey, resolve))
    })

    queue.enqueue(['old-a', 'old-b', 'old-c', 'old-d'])
    expect(started).toEqual(['old-a', 'old-b'])

    queue.replace(['new-a', 'new-b'])
    release.get('old-a')?.()
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'old-b', 'new-a']))
    release.get('old-b')?.()
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'old-b', 'new-a', 'new-b']))

    expect(started).not.toContain('old-c')
    expect(started).not.toContain('old-d')

    release.get('new-a')?.()
    release.get('new-b')?.()
    await queue.whenIdle()
  })

  it('clears pending work on an empty replacement without duplicating active keys', async () => {
    const started: string[] = []
    const release = new Map<string, () => void>()
    const queue = createPromptAutoEnsureQueue(async (panelKey) => {
      started.push(panelKey)
      await new Promise<void>((resolve) => release.set(panelKey, resolve))
    })

    queue.enqueue(['active-a', 'active-b', 'pending-a', 'pending-b'])
    expect(started).toEqual(['active-a', 'active-b'])

    queue.replace(['active-a'])
    queue.replace([])
    release.get('active-a')?.()
    release.get('active-b')?.()
    await queue.whenIdle()

    expect(started).toEqual(['active-a', 'active-b'])
  })
})
