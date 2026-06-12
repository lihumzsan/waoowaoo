import { describe, expect, it, vi } from 'vitest'
import { RunContext } from '@openai/agents'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationTool } from '@/lib/project-agent/agents-tool-adapter'
import type { ProjectAgentOperationDefinition, RuntimeSchema } from '@/lib/operations/types'
import { createProjectAgentToolInputSchema } from '@/lib/operations/tool-input-schema'
import { EFFECTS_BILLABLE } from '../../helpers/project-agent-operations'

const executeState = vi.hoisted(() => ({
  executeProjectAgentOperationFromTool: vi.fn(async () => ({ ok: true, data: { success: true } })),
}))

vi.mock('@/lib/adapters/tools/execute-project-agent-operation', () => ({
  executeProjectAgentOperationFromTool: executeState.executeProjectAgentOperationFromTool,
}))

function buildOperation(): ProjectAgentOperationDefinition {
  const inputSchema = z.object({
    episodeId: z.string().min(1),
    confirmed: z.boolean().optional(),
  })
  return {
    id: 'generate_edit_script',
    summary: 'Generate edit script',
    intent: 'act',
    groupPath: ['edit-script'],
    channels: {
      tool: true,
      api: false,
    },
    prerequisites: {
      episodeId: 'required',
    },
    effects: EFFECTS_BILLABLE,
    confirmation: {
      required: true,
      summary: 'Confirm billable generation',
    },
    toolInputSchema: createProjectAgentToolInputSchema({
      operationId: 'generate_edit_script',
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
  it('maps confirmation requirements to Agents SDK approval and preserves execution path', async () => {
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate edit script',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
      },
      assistantPermissionMode: 'ask',
      writer: {
        write: vi.fn(),
        merge: vi.fn(),
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(true)

    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script',
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

  it('skips Agents SDK approval in auto mode while preserving the execution path', async () => {
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate edit script',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
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
        name: 'generate_edit_script',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script',
      projectId: 'project-1',
      userId: 'user-1',
      assistantPermissionMode: 'auto',
      toolCallId: 'call-1',
      input: {
        episodeId: 'episode-1',
      },
    }))
  })
})
