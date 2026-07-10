import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RunContext } from '@openai/agents'

import { z } from 'zod'

import type { NextRequest } from 'next/server'

import { createProjectAgentOperationTool } from '@/lib/project-agent/agents-tool-adapter'

import { createProjectAgentApprovalPreflightStore } from '@/lib/project-agent/approval-preflight'

import type { ProjectAgentOperationDefinition, RuntimeSchema } from '@/lib/operations/types'

import { createProjectAgentToolInputSchema } from '@/lib/operations/tool-input-schema'

import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

import { EFFECTS_BILLABLE, EFFECTS_NONE } from '../../helpers/project-agent-operations'

const executeState = vi.hoisted(() => ({
  executeProjectAgentOperationFromTool: vi.fn(async (): Promise<unknown> => ({
    ok: true,
    data: {
      success: true,
      async: true,
      taskId: 'task-1',
      status: 'queued',
    },
  })),
}))

const eventState = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async (params: { events: Array<{ event: { kind: string; runId?: string; activityId?: string; operationId?: string | null; toolCallId?: string | null } }> }) => {
    const activityEvent = params.events.map((item) => item.event).find((event) => 'activityId' in event)
    if (!activityEvent?.activityId || !activityEvent.runId) return null
    return {
      activityId: activityEvent.activityId,
      runId: activityEvent.runId,
      type: activityEvent.kind === 'activity.started' ? 'operation' : 'operation',
      status: activityEvent.kind === 'activity.failed' ? 'failed' : activityEvent.kind === 'activity.completed' ? 'completed' : 'running',
      operationId: activityEvent.operationId ?? 'generate_edit_script_storyboard_images',
      sourceOperationId: null,
      toolCallId: activityEvent.toolCallId ?? null,
      choiceType: null,
    }
  }),
}))

const prismaState = vi.hoisted(() => ({
  projectAgentEvent: {
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaState,
}))

vi.mock('@/lib/adapters/tools/execute-project-agent-operation', () => ({
  executeProjectAgentOperationFromTool: executeState.executeProjectAgentOperationFromTool,
}))

vi.mock('@/lib/project-agent/event', () => ({
  appendProjectAgentEvents: eventState.appendProjectAgentEvents,
}))

function buildOperation(
  operationId: ProjectAgentOperationDefinition['id'] = 'generate_edit_script_storyboard_images',
  intent: ProjectAgentOperationDefinition['intent'] = 'act',
): ProjectAgentOperationDefinition {
  const inputSchema = z.object({
    episodeId: z.string().min(1),
    confirmed: z.boolean().optional(),
  })
  return {
    id: operationId,
    summary: 'Generate images',
    intent,
    groupPath: ['storyboard'],
    channels: {
      tool: true,
      api: false,
    },
    prerequisites: {
      episodeId: 'required',
    },
    effects: EFFECTS_BILLABLE,
    confirmation: {
      kind: 'destructive',
      required: true,
      summary: 'Confirm billable generation',
    },
    toolInputSchema: createProjectAgentToolInputSchema({
      operationId,
      inputSchema: inputSchema as RuntimeSchema<unknown>,
    }),
    inputSchema,
    outputSchema: z.object({
      success: z.boolean(),
    }),
    execute: async () => ({ success: true }),
  }
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { RunContext } from '@openai/agents'
export { z } from 'zod'
export type { NextRequest } from 'next/server'
export { createProjectAgentOperationTool } from '@/lib/project-agent/agents-tool-adapter'
export { createProjectAgentApprovalPreflightStore } from '@/lib/project-agent/approval-preflight'
export type { ProjectAgentOperationDefinition, RuntimeSchema } from '@/lib/operations/types'
export { createProjectAgentToolInputSchema } from '@/lib/operations/tool-input-schema'
export { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
export { EFFECTS_BILLABLE, EFFECTS_NONE } from '../../helpers/project-agent-operations'
export { buildOperation, eventState, executeState, prismaState }
