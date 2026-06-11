import type { OperationIntent } from '@/lib/operations/types'
import type { ProjectAgentInteractionMode } from './types'

export interface ProjectAgentExecutionResolution {
  interactionMode: ProjectAgentInteractionMode
  effectiveIntent: OperationIntent
}

export function resolveProjectAgentExecutionMode(input: {
  interactionMode?: ProjectAgentInteractionMode
}): ProjectAgentExecutionResolution {
  const interactionMode = input.interactionMode ?? 'auto'

  if (interactionMode === 'plan') {
    return {
      interactionMode,
      effectiveIntent: 'plan',
    }
  }

  return {
    interactionMode,
    effectiveIntent: 'act',
  }
}
