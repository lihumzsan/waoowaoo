import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const approvalRows = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}))

const prismaMock = vi.hoisted(() => ({
  assistantToolApproval: {
    create: vi.fn(async (params: { data: Record<string, unknown>; select: { id: boolean } }) => {
      approvalRows.current = {
        id: 'approval-1',
        status: 'pending',
        resultJson: null,
        resolvedAt: null,
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        updatedAt: new Date('2026-06-11T00:00:00.000Z'),
        ...params.data,
      }
      return { id: 'approval-1' }
    }),
    findFirst: vi.fn(async () => approvalRows.current),
    update: vi.fn(async (params: { data: Record<string, unknown> }) => {
      approvalRows.current = {
        ...(approvalRows.current ?? {}),
        ...params.data,
      }
      return approvalRows.current
    }),
    updateMany: vi.fn(async (params: { where: { status?: string }; data: Record<string, unknown> }) => {
      if (approvalRows.current?.status !== params.where.status) return { count: 0 }
      approvalRows.current = {
        ...approvalRows.current,
        ...params.data,
      }
      return { count: 1 }
    }),
  },
}))

const apiAdapterMock = vi.hoisted(() => ({
  executeProjectAgentOperationFromApi: vi.fn(async () => ({
    async: true,
    status: 'submitted',
    taskId: 'task-1',
  })),
}))

const waitMock = vi.hoisted(() => ({
  createProjectAgentWait: vi.fn(async () => 'wait-1'),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => apiAdapterMock)

vi.mock('@/lib/project-agent/waits', () => waitMock)

import {
  createAssistantToolApproval,
  normalizeAssistantToolApprovalRequest,
  resolveAssistantToolApproval,
} from '@/lib/project-agent/tool-approval'

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

describe('assistant tool approval', () => {
  beforeEach(() => {
    approvalRows.current = null
    vi.clearAllMocks()
  })

  it('creates a persisted approval without exposing operation args to the client', async () => {
    const approval = await createAssistantToolApproval({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      toolCallId: 'tool-call-1',
      operationId: 'generate_edit_script',
      operationInput: {
        editScriptId: 'script-1',
      },
      context: {
        locale: 'zh',
        episodeId: 'episode-1',
      },
    })

    expect(approval).toEqual({ approvalId: 'approval-1' })
    expect(prismaMock.assistantToolApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        operationId: 'generate_edit_script',
        operationInputJson: {
          editScriptId: 'script-1',
        },
        toolCallId: 'tool-call-1',
      }),
    }))
  })

  it('approves and executes the stored operation input with confirmed=true', async () => {
    await createAssistantToolApproval({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      toolCallId: 'tool-call-1',
      operationId: 'generate_edit_script',
      operationInput: {
        editScriptId: 'script-1',
        confirmed: false,
      },
      context: {
        locale: 'zh',
        episodeId: 'episode-1',
      },
    })

    const result = await resolveAssistantToolApproval({
      request: buildRequest(),
      projectId: 'project-1',
      userId: 'user-1',
      approvalId: 'approval-1',
      decision: 'approve',
    })

    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script',
      input: {
        editScriptId: 'script-1',
        confirmed: true,
      },
      context: {
        locale: 'zh',
        episodeId: 'episode-1',
      },
    }))
    expect(result.output).toEqual(expect.objectContaining({
      ok: true,
      operationId: 'generate_edit_script',
    }))
    expect(approvalRows.current?.status).toBe('consumed')
  })

  it('denies without executing the stored operation', async () => {
    await createAssistantToolApproval({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      toolCallId: 'tool-call-1',
      operationId: 'generate_edit_script',
      operationInput: {
        editScriptId: 'script-1',
      },
      context: {
        episodeId: 'episode-1',
      },
    })

    const result = await resolveAssistantToolApproval({
      request: buildRequest(),
      projectId: 'project-1',
      userId: 'user-1',
      approvalId: 'approval-1',
      decision: 'deny',
    })

    expect(apiAdapterMock.executeProjectAgentOperationFromApi).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({
      ok: false,
      operationId: 'generate_edit_script',
      error: {
        code: 'OPERATION_CANCELLED',
      },
    })
    expect(approvalRows.current?.status).toBe('denied')
  })

  it('returns the stored output for repeated resolution without executing twice', async () => {
    approvalRows.current = {
      id: 'approval-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      toolCallId: 'tool-call-1',
      operationId: 'generate_edit_script',
      operationInputJson: {
        editScriptId: 'script-1',
      },
      contextJson: {
        episodeId: 'episode-1',
      },
      status: 'consumed',
      expiresAt: new Date(Date.now() + 60_000),
      resultJson: {
        ok: true,
        operationId: 'generate_edit_script',
        data: {
          status: 'completed',
        },
      },
    }

    const result = await resolveAssistantToolApproval({
      request: buildRequest(),
      projectId: 'project-1',
      userId: 'user-1',
      approvalId: 'approval-1',
      decision: 'approve',
    })

    expect(apiAdapterMock.executeProjectAgentOperationFromApi).not.toHaveBeenCalled()
    expect(result.output).toEqual({
      ok: true,
      operationId: 'generate_edit_script',
      data: {
        status: 'completed',
      },
    })
  })

  it('normalizes only approvalId and decision for confirm-operation requests', () => {
    expect(normalizeAssistantToolApprovalRequest({
      approvalId: ' approval-1 ',
      decision: 'approve',
      operationId: 'ignored',
      input: { should: 'not matter' },
    })).toEqual({
      approvalId: 'approval-1',
      decision: 'approve',
    })
  })
})
