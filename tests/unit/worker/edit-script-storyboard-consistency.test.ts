import { describe, expect, it } from 'vitest'
import { runStoryboardConsistencyItemsInParallel } from '@/lib/workers/handlers/edit-script-storyboard-consistency-task-handler'

describe('edit-script storyboard consistency worker helpers', () => {
  it('runs spatial blocking work in parallel and reports the first failure', async () => {
    const seen: number[] = []

    await expect(runStoryboardConsistencyItemsInParallel([1, 2, 3], async (item) => {
      seen.push(item)
      if (item === 2) throw new Error('spatial blocking failed')
    })).rejects.toThrow('spatial blocking failed')

    expect(seen.sort()).toEqual([1, 2, 3])
  })
})
