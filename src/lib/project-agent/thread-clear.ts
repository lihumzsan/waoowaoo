import { prisma } from '@/lib/prisma'
import { appendProjectAgentSessionEventInTransaction } from './event'
import {
  clearProjectAssistantThreadInTransaction,
  type ProjectAssistantThreadIdentity,
} from './persistence'

export interface ProjectAssistantThreadClearResult {
  eventWatermark: string
}

export async function clearProjectAssistantThread(
  input: ProjectAssistantThreadIdentity,
): Promise<ProjectAssistantThreadClearResult> {
  return await prisma.$transaction(async (tx) => {
    await clearProjectAssistantThreadInTransaction(tx, input)
    const eventWatermark = await appendProjectAgentSessionEventInTransaction(tx, {
      scope: input,
      event: { kind: 'thread.cleared' },
    })
    return { eventWatermark }
  })
}
