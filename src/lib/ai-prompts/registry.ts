import { AI_PROMPT_IDS, type AiPromptId } from './ids'
import type { AiPromptCatalogEntry } from './types'

export const AI_PROMPT_CATALOG: Record<AiPromptId, AiPromptCatalogEntry> = {
  [AI_PROMPT_IDS.PROJECT_AGENT_SYSTEM]: {
    pathStem: 'project-agent/system',
    variableKeys: ['project_id', 'episode_id'],
  },
}

const OPERATION_TO_AI_PROMPT_ID = new Map<string, AiPromptId>()

for (const [promptId, entry] of Object.entries(AI_PROMPT_CATALOG) as Array<[AiPromptId, AiPromptCatalogEntry]>) {
  for (const operationId of entry.operationIds ?? []) {
    OPERATION_TO_AI_PROMPT_ID.set(operationId, promptId)
  }
}

export function resolveAiPromptIdFromOperationId(operationId: string): AiPromptId {
  const resolved = OPERATION_TO_AI_PROMPT_ID.get(operationId)
  if (!resolved) {
    throw new Error(`AI_PROMPT_OPERATION_UNREGISTERED:${operationId}`)
  }
  return resolved
}
