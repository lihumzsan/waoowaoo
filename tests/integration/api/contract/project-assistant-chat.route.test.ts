import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const projectAgentMock = vi.hoisted(() => ({
  createProjectAgentChatResponse: vi.fn(async () => new Response('ok', { status: 200 })),
}))

const apiAdapterMock = vi.hoisted(() => ({
  executeProjectAgentOperationFromApi: vi.fn(async (): Promise<unknown> => ({
    status: 'submitted',
    taskId: 'task-1',
  })),
}))

const waitMock = vi.hoisted(() => ({
  createProjectAgentWait: vi.fn(async (): Promise<string> => 'wait-1'),
  listResolvedProjectAgentWaitFollowUps: vi.fn(async (): Promise<unknown[]> => []),
  claimResolvedProjectAgentWaitFollowUps: vi.fn(async (): Promise<unknown[]> => []),
  consumeProjectAgentWaitFollowUp: vi.fn(async (): Promise<unknown> => null),
}))

const interruptionMock = vi.hoisted(() => ({
  consumeProjectAgentApprovalInterruption: vi.fn(async (): Promise<unknown> => null),
  consumeProjectAgentChoiceInterruption: vi.fn(async (): Promise<unknown> => null),
  supersedePendingProjectAgentInterruptions: vi.fn(async (): Promise<unknown[]> => []),
}))

const runMock = vi.hoisted(() => ({
  createProjectAgentRun: vi.fn(async (): Promise<unknown> => ({
    id: 'run-1',
    projectId: 'project-1',
    userId: 'user-1',
    assistantId: 'workspace-command',
    scopeRef: 'episode:episode-1',
    episodeId: 'episode-1',
    requestId: 'request-1',
    status: 'running',
    controlKind: 'user_turn',
  })),
  getProjectAgentRun: vi.fn(async (): Promise<unknown> => ({
    id: 'run-1',
    projectId: 'project-1',
    userId: 'user-1',
    assistantId: 'workspace-command',
    scopeRef: 'episode:episode-1',
    episodeId: 'episode-1',
    requestId: 'request-1',
    status: 'running',
    controlKind: 'approval_response',
  })),
  safelyUpdateProjectAgentRunStatus: vi.fn(async (): Promise<void> => undefined),
  supersedePendingRunsInScope: vi.fn(async (): Promise<string[]> => []),
}))

const runLockMock = vi.hoisted(() => ({
  acquireProjectAgentRunLock: vi.fn(async (): Promise<unknown> => ({ key: 'lock-key', token: 'lock-token' })),
  safelyReleaseProjectAgentRunLock: vi.fn(async (): Promise<void> => undefined),
}))

const compressionState = vi.hoisted(() => ({
  shouldCompress: false,
  compressedMessages: [
    {
      id: 'summary-1',
      role: 'system',
      parts: [{ type: 'text', text: 'summary' }],
      metadata: { custom: { projectAgentConversationSummary: true } },
    },
  ] as Array<Record<string, unknown>>,
}))

const persistenceMock = vi.hoisted(() => ({
  buildProjectAssistantScopeRef: vi.fn((input: { projectId: string; episodeId?: string | null }) => (
    input.episodeId ? `episode:${input.episodeId}` : `project:${input.projectId}`
  )),
  loadProjectAssistantThread: vi.fn(async (): Promise<unknown> => null),
  saveProjectAssistantThread: vi.fn(async (): Promise<unknown> => ({
    id: 'thread-1',
    assistantId: 'workspace-command',
    projectId: 'project-1',
    episodeId: 'episode-1',
    scopeRef: 'episode:episode-1',
    messages: [],
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
  })),
  clearProjectAssistantThread: vi.fn(async (): Promise<void> => undefined),
}))

const threadLogMock = vi.hoisted(() => ({
  writeWorkspaceAssistantThreadLog: vi.fn(async () => '/tmp/workspace-assistant.log'),
  serializeWorkspaceAssistantThreadLog: vi.fn(() => '# Workspace Assistant Thread Log'),
  buildWorkspaceAssistantThreadLogFileName: vi.fn(() => 'workspace-assistant__project-1__episode_episode-1__thread-1.log'),
}))

const modelConfigMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'llm::project-analysis',
  })),
}))

const modelResolverMock = vi.hoisted(() => ({
  resolveProjectAgentLanguageModel: vi.fn(async () => ({
    languageModel: {} as never,
  })),
}))

const messageCompressionMock = vi.hoisted(() => ({
  shouldCompressMessages: vi.fn(() => compressionState.shouldCompress),
  compressMessages: vi.fn(async () => compressionState.compressedMessages),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
  }
})

vi.mock('@/lib/project-agent', () => projectAgentMock)
vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => apiAdapterMock)
vi.mock('@/lib/project-agent/persistence', () => persistenceMock)
vi.mock('@/lib/project-agent/waits', () => waitMock)
vi.mock('@/lib/project-agent/interruptions', () => interruptionMock)
vi.mock('@/lib/project-agent/runs', () => runMock)
vi.mock('@/lib/project-agent/run-lock', () => runLockMock)
vi.mock('@/lib/project-agent/thread-log', () => threadLogMock)
vi.mock('@/lib/config-service', () => modelConfigMock)
vi.mock('@/lib/project-agent/model', () => modelResolverMock)
vi.mock('@/lib/project-agent/message-compression', () => messageCompressionMock)

import {
  DELETE as chatDelete,
  GET as chatGet,
  POST as chatPost,
  PUT as chatPut,
} from '@/app/api/projects/[projectId]/assistant/chat/route'
import { GET as chatLogGet } from '@/app/api/projects/[projectId]/assistant/chat/log/route'
import {
  GET as waitsGet,
  POST as waitsPost,
} from '@/app/api/projects/[projectId]/assistant/waits/route'
import { POST as approvalPost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/approval/route'
import { POST as choicePost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/choice/route'
import { POST as taskFollowUpPost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/task-follow-up/route'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> forwards request to project agent runtime', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [
            {
              id: 'u1',
              role: 'user',
              parts: [{ type: 'text', text: '运行故事到剧本' }],
            },
          ],
          context: {
            episodeId: 'episode-1',
            selectedScopeRef: 'panel:panel-1',
            selectedPanelId: 'panel-1',
            selectedClipId: 'clip-1',
            selectedAssetId: 'asset-1',
          },
          assistantPermissionMode: 'ask',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledTimes(1)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        selectedScopeRef: 'panel:panel-1',
        selectedPanelId: 'panel-1',
        selectedClipId: 'clip-1',
        selectedAssetId: 'asset-1',
      },
      assistantPermissionMode: 'ask',
    }))
    expect(runLockMock.acquireProjectAgentRunLock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      runLock: { key: 'lock-key', token: 'lock-token' },
      control: { kind: 'user_turn', supersededInterruptions: [] },
    }))
    expect(interruptionMock.supersedePendingProjectAgentInterruptions).toHaveBeenCalledTimes(1)
  })

  it('POST /api/projects/[projectId]/assistant/chat -> consumes a pending approval interruption via structured control', async () => {
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'generate_edit_screenplay',
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      runState: 'serialized-state',
    })

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Tool approval accepted.' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-1',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(interruptionMock.consumeProjectAgentApprovalInterruption).toHaveBeenCalledWith(expect.objectContaining({
      interruptionId: 'interruption-1',
      runId: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      response: { approved: true, reason: null },
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'approval',
        approved: true,
        interruption: expect.objectContaining({ id: 'interruption-1', runState: 'serialized-state' }),
      }),
    }))
    // approval resume must not touch supersede or history inference
    expect(interruptionMock.supersedePendingProjectAgentInterruptions).not.toHaveBeenCalled()
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/approval -> consumes approval through the run-scoped endpoint', async () => {
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'generate_edit_screenplay',
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      runState: 'serialized-state',
    })

    const response = await approvalPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/approval',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'approve' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          interruptionId: 'interruption-1',
          approved: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(interruptionMock.consumeProjectAgentApprovalInterruption).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      interruptionId: 'interruption-1',
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'approval',
        approved: true,
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects public control payloads outside run-scoped endpoints', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'approve' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-1',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_CONTROL_ENDPOINT_REQUIRED' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects a stale approval response with a conflict', async () => {
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce(null)

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Tool approval accepted.' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-stale',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_INTERRUPTION_NOT_PENDING' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> resolves a choice response into an in-band continuation', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'choice_response',
            runId: 'run-1',
            interruptionId: null,
            choiceType: 'style',
            toolCallId: null,
            output: {
              ok: true,
              stylePreviewId: 'style-1',
              aspectRatio: '9:16',
            },
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'choice',
        choiceType: 'style',
        continuation: expect.objectContaining({
          operationId: 'generate_edit_director_decoupage',
        }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/choice -> consumes choice through the run-scoped endpoint', async () => {
    interruptionMock.consumeProjectAgentChoiceInterruption.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-1',
      type: 'choice',
      status: 'consumed',
      operationId: 'request_edit_first_choice',
      toolCallId: 'tool-choice-1',
      payload: { choiceType: 'duration_and_aspect_ratio' },
    })

    const response = await choicePost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/choice',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '鬼故事' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          interruptionId: 'choice-interruption-1',
          choiceType: 'duration_and_aspect_ratio',
          toolCallId: 'tool-choice-1',
          output: {
            ok: true,
            durationSeconds: 60,
            aspectRatio: '16:9',
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(interruptionMock.consumeProjectAgentChoiceInterruption).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      interruptionId: 'choice-interruption-1',
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'choice',
        choiceType: 'duration_and_aspect_ratio',
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> consumes a claimed wait follow-up exactly once', async () => {
    waitMock.consumeProjectAgentWaitFollowUp.mockResolvedValueOnce({
      runId: 'run-1',
      waitId: 'wait-1',
      followUpKey: 'project-agent-wait:wait-1:completed',
      operationId: 'generate_edit_script',
      taskIds: ['task-1'],
      failedTaskIds: [],
      terminalStatus: 'completed',
      total: 1,
      successCount: 1,
      failedCount: 0,
      claimId: 'claim-1',
    })

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'task_follow_up',
            runId: 'run-1',
            waitId: 'wait-1',
            claimId: 'claim-1',
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.consumeProjectAgentWaitFollowUp).toHaveBeenCalledWith({
      runId: 'run-1',
      waitId: 'wait-1',
      claimId: 'claim-1',
      projectId: 'project-1',
      userId: 'user-1',
    })
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'task_follow_up',
        followUp: expect.objectContaining({ waitId: 'wait-1' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/task-follow-up -> consumes wait follow-up through the run-scoped endpoint', async () => {
    waitMock.consumeProjectAgentWaitFollowUp.mockResolvedValueOnce({
      runId: 'run-1',
      waitId: 'wait-1',
      followUpKey: 'project-agent-wait:wait-1:completed',
      operationId: 'generate_edit_script',
      taskIds: ['task-1'],
      failedTaskIds: [],
      terminalStatus: 'completed',
      total: 1,
      successCount: 1,
      failedCount: 0,
      claimId: 'claim-1',
    })

    const response = await taskFollowUpPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/task-follow-up',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          waitId: 'wait-1',
          claimId: 'claim-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.consumeProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      waitId: 'wait-1',
      claimId: 'claim-1',
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'task_follow_up',
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects an unclaimed task follow-up with a conflict', async () => {
    waitMock.consumeProjectAgentWaitFollowUp.mockResolvedValueOnce(null)

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'task_follow_up',
            runId: 'run-1',
            waitId: 'wait-1',
            claimId: 'claim-expired',
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects malformed control payloads', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: { type: 'unknown_action' },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_CONTROL_INVALID' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects concurrent runs in the same assistant scope', async () => {
    runLockMock.acquireProjectAgentRunLock.mockResolvedValueOnce(null)

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [
            {
              id: 'u1',
              role: 'user',
              parts: [{ type: 'text', text: '继续' }],
            },
          ],
          context: {
            episodeId: 'episode-1',
          },
          assistantPermissionMode: 'auto',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'CONFLICT',
        details: expect.objectContaining({
          code: 'PROJECT_AGENT_RUN_ACTIVE',
        }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> forwards compressed messages when long conversation threshold is hit', async () => {
    compressionState.shouldCompress = true
    compressionState.compressedMessages = [
      {
        id: 'summary-1',
        role: 'system',
        parts: [{ type: 'text', text: 'summary' }],
        metadata: { custom: { projectAgentConversationSummary: true } },
      },
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'latest' }],
      },
    ]

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: Array.from({ length: 60 }, (_value, index) => ({
            id: `m${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            parts: [{ type: 'text', text: `message-${index}` }],
          })),
          context: {
            locale: 'en',
          },
          assistantPermissionMode: 'auto',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(modelConfigMock.getProjectModelConfig).toHaveBeenCalledWith('project-1', 'user-1')
    expect(modelResolverMock.resolveProjectAgentLanguageModel).toHaveBeenCalledWith({
      userId: 'user-1',
      analysisModelKey: 'llm::project-analysis',
    })
    expect(messageCompressionMock.compressMessages).toHaveBeenCalledTimes(1)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: compressionState.compressedMessages,
      assistantPermissionMode: 'auto',
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects unauthenticated requests', async () => {
    authState.authenticated = false
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(401)
  })

  it('POST /api/projects/[projectId]/assistant/chat -> validates JSON body', async () => {
    const request = new NextRequest(new URL('http://localhost:3000/api/projects/project-1/assistant/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await chatPost(
      request,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'INVALID_PARAMS',
        details: expect.objectContaining({ code: 'BODY_PARSE_FAILED' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects missing assistant permission mode', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'INVALID_PARAMS',
        details: expect.objectContaining({ code: 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_REQUIRED' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects invalid assistant permission mode', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
          assistantPermissionMode: 'fast',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'INVALID_PARAMS',
        details: expect.objectContaining({ code: 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_INVALID' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> maps runtime errors into API error payloads', async () => {
    projectAgentMock.createProjectAgentChatResponse.mockRejectedValueOnce(new Error('PROJECT_AGENT_MODEL_NOT_CONFIGURED'))

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
          assistantPermissionMode: 'ask',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'MISSING_CONFIG',
        details: expect.objectContaining({ code: 'PROJECT_AGENT_MODEL_NOT_CONFIGURED' }),
      }),
    }))
  })

  it('GET /api/projects/[projectId]/assistant/waits -> returns resolved follow-ups for the assistant scope', async () => {
    waitMock.listResolvedProjectAgentWaitFollowUps.mockResolvedValueOnce([{
      waitId: 'wait-1',
      followUpKey: 'project-agent-wait:wait-1:completed',
      operationId: 'generate_edit_script',
      taskIds: ['task-1'],
      failedTaskIds: [],
      terminalStatus: 'completed',
      total: 1,
      successCount: 1,
      failedCount: 0,
      claimId: '',
    }])

    const response = await waitsGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/waits?episodeId=episode-1',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.listResolvedProjectAgentWaitFollowUps).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      followUps: [{
        waitId: 'wait-1',
        followUpKey: 'project-agent-wait:wait-1:completed',
        operationId: 'generate_edit_script',
        taskIds: ['task-1'],
        failedTaskIds: [],
        terminalStatus: 'completed',
        total: 1,
        successCount: 1,
        failedCount: 0,
        claimId: '',
      }],
    })
  })

  it('POST /api/projects/[projectId]/assistant/waits -> atomically claims one follow-up before client wake-up', async () => {
    waitMock.claimResolvedProjectAgentWaitFollowUps.mockResolvedValueOnce([{
      waitId: 'wait-1',
      followUpKey: 'project-agent-wait:wait-1:failed',
      operationId: 'generate_edit_script',
      taskIds: ['task-1', 'task-2'],
      failedTaskIds: ['task-2'],
      terminalStatus: 'failed',
      total: 2,
      successCount: 1,
      failedCount: 1,
      claimId: 'claim-1',
    }])

    const response = await waitsPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/waits',
        method: 'POST',
        body: {
          action: 'claim',
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.claimResolvedProjectAgentWaitFollowUps).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      limit: 1,
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      followUps: [{
        waitId: 'wait-1',
        followUpKey: 'project-agent-wait:wait-1:failed',
        operationId: 'generate_edit_script',
        taskIds: ['task-1', 'task-2'],
        failedTaskIds: ['task-2'],
        terminalStatus: 'failed',
        total: 2,
        successCount: 1,
        failedCount: 1,
        claimId: 'claim-1',
      }],
    })
  })

  it('POST /api/projects/[projectId]/assistant/waits -> rejects legacy manual follow-up marking', async () => {
    const response = await waitsPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/waits',
        method: 'POST',
        body: { waitId: 'wait-1', claimId: 'claim-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'INVALID_WAIT_FOLLOW_UP_ACTION' }),
      }),
    }))
  })

  it('GET /api/projects/[projectId]/assistant/chat -> loads persisted workspace thread from database service', async () => {
    persistenceMock.loadProjectAssistantThread.mockResolvedValueOnce({
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'persisted' }],
        },
      ],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    })

    const response = await chatGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'GET',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.loadProjectAssistantThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    await expect(response.json()).resolves.toEqual({
      thread: expect.objectContaining({
        id: 'thread-1',
        scopeRef: 'episode:episode-1',
      }),
    })
  })

  it('GET /api/projects/[projectId]/assistant/chat -> rejects unauthenticated requests', async () => {
    authState.authenticated = false
    const response = await chatGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(401)
  })

  it('PUT /api/projects/[projectId]/assistant/chat -> saves workspace thread to database service', async () => {
    const response = await chatPut(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'PUT',
        body: {
          episodeId: 'episode-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              parts: [{ type: 'text', text: '现在到什么进度了' }],
            },
          ],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.saveProjectAssistantThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '现在到什么进度了' }],
        },
      ],
    })
    expect(threadLogMock.writeWorkspaceAssistantThreadLog).toHaveBeenCalledTimes(1)
  })

  it('PUT /api/projects/[projectId]/assistant/chat -> accepts agent plan data parts for persistence', async () => {
    const planPart = {
      type: 'data-plan',
      data: {
        draftPlanId: 'draft_plan_1',
        goal: '希区柯克风格恐怖短片',
        summary: '创作计划',
        requiresApproval: true,
        validation: {
          ok: true,
          issues: [],
        },
        steps: [
          {
            stepKey: 'context',
            skillId: 'creative-direction',
            operationId: 'get_project_context',
            reason: '先读取项目上下文',
            inputArtifacts: [],
            outputArtifacts: ['creative.brief'],
            dependsOn: [],
            requiresApproval: false,
          },
        ],
      },
    }

    const response = await chatPut(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'PUT',
        body: {
          episodeId: 'episode-1',
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              parts: [planPart],
            },
          ],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.saveProjectAssistantThread).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [planPart],
        },
      ],
    }))
  })

  it('PUT /api/projects/[projectId]/assistant/chat -> persists compressed thread when long conversation threshold is hit', async () => {
    compressionState.shouldCompress = true
    compressionState.compressedMessages = [
      {
        id: 'summary-1',
        role: 'system',
        parts: [{ type: 'text', text: 'summary' }],
        metadata: { custom: { projectAgentConversationSummary: true } },
      },
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'latest' }],
      },
    ]

    const response = await chatPut(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'PUT',
        body: {
          locale: 'en',
          messages: Array.from({ length: 60 }, (_value, index) => ({
            id: `m${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            parts: [{ type: 'text', text: `message-${index}` }],
          })),
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.saveProjectAssistantThread).toHaveBeenCalledWith(expect.objectContaining({
      messages: compressionState.compressedMessages,
    }))
  })

  it('DELETE /api/projects/[projectId]/assistant/chat -> clears workspace thread from database service', async () => {
    const response = await chatDelete(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'DELETE',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.clearProjectAssistantThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
  })

  it('GET /api/projects/[projectId]/assistant/chat/log -> downloads current workspace thread log', async () => {
    persistenceMock.loadProjectAssistantThread.mockResolvedValueOnce({
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'persisted' }],
        },
      ],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    })

    const response = await chatLogGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat/log',
        method: 'GET',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(threadLogMock.serializeWorkspaceAssistantThreadLog).toHaveBeenCalledTimes(1)
    expect(response.headers.get('content-disposition')).toContain('workspace-assistant__project-1__episode_episode-1__thread-1.log')
  })
})
