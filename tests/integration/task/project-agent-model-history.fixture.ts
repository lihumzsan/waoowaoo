import { ProjectAgentModelSession } from '@/lib/project-agent/model-session'
import type {
  ProjectAssistantModelHistoryCommit,
  ProjectAssistantThreadIdentity,
} from '@/lib/project-agent/persistence'

export async function buildReadyProjectAgentModelHistoryCommit(
  identity: ProjectAssistantThreadIdentity,
  executionSegmentId: string,
): Promise<ProjectAssistantModelHistoryCommit> {
  return await new ProjectAgentModelSession(identity, executionSegmentId).buildCommit()
}

export async function stageUnreadyProjectAgentModelHistory(
  identity: ProjectAssistantThreadIdentity,
  executionSegmentId: string,
): Promise<void> {
  const session = new ProjectAgentModelSession(identity, executionSegmentId)
  await session.replaceItems(await session.getItems())
}
