import type { UIMessage, UIMessageChunk } from 'ai'
import type {
  RuntimeJsonValue,
  RuntimeRequestId,
  RuntimeServerRequestResponse,
  RuntimeUserInput,
} from '@/lib/codex-runtime/runtime-adapter'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import type { LlmUsageFact } from '@/lib/billing/llm-usage'

export const ASSISTANT_RUNTIME_ASSISTANT_ID = 'workspace-command' as const

export class AssistantRuntimeProjectBusyError extends Error {
  constructor() {
    super('ASSISTANT_RUNTIME_PROJECT_BUSY')
    this.name = 'AssistantRuntimeProjectBusyError'
  }
}

export type AssistantRuntimeScope = {
  readonly projectId: string
  readonly userId: string
}

export type AssistantRuntimeTurnContext = {
  readonly locale: string
  readonly selectedScopeRef: string | null
  readonly selectedAssetId: string | null
}

export type AssistantRuntimeSubmitCommand = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly requestId: string
  readonly sourceId: string
  readonly message: UIMessage
  readonly context: AssistantRuntimeTurnContext
}

export type AssistantRuntimeSteerCommand = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly threadId: string
  readonly turnId: string
  readonly sourceId: string
  readonly message: UIMessage
}

export type AssistantRuntimeInterruptCommand = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly threadId: string
  readonly turnId: string
  readonly requestId: string
  readonly reason: string | null
}

export type AssistantRuntimeServerRequestCommand = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly threadId: string
  readonly turnId: string
  readonly interactionId: string
  readonly response: RuntimeServerRequestResponse
}

export type AssistantRuntimeClearCommand = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly threadId: string
  readonly requestId: string
}

export type AssistantRuntimeThreadIdentity = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly threadId: string
  readonly runtimeThreadId: string | null
}

export type AssistantRuntimeTurnIdentity = AssistantRuntimeThreadIdentity & {
  readonly turnId: string
  readonly runtimeTurnId: string | null
  readonly attempt: number
  readonly status: string
}

export type AssistantRuntimeAdmissionReceipt = {
  readonly outcome: 'accepted' | 'replayed'
  readonly threadId: string
  readonly turnId: string
  readonly runtimeThreadId: string | null
  readonly runtimeTurnId: string | null
}

export type AssistantRuntimeSteerReceipt = {
  readonly threadId: string
  readonly turnId: string
  readonly runtimeTurnId: string
}

export type AssistantRuntimeMessageReceipt =
  | AssistantRuntimeAdmissionReceipt
  | AssistantRuntimeSteerReceipt

export type AssistantRuntimeInterruptReceipt = {
  readonly threadId: string
  readonly turnId: string
  readonly status: 'interrupt_requested' | 'already_terminal'
}

export type AssistantRuntimeClearReceipt = {
  readonly threadId: string
  readonly archived: true
}

export type AssistantRuntimeTaskFollowUpReceipt =
  | { readonly outcome: 'cancelled'; readonly batchId: string }
  | {
      readonly outcome: 'accepted' | 'replayed'
      readonly batchId: string
      readonly threadId: string
      readonly turnId: string
      readonly runtimeThreadId: string | null
      readonly runtimeTurnId: string | null
    }

export type AssistantRuntimePreparedInput = {
  readonly message: UIMessage
  readonly inputs: readonly RuntimeUserInput[]
  readonly visibleText: string
}

export type AssistantRuntimeTaskFollowUp = AssistantRuntimeScope & {
  readonly assistantId: typeof ASSISTANT_RUNTIME_ASSISTANT_ID
  readonly batchId: string
  readonly threadId: string
  readonly requestId: string
  readonly context: AssistantRuntimeTurnContext
  readonly inputs: readonly RuntimeUserInput[]
}

export type AssistantRuntimeInteractionView = {
  readonly interactionId: string
  readonly threadId: string
  readonly turnId: string
  readonly runtimeRequestId: string
  readonly requestId: RuntimeRequestId
  readonly method: string
  readonly payload: RuntimeJsonValue
}

export interface AssistantRuntimeEventSink {
  /** Returns the monotonic stream watermark, or null when streaming is disabled. */
  reserveChunk(chunk: UIMessageChunk): number | null
  /** Route subsequent chunks to a new durable assistant segment after steer. */
  setMessageId(messageId: string): void
  /** Publish only after the matching durable message watermark has committed. */
  publishChunksThrough(watermark: number): Promise<void>
  publishViewChanged(reason: string): Promise<void>
}

export type AssistantRuntimeTerminalProjection = {
  readonly status: 'completed' | 'failed' | 'interrupted'
  readonly stopReason: string
  readonly errorCode: UnifiedErrorCode | null
  readonly errorMessage: string | null
  readonly assistantMessage: UIMessage | null
  readonly usage: LlmUsageFact | null
}
