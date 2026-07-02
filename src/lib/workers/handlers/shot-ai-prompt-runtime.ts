import type { Job } from 'bullmq'
import { z } from 'zod'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import type { AnyObj } from './shot-ai-prompt-utils'

export async function runShotPromptCompletion(params: {
  job: Job<TaskJobData>
  model: string
  prompt: string
  action: string
  streamContextKey: string
  streamStepId: string
  streamStepTitle: string
}): Promise<{ text: string; data: AnyObj }> {
  const streamContext = createWorkerLLMStreamContext(params.job, params.streamContextKey)
  const streamCallbacks = createWorkerLLMStreamCallbacks(params.job, streamContext)
  return await (async () => {
    try {
      const result = await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () =>
          await executeAiStructuredTextStep({
            userId: params.job.data.userId,
            model: params.model,
            messages: [{ role: 'user', content: params.prompt }],
            temperature: 0.7,
            projectId: params.job.data.projectId,
            action: params.action,
            locale: params.job.data.locale,
            meta: {
              stepId: params.streamStepId,
              stepTitle: params.streamStepTitle,
              stepIndex: 1,
              stepTotal: 1,
            },
            schema: z.unknown(),
            parse: { kind: 'object' },
            validate: (raw) => raw as AnyObj,
          }),
      )
      return { text: result.text, data: result.data }
    } finally {
      await streamCallbacks.flush()
    }
  })()
}
