import { describe, expect, it, vi } from 'vitest'
import { expandHomeStory } from '@/lib/home/ai-story-expand'

vi.mock('@/lib/task/client', () => ({
  resolveTaskResponse: vi.fn(),
}))

import { resolveTaskResponse } from '@/lib/task/client'

function buildJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('expandHomeStory', () => {
  it('posts the prompt to the user ai-story-expand route and returns expanded text', async () => {
    const apiFetch = vi.fn(async () => buildJsonResponse({ async: true, taskId: 'task-1' }))
    vi.mocked(resolveTaskResponse).mockResolvedValue({
      expandedText: '扩写后的故事正文',
    })

    const result = await expandHomeStory({
      apiFetch,
      prompt: '宫廷复仇女主回京',
    })

    expect(apiFetch).toHaveBeenCalledWith('/api/user/ai-story-expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '宫廷复仇女主回京',
      }),
    })
    expect(result).toEqual({
      expandedText: '扩写后的故事正文',
    })
  })

  it('fails explicitly when the route does not return expandedText', async () => {
    const apiFetch = vi.fn(async () => buildJsonResponse({ async: true, taskId: 'task-1' }))
    vi.mocked(resolveTaskResponse).mockResolvedValue({})

    await expect(expandHomeStory({
      apiFetch,
      prompt: '宫廷复仇女主回京',
    })).rejects.toThrow('AI story expand response missing expandedText')
  })
})
