import { randomUUID } from 'node:crypto'
import type { UIMessage } from 'ai'
import {
  AGENT_TURN_PROTOCOL,
  AGENT_TURN_SOURCE_KIND,
  type SubmitAgentTurnCommand,
} from '@/lib/agent-turn/contracts'
import { getOrCreateProjectAssistantThread } from '@/lib/project-agent/persistence'
import { createFixtureProject, createFixtureUser } from '../../../helpers/fixtures'
import { prisma } from '../../../helpers/prisma'

export interface AgentTurnFixture {
  readonly userId: string
  readonly projectId: string
  readonly threadId: string
  readonly sourceId: string
}

export async function createAgentTurnFixture(): Promise<AgentTurnFixture> {
  const user = await createFixtureUser()
  const project = await createFixtureProject(user.id)
  const thread = await getOrCreateProjectAssistantThread({
    projectId: project.id,
    userId: user.id,
    episodeId: null,
    assistantId: 'workspace-command',
  })
  return {
    userId: user.id,
    projectId: project.id,
    threadId: thread.id,
    sourceId: `user-source-${randomUUID()}`,
  }
}

export function buildUserTurnCommand(
  fixture: AgentTurnFixture,
  text: string,
): SubmitAgentTurnCommand {
  const message: UIMessage = {
    id: `user-message-${fixture.sourceId}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
  return {
    protocol: AGENT_TURN_PROTOCOL,
    threadId: fixture.threadId,
    projectId: fixture.projectId,
    userId: fixture.userId,
    assistantId: 'workspace-command',
    sourceKind: AGENT_TURN_SOURCE_KIND.USER,
    sourceId: fixture.sourceId,
    requestId: `request-${fixture.sourceId}`,
    userMessage: message,
    context: {
      locale: 'zh',
      episodeId: null,
      selectedScopeRef: null,
      selectedAssetId: null,
    },
  }
}

export async function removeAgentTurnFixture(
  fixture: AgentTurnFixture,
): Promise<void> {
  await prisma.project.delete({ where: { id: fixture.projectId } })
  await prisma.user.delete({ where: { id: fixture.userId } })
}
