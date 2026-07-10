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

describe('createProjectAgentOperationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.projectAgentEvent.findMany.mockResolvedValue([])
    prismaState.projectAgentEvent.count.mockResolvedValue(0)
    executeState.executeProjectAgentOperationFromTool.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        async: true,
        taskId: 'task-1',
        status: 'queued',
      },
    })
  })

  it('maps confirmation requirements to Agents SDK approval and preserves execution path', async () => {
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate images',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'ask',
      writer,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(true)

    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-agent-operation-start',
      data: {
        runId: 'run-1',
        operationId: 'generate_edit_script_storyboard_images',
        toolCallId: 'call-1',
      },
    })
    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      projectId: 'project-1',
      userId: 'user-1',
      toolCallId: 'call-1',
      assistantPermissionMode: 'ask',
      input: {
        episodeId: 'episode-1',
        confirmed: true,
      },
    }))
  })

  it('returns approval preflight failures as standard tool results without executing the operation', async () => {
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const operation = {
      ...buildOperation(),
      plan: vi.fn(async () => {
        throw new Error('CAPABILITY_VALUE_NOT_ALLOWED: duration value 3 is not allowed')
      }),
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation,
      description: 'Generate videos',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'ask',
      writer,
      approvalPreflightStore: createProjectAgentApprovalPreflightStore(),
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(false)

    const result = await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OPERATION_EXECUTION_FAILED',
        message: 'CAPABILITY_VALUE_NOT_ALLOWED: duration value 3 is not allowed',
      },
    })
    expect(operation.plan).toHaveBeenCalledTimes(1)
    expect(executeState.executeProjectAgentOperationFromTool).not.toHaveBeenCalled()
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-operation-start',
    }))
  })

  it('skips Agents SDK approval in auto mode while preserving the execution path', async () => {
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate images',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer: {
        write: vi.fn(),
        merge: vi.fn(),
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(false)

    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      projectId: 'project-1',
      userId: 'user-1',
      assistantPermissionMode: 'auto',
      toolCallId: 'call-1',
      input: {
        episodeId: 'episode-1',
      },
    }))
  })

  it('emits running activity for read-only query tools without an operation-start marker', async () => {
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation('get_project_context', 'query'),
      description: 'Get project context',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'get_project_context',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-agent-activity',
      data: expect.objectContaining({
        runId: 'run-1',
        type: 'operation',
        status: 'running',
        operationId: 'get_project_context',
        toolCallId: 'call-1',
      }),
    })
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-operation-start',
    }))
    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'get_project_context',
    }))
  })

  it('does not wrap choice interruptions in a separate operation activity', async () => {
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const operation = {
      ...buildOperation(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review, 'query'),
      effects: EFFECTS_NONE,
      confirmation: {
        kind: 'none' as const,
        required: false,
      },
      agentFlow: {
        interruptsFor: 'choice' as const,
      },
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation,
      description: 'Choose duration and aspect ratio',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-choice-1',
        name: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(eventState.appendProjectAgentEvents).not.toHaveBeenCalled()
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-activity',
    }))
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-operation-start',
    }))
    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenCalledWith(expect.objectContaining({
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
      toolCallId: 'call-choice-1',
      input: {
        episodeId: 'episode-1',
      },
    }))
  })

  it('fails long-running assistant operations that do not return an async task signal', async () => {
    executeState.executeProjectAgentOperationFromTool.mockResolvedValueOnce({
      ok: true,
      data: {
        success: true,
      },
    })
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate images',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer: {
        write: vi.fn(),
        merge: vi.fn(),
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    const result = await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OPERATION_OUTPUT_INVALID',
        message: 'PROJECT_AGENT_ASYNC_TASK_SIGNAL_MISSING',
        details: {
          expected: 'async_task_signal',
          reasonCode: 'PROJECT_AGENT_ASYNC_TASK_SIGNAL_MISSING',
        },
      },
    })
  })
})
