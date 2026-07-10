import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NextRequest } from 'next/server'

import { buildMockRequest } from '../../../helpers/request'

import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'

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

const editScriptServiceMock = vi.hoisted(() => ({
  approveProjectEpisodeEditScriptAssets: vi.fn(async (): Promise<unknown> => ({
    approvedCount: 3,
    scripts: [],
  })),
}))

const editBibleMock = vi.hoisted(() => ({
  confirmEpisodeEditBible: vi.fn(async (): Promise<unknown> => ({
    id: 'bible-1',
    status: 'confirmed',
  })),
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(async (): Promise<{ videoRatio: string }> => ({ videoRatio: '16:9' })),
    update: vi.fn(async (): Promise<{ id: string }> => ({ id: 'project-1' })),
    updateMany: vi.fn(async (): Promise<{ count: number }> => ({ count: 1 })),
  },
  projectEditBible: {
    updateMany: vi.fn(async (): Promise<{ count: number }> => ({ count: 1 })),
  },
  $transaction: vi.fn(async (operations: readonly Promise<unknown>[]): Promise<unknown[]> => await Promise.all(operations)),
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
  getPendingProjectAgentApprovalInterruption: vi.fn(async (): Promise<unknown> => null),
  declinePendingProjectAgentInterruptionsForUserTurn: vi.fn(async (): Promise<unknown[]> => []),
  reopenProjectAgentInterruption: vi.fn(async (): Promise<void> => undefined),
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
    heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
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
    heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
  })),
  ensureProjectAgentRunSlotAvailable: vi.fn(async (): Promise<void> => undefined),
  listBlockingProjectAgentRunsForThreadClear: vi.fn(async (): Promise<unknown[]> => []),
  safelyUpdateProjectAgentRunStatus: vi.fn(async (): Promise<void> => undefined),
  updateProjectAgentRunStatus: vi.fn(async (): Promise<void> => undefined),
  supersedePendingRunsInScope: vi.fn(async (): Promise<string[]> => []),
}))

const runLockMock = vi.hoisted(() => ({
  acquireProjectAgentRunLock: vi.fn(async (input: { runId: string }): Promise<unknown> => ({ key: 'lock-key', token: 'lock-token', runId: input.runId })),
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
  appendProjectAssistantThreadMessages: vi.fn(async (input: { messages: unknown[] }): Promise<unknown> => ({
    id: 'thread-1',
    assistantId: 'workspace-command',
    projectId: 'project-1',
    episodeId: 'episode-1',
    scopeRef: 'episode:episode-1',
    messages: input.messages,
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

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async (): Promise<void> => undefined),
  getCurrentProjectAgentActivity: vi.fn(async (): Promise<unknown> => ({
    activityId: 'activity-choice-1',
    runId: 'run-1',
    type: 'awaiting_choice',
    status: 'waiting',
    operationId: 'request_edit_bible_review_choice',
    sourceOperationId: null,
    toolCallId: 'tool-choice-1',
    choiceType: 'bible_review',
  })),
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

function buildTextAttachment(): ProjectAssistantTextAttachment {
  const normalizedText = '第一幕\n对白'

  return {
    id: 'attachment-1',
    kind: 'txt',
    fileName: 'story.txt',
    mimeType: 'text/plain',
    sizeBytes: 128,
    checksum: 'a'.repeat(64),
    charCount: normalizedText.length,
    normalizedText,
  }
}

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

vi.mock('@/lib/edit-script/service', () => editScriptServiceMock)

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('@/lib/edit-bible', async () => {
  const actual = await vi.importActual<typeof import('@/lib/edit-bible')>('@/lib/edit-bible')
  return {
    ...actual,
    confirmEpisodeEditBible: editBibleMock.confirmEpisodeEditBible,
  }
})

vi.mock('@/lib/project-agent/persistence', () => persistenceMock)

vi.mock('@/lib/project-agent/waits', () => waitMock)

vi.mock('@/lib/project-agent/interruptions', () => interruptionMock)

vi.mock('@/lib/project-agent/runs', () => runMock)

vi.mock('@/lib/project-agent/run-lock', () => runLockMock)

vi.mock('@/lib/project-agent/thread-log', () => threadLogMock)

vi.mock('@/lib/project-agent/event', () => eventMock)

vi.mock('@/lib/project-agent/run-budget', () => ({
  buildProjectAgentOperationTargetKey: vi.fn(({ operationId }: { operationId: string }) => `${operationId}:test-target`),
  enforceProjectAgentOperationRunBudget: vi.fn(async () => null),
  isProjectAgentRunWakeupBudgetAvailable: vi.fn(async () => true),
  PROJECT_AGENT_RUN_WAKEUP_LIMIT: 10,
}))

vi.mock('@/lib/config-service', () => modelConfigMock)

vi.mock('@/lib/project-agent/model', () => modelResolverMock)

vi.mock('@/lib/project-agent/message-compression', () => messageCompressionMock)

import {
  DELETE as chatDelete,
  GET as chatGet,
  POST as chatPost,
} from '@/app/api/projects/[projectId]/assistant/chat/route'

import { GET as chatLogGet } from '@/app/api/projects/[projectId]/assistant/chat/log/route'

import {
  GET as waitsGet,
  POST as waitsPost,
} from '@/app/api/projects/[projectId]/assistant/waits/route'

import { POST as approvalPost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/approval/route'

import { POST as choicePost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/choice/route'

import { GET as runGet } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/route'

import { POST as taskFollowUpPost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/task-follow-up/route'

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { NextRequest } from 'next/server'
export { buildMockRequest } from '../../../helpers/request'
export { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
export { PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY } from '@/lib/project-agent/text-attachments'
export type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
export { DELETE as chatDelete, GET as chatGet, POST as chatPost } from '@/app/api/projects/[projectId]/assistant/chat/route'
export { GET as chatLogGet } from '@/app/api/projects/[projectId]/assistant/chat/log/route'
export { GET as waitsGet, POST as waitsPost } from '@/app/api/projects/[projectId]/assistant/waits/route'
export { POST as approvalPost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/approval/route'
export { POST as choicePost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/choice/route'
export { GET as runGet } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/route'
export { POST as taskFollowUpPost } from '@/app/api/projects/[projectId]/assistant/runs/[runId]/task-follow-up/route'
export { apiAdapterMock, authState, buildTextAttachment, compressionState, editBibleMock, editScriptServiceMock, eventMock, interruptionMock, messageCompressionMock, modelConfigMock, modelResolverMock, persistenceMock, prismaMock, projectAgentMock, runLockMock, runMock, threadLogMock, waitMock }
