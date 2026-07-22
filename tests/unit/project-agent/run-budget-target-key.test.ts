import { describe, expect, it } from 'vitest'
import { buildProjectAgentOperationTargetKey } from '@/lib/project-agent/run-budget'

const context = {
  projectId: 'project-1',
  userId: 'user-1',
  assistantId: 'assistant-1',
  runId: 'run-1',
  episodeId: 'episode-1',
  scopeRef: 'episode:episode-1',
} as const

describe('Project Agent operation run-budget identity', () => {
  it('uses the complete canonical invocation instead of legacy target-field guesses', () => {
    const first = buildProjectAgentOperationTargetKey({
      operationId: 'create_image',
      projectId: 'project-1',
      context,
      toolInput: { prompt: 'Moonlit harbor', count: 1 },
    })
    const replay = buildProjectAgentOperationTargetKey({
      operationId: 'create_image',
      projectId: 'project-1',
      context,
      toolInput: { count: 1, prompt: 'Moonlit harbor' },
    })
    const independent = buildProjectAgentOperationTargetKey({
      operationId: 'create_image',
      projectId: 'project-1',
      context,
      toolInput: { prompt: 'Sunrise observatory', count: 1 },
    })

    expect(first).toBe(replay)
    expect(first).not.toBe(independent)
    expect(first).toMatch(/^input:[a-f0-9]{16}$/)
  })
})
