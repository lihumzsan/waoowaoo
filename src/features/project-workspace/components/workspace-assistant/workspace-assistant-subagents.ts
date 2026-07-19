import type { UIMessage } from 'ai'
import {
  parseProjectAgentSubagentEventPartData,
  resolveActiveProjectAgentSubagents,
  type ProjectAgentSubagentEventPartData,
  type ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'

function readLatestAssistantSubagentEvents(
  messages: readonly UIMessage[],
): ProjectAgentSubagentEventPartData[] {
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
  if (!latestAssistantMessage) return []
  return latestAssistantMessage.parts.flatMap((part) => (
    part.type === 'data-agent-subagent-event'
      ? [parseProjectAgentSubagentEventPartData(part.data)]
      : []
  ))
}

/**
 * The Session View is authoritative after refresh. The latest response's data
 * parts are only transport increments that reduce UI latency before the
 * matching persisted event is projected back through SessionState.
 */
export function resolveWorkspaceAssistantActiveSubagents(params: {
  sessionSubagents: readonly ProjectAgentSubagentView[]
  messages: readonly UIMessage[]
}): ProjectAgentSubagentView[] {
  const sessionEvents = params.sessionSubagents.flatMap((subagent) => subagent.events)
  const liveEvents = readLatestAssistantSubagentEvents(params.messages)
  return resolveActiveProjectAgentSubagents([...sessionEvents, ...liveEvents])
}
