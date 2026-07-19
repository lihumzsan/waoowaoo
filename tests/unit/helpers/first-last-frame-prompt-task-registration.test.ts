import { describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { getLLMTaskPolicy } from '@/lib/llm-observe/task-policy'
import { getTaskTypeLabel } from '@/lib/task/progress-message'
import { resolveTaskIntent } from '@/lib/task/intent'
import { TASK_TYPE_CATALOG } from '../../contracts/task-type-catalog'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('bullmq', () => ({
  Queue: class {
    setGlobalConcurrency = vi.fn()
    add = vi.fn()
    getJob = vi.fn()
  },
}))

describe('first-last-frame prompt task registration', () => {
  it('registers the public wire value and text-task behavior', () => {
    expect(TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT).toBe('generate_first_last_frame_prompt')
    expect(getQueueTypeByTaskType(TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT)).toBe('text')
    expect(resolveTaskIntent(TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT)).toBe('generate')
    expect(getTaskTypeLabel(TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT)).toBe(
      'progress.taskType.generateFirstLastFramePrompt',
    )
    expect(getLLMTaskPolicy(TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT)).toMatchObject({
      consoleEnabled: true,
      displayMode: 'loading',
      captureReasoning: true,
    })
  })

  it('declares focused worker coverage ownership', () => {
    expect(TASK_TYPE_CATALOG).toContainEqual(expect.objectContaining({
      taskType: TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT,
      owner: 'tests/unit/worker/first-last-frame-prompt.test.ts',
    }))
  })

  it('dispatches the task through the text worker', () => {
    const workerSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/workers/text.worker.ts'),
      'utf8',
    )
    expect(workerSource).toContain('case TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT:')
    expect(workerSource).toContain('handleFirstLastFramePromptTask(job)')
  })

  it('relays polled task progress into the prompt card while regeneration is running', () => {
    const mutationSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/query/mutations/useVideoMutations.ts'),
      'utf8',
    )
    const promptEntriesSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts',
      ),
      'utf8',
    )

    expect(mutationSource).toMatch(/resolveTaskResponse<FirstLastFramePromptResult>\(response,\s*\{\s*onTaskUpdate:\s*payload\.onTaskUpdate,?\s*\}\s*\)/)
    expect(promptEntriesSource).toContain('onTaskUpdate: (task) => {')
    expect(promptEntriesSource).toContain("projectPromptTaskState(current, { phase: task.status })")
  })
})
