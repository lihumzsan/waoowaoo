import { Prisma } from '@prisma/client'
import type { ProjectAssistantId } from './types'

interface ProjectAssistantThreadScopeInput {
  projectId: string
  episodeId?: string | null
}

interface ReplaceProjectAssistantThreadPlanInput extends ProjectAssistantThreadScopeInput {
  userId: string
  assistantId: ProjectAssistantId
  planJson: Prisma.InputJsonValue | typeof Prisma.DbNull
}

export function buildProjectAssistantScopeRef(
  input: ProjectAssistantThreadScopeInput,
): string {
  return input.episodeId
    ? `episode:${input.episodeId}`
    : `project:${input.projectId}`
}

export async function replaceProjectAssistantThreadPlanInTransaction(
  transaction: Prisma.TransactionClient,
  input: ReplaceProjectAssistantThreadPlanInput,
): Promise<void> {
  const scopeRef = buildProjectAssistantScopeRef(input)
  const updated = await transaction.projectAssistantThread.updateMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef,
    },
    data: { planJson: input.planJson },
  })
  if (updated.count !== 1) {
    throw new Error(
      `PROJECT_ASSISTANT_THREAD_NOT_FOUND:${input.projectId}:${scopeRef}`,
    )
  }
}
