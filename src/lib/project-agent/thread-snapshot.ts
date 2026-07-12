import type { ProjectAssistantThreadSnapshot } from './types'
import {
  loadProjectAssistantThread,
  type ProjectAssistantThreadIdentity,
} from './persistence'
import { readProjectAgentSessionEventWatermark } from './session-event'

export interface ProjectAssistantThreadWatermarkedSnapshot {
  thread: ProjectAssistantThreadSnapshot | null
  eventWatermark: string
}

export async function getProjectAssistantThreadWatermarkedSnapshot(
  input: ProjectAssistantThreadIdentity,
): Promise<ProjectAssistantThreadWatermarkedSnapshot> {
  const before = await readProjectAgentSessionEventWatermark(input)
  const thread = await loadProjectAssistantThread(input)
  const after = await readProjectAgentSessionEventWatermark(input)
  return {
    thread,
    eventWatermark: before === after ? after : before,
  }
}
