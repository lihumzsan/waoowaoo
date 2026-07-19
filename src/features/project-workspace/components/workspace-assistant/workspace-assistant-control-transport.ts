import {
  DefaultChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type { WorkspaceAssistantControlEndpoint } from './workspace-assistant-runtime-state'

export class WorkspaceAssistantControlTransport extends DefaultChatTransport<UIMessage> {
  public toUIMessageChunkStream(stream: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
    return this.processResponseStream(stream)
  }
}

export function buildWorkspaceAssistantControlError(
  _endpoint: WorkspaceAssistantControlEndpoint,
  error: unknown,
): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`PROJECT_ASSISTANT_CARD_RESPONSE_FAILED:${message}`)
}
