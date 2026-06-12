import { describe, expect, it, vi } from 'vitest'
import { RunContext } from '@openai/agents'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationTool } from '@/lib/project-agent/agents-tool-adapter'
import type { ProjectAgentOperationDefinition } from '@/lib/operations/types'
import { EFFECTS_BILLABLE } from '../../helpers/project-agent-operations'

const executeState = vi.hoisted(() => ({
  executeProjectAgentOperationFromTool: vi.fn(async () => ({ ok: true, data: { success: true } })),
}))

vi.mock('@/lib/adapters/tools/execute-project-agent-operation', () => ({
  executeProjectAgentOperationFromTool: executeState.executeProjectAgentOperationFromTool,
}))

function buildOperation(): ProjectAgentOperationDefinition {
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
    inputSchema: z.object({
      episodeId: z.string().min(1),
      confirmed: z.boolean().optional(),
    }),
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
      input: {
        episodeId: 'episode-1',
        confirmed: true,
      },
    }))
  })
})
