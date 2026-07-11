import { describe, expect, it } from 'vitest'

import {
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN,
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
} from '@/lib/project-agent/stop-conditions'

import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

function toolErrorOutput(operationId: string, code: string) {
  return {
    toolName: operationId,
    output: {
      ok: false,
      error: {
        operationId,
        code,
      },
    },
  }
}

function interruptBoundaryToolErrorOutput(operationId: string, code: string) {
  return {
    toolName: operationId,
    output: {
      ok: false,
      error: {
        operationId,
        code,
        details: {
          suspendsFor: 'choice',
        },
      },
    },
  }
}

export { describe, expect, it } from 'vitest'
export { PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION, PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN, PROJECT_AGENT_MAX_TURNS, createProjectAgentStopController } from '@/lib/project-agent/stop-conditions'
export { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
export { interruptBoundaryToolErrorOutput, toolErrorOutput }
