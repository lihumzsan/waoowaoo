import type { LLMStreamKind } from '@/lib/llm-observe/types'
import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'

export interface ChatCompletionOptions {
    temperature?: number
    reasoning?: boolean
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
    maxRetries?: number
    // 调用上下文，用于日志、任务控制台和错误归因
    projectId?: string
    action?: string
    // 流式步骤元信息（用于任务控制台按步骤展示）
    streamStepId?: string
    streamStepAttempt?: number
    streamStepTitle?: string
    streamStepIndex?: number
    streamStepTotal?: number
    // 内部保护位：避免 chatCompletion 与 chatCompletionStream 互相递归
    __skipAutoStream?: boolean
}

export interface ChatCompletionStreamCallbacks {
    onStage?: (stage: {
        stage: 'submit' | 'streaming' | 'fallback' | 'completed'
        provider?: string | null
        step?: InternalLLMStreamStepMeta
    }) => void
    onChunk?: (chunk: {
        kind: LLMStreamKind
        delta: string
        seq: number
        lane?: string | null
        step?: InternalLLMStreamStepMeta
    }) => void
    onComplete?: (text: string, step?: InternalLLMStreamStepMeta) => void
    onError?: (error: unknown, step?: InternalLLMStreamStepMeta) => void
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }
