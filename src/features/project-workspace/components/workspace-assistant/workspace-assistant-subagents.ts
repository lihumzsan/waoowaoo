import {
  type ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'
import type { WorkspaceAssistantSubagentReasoningStream } from './workspace-assistant-subagent-stream'

/**
 * SessionState projects the authoritative Task-backed Subagent view. Message
 * parts are deliberately excluded so history cannot become a second status
 * source after the foreground Operation has submitted its Tasks.
 */
export function resolveWorkspaceAssistantSubagents(params: {
  sessionSubagents: readonly ProjectAgentSubagentView[]
  reasoningStreams: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream>
}): ProjectAgentSubagentView[] {
  return params.sessionSubagents.map((subagent) => {
    if (subagent.status !== 'running') return subagent
    const streams = [...params.reasoningStreams.values()]
      .filter((stream) => stream.taskId === subagent.taskId)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    if (streams.length === 0) return subagent
    const events = [...subagent.events]
    for (const stream of streams) {
      const index = events.findIndex((entry) => (
        entry.event.kind === 'reasoning'
        && entry.event.reasoningId === stream.reasoningId
      ))
      if (index < 0) {
        events.push({
          subagentId: subagent.subagentId,
          taskId: subagent.taskId,
          runId: subagent.runId,
          toolCallId: subagent.toolCallId,
          sequence: Math.max(0, ...events.map((entry) => entry.sequence)) + 1,
          occurredAt: stream.occurredAt,
          event: {
            kind: 'reasoning',
            reasoningId: stream.reasoningId,
            text: stream.text,
            status: 'running',
            truncated: false,
          },
        })
        continue
      }
      const existing = events[index]
      if (!existing || existing.event.kind !== 'reasoning') continue
      const durableText = existing.event.text
      const text = stream.text.startsWith(durableText)
        ? stream.text
        : durableText.startsWith(stream.text)
          ? durableText
          : null
      if (text === null) {
        throw new Error(`WORKSPACE_SUBAGENT_REASONING_DIVERGED:${stream.reasoningId}`)
      }
      events[index] = {
        ...existing,
        event: {
          ...existing.event,
          text,
          status: 'running',
        },
      }
    }
    return { ...subagent, events }
  })
}
