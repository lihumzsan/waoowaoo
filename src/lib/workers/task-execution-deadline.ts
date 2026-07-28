import type { TaskType } from '@/lib/task/types'

export type TaskAttemptExecutionContext = {
  readonly signal: AbortSignal
  readonly executionDeadlineMs: number | null
}

export class TaskExecutionDeadlineExceededError extends Error {
  readonly code = 'GENERATION_TIMEOUT'
  readonly details: {
    readonly taskType: TaskType
    readonly timeoutMs: number
  }

  constructor(taskType: TaskType, timeoutMs: number) {
    super(taskType === 'creative_work' ? 'CREATIVE_WORK_TIMEOUT' : 'TASK_EXECUTION_TIMEOUT')
    this.name = 'TaskExecutionDeadlineExceededError'
    this.details = { taskType, timeoutMs }
  }
}

export async function runWithTaskExecutionDeadline<T>(input: {
  readonly taskType: TaskType
  readonly executionDeadlineMs: number | null
  readonly run: (context: TaskAttemptExecutionContext) => Promise<T>
}): Promise<T> {
  const controller = new AbortController()
  const executionDeadlineMs = input.executionDeadlineMs
  if (executionDeadlineMs === null) {
    return await input.run({
      signal: controller.signal,
      executionDeadlineMs: null,
    })
  }
  if (!Number.isSafeInteger(executionDeadlineMs) || executionDeadlineMs <= 0) {
    throw new Error(`TASK_EXECUTION_DEADLINE_INVALID:${input.taskType}`)
  }

  const timeoutError = new TaskExecutionDeadlineExceededError(
    input.taskType,
    executionDeadlineMs,
  )
  let timeout: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(timeoutError)
      controller.abort(timeoutError)
    }, executionDeadlineMs)
    timeout.unref()
  })

  try {
    return await Promise.race([
      input.run({
        signal: controller.signal,
        executionDeadlineMs,
      }),
      deadline,
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
