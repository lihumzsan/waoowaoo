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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await readProjectAgentSessionEventWatermark(input)
    const thread = await loadProjectAssistantThread(input)
    const after = await readProjectAgentSessionEventWatermark(input)
    if (before === after) return { thread, eventWatermark: after }
  }
  throw new Error('PROJECT_ASSISTANT_THREAD_SNAPSHOT_UNSTABLE')
}
