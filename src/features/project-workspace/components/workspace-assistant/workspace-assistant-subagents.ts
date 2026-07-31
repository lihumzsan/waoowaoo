import { type ProjectAgentSubagentView } from '@/lib/project-agent/subagent-events'
import type { WorkspaceAssistantSubagentLiveStream } from './workspace-assistant-subagent-stream'

export function resolveWorkspaceAssistantSubagentStructuredOutputs(
  liveStreams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>,
): ReadonlyMap<string, string> {
  const latestByTask = new Map<string, WorkspaceAssistantSubagentLiveStream>()
  for (const stream of liveStreams.values()) {
    if (stream.kind !== 'structured_output') continue
    const current = latestByTask.get(stream.taskId)
    if (
      !current ||
      stream.stepAttempt > current.stepAttempt ||
      (stream.stepAttempt === current.stepAttempt && stream.occurredAt > current.occurredAt)
    ) {
      latestByTask.set(stream.taskId, stream)
    }
  }
  return new Map([...latestByTask].map(([taskId, stream]) => [taskId, stream.text]))
}

/**
 * AgentSessionView projects the authoritative Task-backed Subagent view. Message
 * parts are deliberately excluded so history cannot become a second status
 * source after the foreground Operation has submitted its Tasks.
 */
export function resolveWorkspaceAssistantSubagents<T extends ProjectAgentSubagentView>(params: {
  sessionSubagents: readonly T[]
  liveStreams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>
}): T[] {
  return params.sessionSubagents.map((subagent) => {
    if (subagent.status !== 'running') return subagent
    const streams = [...params.liveStreams.values()]
      .filter((stream) => stream.kind === 'reasoning' && stream.taskId === subagent.taskId)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    if (streams.length === 0) return subagent
    const events = [...subagent.events]
    for (const stream of streams) {
      const index = events.findIndex(
        (entry) => entry.event.kind === 'reasoning' && entry.event.reasoningId === stream.streamId,
      )
      if (index < 0) {
        events.push({
          subagentId: subagent.subagentId,
          taskId: subagent.taskId,
          originTurnId: subagent.originTurnId,
          callId: subagent.callId,
          sequence: Math.max(0, ...events.map((entry) => entry.sequence)) + 1,
          occurredAt: stream.occurredAt,
          event: {
            kind: 'reasoning',
            reasoningId: stream.streamId,
            text: stream.text,
            status: 'running',
            truncated: false,
          },
        })
        continue
      }
      const existing = events[index]
      if (!existing || existing.event.kind !== 'reasoning') continue
      // completed 是该 reasoning 的终态事实(worker 持久化),晚到的直播尾巴不得把它
      // 复活成 running——否则已完成的推理会永久显示转圈并保留 28ms 播放定时器。
      if (existing.event.status === 'completed') continue
      const durableText = existing.event.text
      const text = stream.text.startsWith(durableText)
        ? stream.text
        : durableText.startsWith(stream.text)
          ? durableText
          : null
      if (text === null) {
        throw new Error(`WORKSPACE_SUBAGENT_REASONING_DIVERGED:${stream.streamId}`)
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
