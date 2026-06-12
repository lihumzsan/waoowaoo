import type { UIMessageChunk } from 'ai'
import { createAiSdkUiMessageStream } from '@openai/agents-extensions/ai-sdk-ui'

export type ProjectAgentUiChunk = UIMessageChunk

function isFinishChunk(chunk: ProjectAgentUiChunk): boolean {
  const candidate = chunk as { type?: unknown }
  return candidate.type === 'finish'
}

export function createDataChunk(type: string, data: unknown): ProjectAgentUiChunk {
  return {
    type,
    data,
  } as unknown as ProjectAgentUiChunk
}

export function createProjectAgentUiMessageStream(params: {
  source: Parameters<typeof createAiSdkUiMessageStream>[0]
  initialChunks: ProjectAgentUiChunk[]
  drainChunks?: () => ProjectAgentUiChunk[]
  beforeFinish: () => Promise<ProjectAgentUiChunk[]>
  onSettled: () => Promise<void>
}): ReadableStream<ProjectAgentUiChunk> {
  const converted = createAiSdkUiMessageStream(params.source) as ReadableStream<ProjectAgentUiChunk>

  return new ReadableStream<ProjectAgentUiChunk>({
    async start(controller) {
      const reader = converted.getReader()
      let finishChunk: ProjectAgentUiChunk | null = null
      try {
        for (const chunk of params.initialChunks) {
          controller.enqueue(chunk)
        }

        while (true) {
          for (const chunk of params.drainChunks?.() ?? []) {
            controller.enqueue(chunk)
          }
          const read = await reader.read()
          if (read.done) break
          if (isFinishChunk(read.value)) {
            finishChunk = read.value
            continue
          }
          controller.enqueue(read.value)
          for (const chunk of params.drainChunks?.() ?? []) {
            controller.enqueue(chunk)
          }
        }

        for (const chunk of params.drainChunks?.() ?? []) {
          controller.enqueue(chunk)
        }
        const trailingChunks = await params.beforeFinish()
        for (const chunk of trailingChunks) {
          controller.enqueue(chunk)
        }
        if (finishChunk) {
          controller.enqueue(finishChunk)
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        await params.onSettled()
      }
    },
    async cancel() {
      await converted.cancel()
      await params.onSettled()
    },
  })
}
