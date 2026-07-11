import { beforeEach, describe, expect, it, vi } from 'vitest'

import { z } from 'zod'

import type { NextRequest } from 'next/server'

import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'

import {
  EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  type EditFirstWorkflowOperationId,
  type EditFirstWorkflowState,
} from '@/lib/project-workflow/edit-first'

import type { ProjectAgentRunRecord } from '@/lib/project-agent/runs'

import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
} from '@/lib/project-agent/edit-first-choice-tools'

import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

const TEST_BILLABLE_EDIT_FIRST_OPERATION_IDS = new Set<string>([
  'generate_edit_style_previews',
  'generate_edit_script_assets',
  'revise_edit_script_assets',
  'generate_edit_script_storyboard_images',
  'generate_episode_videos',
  'generate_episode_bgm_score',
  'generate_episode_soundscape',
])

const streamState = vi.hoisted(() => ({
  capturedToolNames: [] as string[],
  capturedEnabledToolNames: [] as string[],
  capturedEnabledToolNamesAfterExecution: [] as string[],
  capturedTools: {} as Record<string, { needsApproval?: unknown }>,
  capturedSystem: '',
  capturedModelSettings: {} as Record<string, unknown>,
  capturedRunInput: null as unknown,
  capturedResponseStream: null as ReadableStream<unknown> | null,
  streamError: null as Error | null,
  keepOpen: false,
  startMessageId: null as string | null,
  simulateSecondTurnAfterFirstWorkflowTool: false,
  executedToolNames: [] as string[],
  heartbeatStartedDuringRunBootstrap: false,
}))

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))

const runState = vi.hoisted(() => ({
  safelyUpdateProjectAgentRunStatus: vi.fn(async (_input?: unknown) => undefined),
  settleProjectAgentRunFailureWithMessage: vi.fn(async (input: {
    runFence: { runId: string }
    status: string
    stopReason: string
    errorCode?: string
    errorMessage?: string
  }) => {
    await runState.safelyUpdateProjectAgentRunStatus(input)
  }),
  cancelRunningProjectAgentRun: vi.fn(async () => true),
  settleProjectAgentRunWithMessage: vi.fn(async (input: {
    runFence: { runId: string }
    status: string
    stopReason: string
    errorCode?: string
    errorMessage?: string
    message: unknown
  }) => {
    await persistenceState.appendProjectAssistantThreadMessages({ messages: [input.message] })
    await runState.safelyUpdateProjectAgentRunStatus({
      runFence: input.runFence,
      status: input.status,
      stopReason: input.stopReason,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    })
  }),
}))

const runHeartbeatState = vi.hoisted(() => ({
  stop: vi.fn(async () => undefined),
  ownershipLossOnStart: null as Error | null,
  startProjectAgentRunHeartbeat: vi.fn((input: { onOwnershipLost: (error: Error) => void }) => {
    if (runHeartbeatState.ownershipLossOnStart) {
      input.onOwnershipLost(runHeartbeatState.ownershipLossOnStart)
    }
    return {
      stop: runHeartbeatState.stop,
    }
  }),
}))

const persistenceState = vi.hoisted(() => ({
  appendProjectAssistantThreadMessages: vi.fn(async (_input?: unknown) => undefined),
}))

const runLockState = vi.hoisted(() => ({
  safelyReleaseProjectAgentRunLock: vi.fn(async () => undefined),
}))

const eventState = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async (params: { events: Array<{ event: { kind: string; runId?: string; activityId?: string; operationId?: string | null; sourceOperationId?: string | null; toolCallId?: string | null; choiceType?: string | null } }> }) => {
    const event = params.events.map((item) => item.event).find((item) => item.activityId)
    if (!event?.activityId || !event.runId) return null
    return {
      activityId: event.activityId,
      runId: event.runId,
      type: event.kind === 'activity.started' ? 'operation' : 'operation',
      status: event.kind === 'activity.failed' ? 'failed' : event.kind === 'activity.completed' ? 'completed' : 'running',
      operationId: event.operationId ?? null,
      sourceOperationId: event.sourceOperationId ?? null,
      toolCallId: event.toolCallId ?? null,
      choiceType: event.choiceType ?? null,
    }
  }),
}))

const phaseState = vi.hoisted(() => ({
  editFirstWorkflow: {
    active: false,
    stage: 'not_started',
    blocking: {
      kind: 'none',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  } as EditFirstWorkflowState,
}))

const workflowRefreshState = vi.hoisted(() => ({
  resolveEditFirstWorkflowState: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  type CreateUIMessageStreamResponseInput = {
    stream: ReadableStream<unknown>
  }
  return {
    ...actual,
    safeValidateUIMessages: vi.fn(async ({ messages }) => ({ success: true, data: messages })),
    createUIMessageStreamResponse: vi.fn((input: CreateUIMessageStreamResponseInput) => {
      streamState.capturedResponseStream = input.stream
      return new Response('ok', { status: 200 })
    }),
  }
})

vi.mock('@openai/agents-extensions/ai-sdk', () => ({
  aisdk: vi.fn((model) => model),
}))

vi.mock('@openai/agents-extensions/ai-sdk-ui', () => ({
  createAiSdkUiMessageStream: vi.fn(() => new ReadableStream<unknown>({
    start(controller) {
      if (streamState.streamError) {
        controller.error(streamState.streamError)
        return
      }
      if (streamState.startMessageId) {
        controller.enqueue({ type: 'start', messageId: streamState.startMessageId })
      }
      controller.enqueue({ type: 'finish' })
      if (!streamState.keepOpen) {
        controller.close()
      }
    },
  })),
}))

vi.mock('@openai/agents', () => {
  type MockTool = {
    name: string
    needsApproval?: unknown
    isEnabled?: boolean | (() => boolean | Promise<boolean>)
    execute?: (input: unknown, runContext: unknown, details: unknown) => unknown | Promise<unknown>
  }
  type MockToolResult = {
    type: 'function_output'
    tool: {
      name: string
    }
    output: unknown
  }

  class Agent {
    name: string
    instructions: string
    modelSettings: Record<string, unknown>
    tools: MockTool[]
    toolUseBehavior?: (runContext: unknown, toolResults: MockToolResult[]) => unknown

    constructor(config: {
      name: string
      instructions: string
      modelSettings?: Record<string, unknown>
      tools: MockTool[]
      toolUseBehavior?: (runContext: unknown, toolResults: MockToolResult[]) => unknown
    }) {
      this.name = config.name
      this.instructions = config.instructions
      this.modelSettings = config.modelSettings ?? {}
      this.tools = config.tools
      this.toolUseBehavior = config.toolUseBehavior
    }
  }

  class RunContext {
    context: unknown

    constructor(context: unknown) {
      this.context = context
    }
  }

  class RunState {
    approved = false
    rejected = false

    static async fromStringWithContext() {
      return new RunState()
    }

    getInterruptions() {
      return [{
        name: 'generate_edit_style_previews',
        rawItem: {
          id: 'approval-1',
          callId: 'tool-generate-bible-1',
        },
      }]
    }

    approve() {
      this.approved = true
    }

    reject() {
      this.rejected = true
    }
  }

  async function collectEnabledToolNames(tools: MockTool[]): Promise<string[]> {
    // Mirrors the Agents SDK getAllTools() behavior: tools with an isEnabled
    // predicate are filtered per model turn before being exposed to the model.
    const enabledToolNames: string[] = []
    for (const tool of tools) {
      const isEnabled = tool.isEnabled
      const enabled = typeof isEnabled === 'function'
        ? await isEnabled()
        : isEnabled !== false
      if (enabled) enabledToolNames.push(tool.name)
    }
    return enabledToolNames
  }

  const run = vi.fn(async (agent: Agent, runInput: unknown) => {
    streamState.heartbeatStartedDuringRunBootstrap = runHeartbeatState.startProjectAgentRunHeartbeat.mock.calls.length > 0
    streamState.capturedToolNames = agent.tools.map((tool) => tool.name)
    streamState.capturedEnabledToolNames = await collectEnabledToolNames(agent.tools)
    if (streamState.simulateSecondTurnAfterFirstWorkflowTool) {
      const executableWorkflowToolNames = new Set([
        'ingest_script',
        'plan_chapters',
        'replan_chapter',
        'confirm_bible',
      ])
      const executable = agent.tools.find((tool) => (
        streamState.capturedEnabledToolNames.includes(tool.name)
        && typeof tool.execute === 'function'
        && (tool.name.startsWith('generate_edit_') || executableWorkflowToolNames.has(tool.name))
      ))
      if (!executable?.execute) {
        throw new Error('TEST_EXECUTABLE_WORKFLOW_TOOL_NOT_FOUND')
      }
      streamState.executedToolNames.push(executable.name)
      const output = await executable.execute({}, {}, {
        toolCall: {
          callId: `tool-${executable.name}-1`,
        },
      })
      agent.toolUseBehavior?.({}, [{
        type: 'function_output',
        tool: {
          name: executable.name,
        },
        output,
      }])
      streamState.capturedEnabledToolNamesAfterExecution = await collectEnabledToolNames(agent.tools)
    }
    streamState.capturedTools = Object.fromEntries(agent.tools.map((tool) => [tool.name, tool]))
    streamState.capturedSystem = agent.instructions
    streamState.capturedModelSettings = agent.modelSettings
    streamState.capturedRunInput = runInput
    const state = runInput instanceof RunState
      ? runInput
      : {
          getInterruptions: () => [],
          toString: () => '',
        }
    return {
      completed: Promise.resolve(),
      interruptions: [],
      state,
    }
  })

  const tool = vi.fn((definition: MockTool) => ({
    type: 'function',
    ...definition,
  }))

  return {
    Agent,
    RunContext,
    RunState,
    run,
    tool,
  }
})

vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'llm::project-analysis' })),
}))

vi.mock('@/lib/project-agent/model', () => ({
  resolveProjectAgentAssistantModelKey: vi.fn(async () => 'openrouter::openai/gpt-5.5'),
  resolveProjectAgentLanguageModel: vi.fn(async () => ({ languageModel: {} as never })),
}))

vi.mock('@/lib/project-agent/message-compression', () => ({
  compressMessages: vi.fn(async ({ messages }) => messages),
}))

vi.mock('@/lib/project-agent/project-phase', () => ({
  resolveProjectPhase: vi.fn(async () => ({
    phase: 'draft',
    planning: {
      editBibleStatus: 'ready_for_review',
      chapterCount: 3,
    },
    progress: {
      storyboardCount: 0,
      panelCount: 0,
    },
    staleArtifacts: [],
    availableActions: [],
    editFirstWorkflow: phaseState.editFirstWorkflow,
  })),
}))

vi.mock('@/lib/project-workflow/edit-first', async () => {
  const actual = await vi.importActual<typeof import('@/lib/project-workflow/edit-first')>('@/lib/project-workflow/edit-first')
  return {
    ...actual,
    resolveEditFirstWorkflowState: workflowRefreshState.resolveEditFirstWorkflowState,
  }
})

vi.mock('@/lib/adapters/tools/execute-project-agent-operation', () => ({
  executeProjectAgentOperationFromTool: vi.fn(async (params: {
    operationId: string
    taskBatchBinding?: {
      bindInTransaction(tx: unknown, batch: { operationId: string; taskIds: string[] }): Promise<void>
      markCommitted(): void
    } | null
  }) => {
    await params.taskBatchBinding?.bindInTransaction({}, {
      operationId: params.operationId,
      taskIds: ['task-generated-1'],
    })
    params.taskBatchBinding?.markCommitted()
    return {
      ok: true,
      data: {
        success: true,
        async: true,
        taskId: 'task-generated-1',
        status: 'queued',
        runId: null,
        deduped: false,
      },
    }
  }),
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))

vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    info: (...args: unknown[]) => loggerState.info(...args),
    warn: vi.fn(),
    error: (...args: unknown[]) => loggerState.error(...args),
    debug: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  })),
}))

vi.mock('@/lib/api-errors', () => ({
  getRequestId: vi.fn(() => 'req-1'),
}))

vi.mock('@/lib/project-agent/execution-handoff', () => ({
  prepareProjectAgentApprovalExecutionHandoff: vi.fn(async () => ({
    kind: 'approval',
    handoffId: 'handoff-approval-1',
    executionSegmentId: 'user-turn:run-1',
    runId: 'run-1',
    operationId: 'generate_edit_style_previews',
    approvalId: 'approval-row-1',
    toolCallId: 'tool-approval-1',
  })),
  settleProjectAgentPreparedApprovalHandoff: vi.fn(async () => ({
    kind: 'approval',
    runId: 'run-1',
    operationId: 'generate_edit_style_previews',
    activityId: 'activity-approval-1',
    interruptionId: 'interruption-row-1',
    approvalId: 'approval-row-1',
    toolCallId: 'tool-approval-1',
  })),
  settleProjectAgentPreparedChoiceHandoff: vi.fn(async () => ({
    kind: 'choice',
    runId: 'run-1',
    operationId: 'request_script_intake_choice',
    activityId: 'activity-choice-1',
    interruptionId: 'interruption-choice-1',
    cardId: 'card-choice-1',
    toolCallId: 'tool-choice-1',
    choiceType: 'script_intake',
    card: {},
  })),
  settleProjectAgentPreparedTaskHandoff: vi.fn(async () => ({
    kind: 'task',
    handoffId: 'handoff-task-1',
    executionSegmentId: 'user-turn:run-1',
    runId: 'run-1',
    operationId: 'generate_edit_style_previews',
    waitId: 'wait-task-1',
    taskIds: ['task-generated-1'],
    followUpMode: 'resume_agent',
  })),
}))

vi.mock('@/lib/project-agent/waits', () => ({
  bindProjectAgentWaitToTasksInTransaction: vi.fn(async () => ({
    kind: 'task',
    runId: 'run-1',
    operationId: 'generate_edit_style_previews',
    activityId: 'activity-task-1',
    waitId: 'wait-transactional-1',
    taskIds: ['task-1'],
    followUpMode: 'resume_agent',
  })),
}))

vi.mock('@/lib/project-agent/runs', () => ({
  safelyUpdateProjectAgentRunStatus: runState.safelyUpdateProjectAgentRunStatus,
  updateProjectAgentRunStatus: runState.safelyUpdateProjectAgentRunStatus,
  cancelRunningProjectAgentRun: runState.cancelRunningProjectAgentRun,
  settleProjectAgentRunFailureWithMessage: runState.settleProjectAgentRunFailureWithMessage,
  settleProjectAgentRunWithMessage: runState.settleProjectAgentRunWithMessage,
}))

vi.mock('@/lib/project-agent/run-heartbeat', () => ({
  startProjectAgentRunHeartbeat: runHeartbeatState.startProjectAgentRunHeartbeat,
  isProjectAgentRunOwnershipLostError: (value: unknown) => (
    value instanceof Error && value.name === 'ProjectAgentRunOwnershipLostError'
  ),
}))

vi.mock('@/lib/project-agent/run-lock', () => ({
  safelyReleaseProjectAgentRunLock: runLockState.safelyReleaseProjectAgentRunLock,
}))

vi.mock('@/lib/project-agent/persistence', () => ({
  appendProjectAssistantThreadMessages: persistenceState.appendProjectAssistantThreadMessages,
}))

vi.mock('@/lib/project-agent/event', () => ({
  appendProjectAgentEvents: eventState.appendProjectAgentEvents,
}))

vi.mock('@/lib/project-agent/run-budget', () => ({
  buildProjectAgentOperationTargetKey: vi.fn(({ operationId }: { operationId: string }) => `${operationId}:test-target`),
  enforceProjectAgentOperationRunBudget: vi.fn(async () => null),
}))

vi.mock('@/lib/operations/planned-operation-invocation', () => ({
  issueApprovalGrant: vi.fn(async () => ({
    approvalGrantId: 'approval-grant-1',
    operationRequestId: 'operation-request-1',
  })),
}))

import { createProjectAgentChatResponse, type ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'

import { buildEditFirstChoiceResult } from '@/lib/project-agent/edit-first-choice-result'

import { bindProjectAgentWaitToTasksInTransaction } from '@/lib/project-agent/waits'

const USER_TURN_CONTROL: ProjectAgentResolvedControl = {
  kind: 'user_turn',
  declinedInterruptions: [],
}

function buildRun(controlKind: ProjectAgentRunRecord['controlKind'] = 'user_turn'): ProjectAgentRunRecord {
  return {
    id: `run-${controlKind}`,
    projectId: 'project-1',
    userId: 'user-1',
    assistantId: 'workspace-command',
    scopeRef: 'episode:episode-1',
    episodeId: 'episode-1',
    requestId: 'request-1',
    status: 'running',
    runVersion: 1,
    eventSeq: '1',
    terminalEventSeq: null,
    controlKind,
    heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
  }
}

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

function buildWorkflow(stage: EditFirstWorkflowState['stage'], operationIds: string[]): EditFirstWorkflowState {
  const operationId = operationIds[0]
  return {
    active: true,
    stage,
    blocking: {
      kind: operationId ? 'needs_confirmation' : 'none',
      reason: null,
    },
    nextAction: operationId
      ? {
          id: operationId,
          operationId: operationId as EditFirstWorkflowOperationId,
          title: operationId,
        }
      : null,
    allowedOperationIds: operationIds as EditFirstWorkflowState['allowedOperationIds'],
  }
}

function makeOperation(id: string, intent: 'query' | 'act' = 'query') {
  const approvalKind = TEST_BILLABLE_EDIT_FIRST_OPERATION_IDS.has(id)
    || (intent === 'act' && !EDIT_FIRST_WORKFLOW_OPERATION_IDS.includes(id as EditFirstWorkflowOperationId))
    ? 'billable_media'
    : 'none'
  const common = {
    id,
    summary: id,
    intent,
    groupPath: id.startsWith('get_') || id.startsWith('list_') ? ['project', 'read'] : ['edit-script'],
    prerequisites: { episodeId: 'optional' as const },
    effects: intent === 'act' ? EFFECTS_BILLABLE : EFFECTS_NONE,
    confirmation: approvalKind === 'none'
      ? { kind: 'none' as const, required: false }
      : { kind: 'billable_media' as const, required: true, summary: 'billable operation' },
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
  }
  return approvalKind === 'billable_media'
    ? makeTestOperation({
        ...common,
        plan: async () => ({
          kind: 'task_submission',
          operationId: id,
          projectId: 'project-1',
          userId: 'user-1',
          tasks: [],
        }),
        commit: async () => ({}),
      })
    : makeTestOperation({ ...common, execute: async () => ({}) })
}

function createRegistry(): ProjectAgentOperationRegistry {
  const queryIds = [
    'get_project_context',
    'get_project_snapshot',
    'get_episode_overview',
    'get_chapter_detail',
    'get_task',
    'get_task_batch',
    'list_tasks',
    ...EDIT_FIRST_CHOICE_OPERATION_IDS,
  ]
  const actIds = [
    ...EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  ]
  return Object.fromEntries([
    ...queryIds.map((id) => [id, makeOperation(id, 'query')] as const),
    ...actIds.map((id) => [id, makeOperation(id, 'act')] as const),
  ])
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

async function drainCapturedResponseStream(): Promise<void> {
  const stream = streamState.capturedResponseStream
  if (!stream) throw new Error('TEST_RESPONSE_STREAM_MISSING')
  const reader = stream.getReader()
  while (true) {
    const read = await reader.read()
    if (read.done) return
  }
}

type PersistedAssistantMessage = {
  id: string
  role: string
  parts: Array<{
    type?: unknown
    data?: unknown
  }>
}

function readLastPersistedAssistantMessage(): PersistedAssistantMessage {
  const calls = persistenceState.appendProjectAssistantThreadMessages.mock.calls as unknown as Array<[{
    messages: PersistedAssistantMessage[]
  }]>
  const message = calls.at(-1)?.[0].messages[0]
  if (!message) throw new Error('TEST_PERSISTED_ASSISTANT_MESSAGE_MISSING')
  return message
}

function expectLastPersistedRunStatus(status: string, stopReason: string): void {
  const message = readLastPersistedAssistantMessage()
  const runPart = [...message.parts].reverse().find((part) => part.type === 'data-agent-run')
  if (!runPart || !runPart.data || typeof runPart.data !== 'object' || Array.isArray(runPart.data)) {
    throw new Error('TEST_PERSISTED_RUN_PART_MISSING')
  }
  expect(runPart.data).toMatchObject({
    status,
    stopReason,
  })
}

function readLastPersistedRuntimeContext(): Record<string, unknown> {
  const message = readLastPersistedAssistantMessage()
  const runtimePart = message.parts.find((part) => part.type === 'data-agent-runtime-context')
  if (!runtimePart || !runtimePart.data || typeof runtimePart.data !== 'object' || Array.isArray(runtimePart.data)) {
    throw new Error('TEST_PERSISTED_RUNTIME_CONTEXT_MISSING')
  }
  return runtimePart.data as Record<string, unknown>
}

async function runAssistant(params: {
  context?: Record<string, unknown>
  text?: string
  assistantPermissionMode?: 'ask' | 'auto'
}) {
  const response = await createProjectAgentChatResponse({
    request: buildRequest(),
    userId: 'user-1',
    projectId: 'project-1',
    context: params.context ?? { episodeId: 'episode-1' },
    assistantPermissionMode: params.assistantPermissionMode ?? 'ask',
    run: buildRun(),
    control: USER_TURN_CONTROL,
    messages: [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: params.text ?? '民俗恐怖片' }] },
    ],
  })
  await flushAsyncWork()
  return response
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { z } from 'zod'
export type { NextRequest } from 'next/server'
export type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
export { EDIT_FIRST_WORKFLOW_OPERATION_IDS } from '@/lib/project-workflow/edit-first'
export type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
export type { ProjectAgentRunRecord } from '@/lib/project-agent/runs'
export { EDIT_FIRST_CHOICE_OPERATION_IDS, EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
export { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'
export { createProjectAgentChatResponse } from '@/lib/project-agent/runtime'
export type { ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'
export { buildEditFirstChoiceResult } from '@/lib/project-agent/edit-first-choice-result'
export { bindProjectAgentWaitToTasksInTransaction } from '@/lib/project-agent/waits'
export { USER_TURN_CONTROL, buildRequest, buildRun, buildWorkflow, createRegistry, drainCapturedResponseStream, eventState, expectLastPersistedRunStatus, flushAsyncWork, loggerState, makeOperation, persistenceState, phaseState, readLastPersistedAssistantMessage, readLastPersistedRuntimeContext, registryState, runAssistant, runHeartbeatState, runLockState, runState, streamState, workflowRefreshState }
export type { PersistedAssistantMessage }
