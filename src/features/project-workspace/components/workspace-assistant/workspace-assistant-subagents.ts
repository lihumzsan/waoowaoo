import {
  type ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'

/**
 * SessionState projects the authoritative Task-backed Subagent view. Message
 * parts are deliberately excluded so history cannot become a second status
 * source after the foreground Operation has submitted its Tasks.
 */
export function resolveWorkspaceAssistantSubagents(params: {
  sessionSubagents: readonly ProjectAgentSubagentView[]
}): ProjectAgentSubagentView[] {
  return [...params.sessionSubagents]
}
