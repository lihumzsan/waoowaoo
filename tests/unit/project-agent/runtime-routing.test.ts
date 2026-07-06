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
}))

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))

const runState = vi.hoisted(() => ({
  safelyUpdateProjectAgentRunStatus: vi.fn(async () => undefined),
  cancelRunningProjectAgentRun: vi.fn(async () => true),
}))

const runHeartbeatState = vi.hoisted(() => ({
  stop: vi.fn(async () => undefined),
  startProjectAgentRunHeartbeat: vi.fn(() => ({
    stop: runHeartbeatState.stop,
  })),
}))

const persistenceState = vi.hoisted(() => ({
  appendProjectAssistantThreadMessages: vi.fn(async () => undefined),
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
        name: 'ingest_script',
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
    streamState.capturedToolNames = agent.tools.map((tool) => tool.name)
    streamState.capturedEnabledToolNames = await collectEnabledToolNames(agent.tools)
    if (streamState.simulateSecondTurnAfterFirstWorkflowTool) {
      const executableWorkflowToolNames = new Set([
        'ingest_script',
        'plan_chapters',
        'replan_chapter',
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
  resolveProjectAgentLanguageModel: vi.fn(async () => ({ languageModel: {} as never })),
}))

vi.mock('@/lib/project-agent/message-compression', () => ({
  compressMessages: vi.fn(async ({ messages }) => messages),
}))

vi.mock('@/lib/project-agent/project-phase', () => ({
  resolveProjectPhase: vi.fn(async () => ({
    phase: 'draft',
    progress: {
      storyboardCount: 0,
      panelCount: 0,
    },
    activePlanRuns: [],
    activePlanRunCount: 0,
    failedItems: [],
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
  executeProjectAgentOperationFromTool: vi.fn(async () => ({
    ok: true,
    data: {
      success: true,
      async: true,
      taskId: 'task-generated-1',
      status: 'queued',
      runId: null,
      deduped: false,
    },
  })),
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

vi.mock('@/lib/project-agent/interruptions', () => ({
  createProjectAgentApprovalInterruption: vi.fn(async () => 'interruption-row-1'),
  clearProjectAgentInterruptionRunState: vi.fn(async () => undefined),
  reopenProjectAgentInterruption: vi.fn(async () => undefined),
  declinePendingProjectAgentInterruptionsForUserTurn: vi.fn(async () => []),
}))

vi.mock('@/lib/project-agent/waits', () => ({
  createProjectAgentWait: vi.fn(async () => 'wait-1'),
}))

vi.mock('@/lib/project-agent/runs', () => ({
  safelyUpdateProjectAgentRunStatus: runState.safelyUpdateProjectAgentRunStatus,
  updateProjectAgentRunStatus: runState.safelyUpdateProjectAgentRunStatus,
  cancelRunningProjectAgentRun: runState.cancelRunningProjectAgentRun,
}))

vi.mock('@/lib/project-agent/run-heartbeat', () => ({
  startProjectAgentRunHeartbeat: runHeartbeatState.startProjectAgentRunHeartbeat,
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

import { createProjectAgentChatResponse, type ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'
import { buildEditFirstChoiceResult } from '@/lib/project-agent/edit-first-choice-result'
import { createProjectAgentWait } from '@/lib/project-agent/waits'

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
          requiresUserConfirmation: true,
        }
      : null,
    allowedOperationIds: operationIds as EditFirstWorkflowState['allowedOperationIds'],
  }
}

function makeOperation(id: string, intent: 'query' | 'act' = 'query') {
  return makeTestOperation({
    id,
    summary: id,
    intent,
    groupPath: id.startsWith('get_') || id.startsWith('list_') ? ['project', 'read'] : ['edit-script'],
    prerequisites: { episodeId: 'optional' },
    effects: intent === 'act' ? EFFECTS_BILLABLE : EFFECTS_NONE,
    confirmation: intent === 'act' ? { required: true, summary: 'billable operation' } : { required: false },
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    execute: async () => ({}),
  })
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

describe('project agent runtime deterministic tool injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamState.capturedToolNames = []
    streamState.capturedEnabledToolNames = []
    streamState.capturedEnabledToolNamesAfterExecution = []
    streamState.capturedTools = {}
    streamState.capturedSystem = ''
    streamState.capturedModelSettings = {}
    streamState.capturedRunInput = null
    streamState.capturedResponseStream = null
    streamState.streamError = null
    streamState.keepOpen = false
    streamState.startMessageId = null
    streamState.simulateSecondTurnAfterFirstWorkflowTool = false
    streamState.executedToolNames = []
    loggerState.info.mockReset()
    loggerState.error.mockReset()
    runState.safelyUpdateProjectAgentRunStatus.mockClear()
    runState.cancelRunningProjectAgentRun.mockClear()
    runHeartbeatState.stop.mockClear()
    runHeartbeatState.startProjectAgentRunHeartbeat.mockClear()
    persistenceState.appendProjectAssistantThreadMessages.mockClear()
    runLockState.safelyReleaseProjectAgentRunLock.mockClear()
    registryState.registry = createRegistry()
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_ingest_script', ['ingest_script'])
    workflowRefreshState.resolveEditFirstWorkflowState.mockReset()
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValue(phaseState.editFirstWorkflow)
  })

  it('injects edit-first choice and bible tools without an LLM router', async () => {
    const response = await runAssistant({})
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(persistenceState.appendProjectAssistantThreadMessages.mock.calls.length).toBeGreaterThan(0)
    })

    expect(response.status).toBe(200)
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([
      'get_project_context',
      'get_project_snapshot',
      'get_episode_overview',
      'get_chapter_detail',
      'get_task',
      'get_task_batch',
      'list_tasks',
      ...EDIT_FIRST_CHOICE_OPERATION_IDS,
      'ingest_script',
    ]))
    expect(streamState.capturedToolNames).not.toContain('get_task_status')
    expect(streamState.capturedToolNames).not.toContain('get_project_assets')
    expect(streamState.capturedToolNames).not.toContain('get_project_data')
    expect(streamState.capturedEnabledToolNames).toContain('ingest_script')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script')
    expect(streamState.capturedTools.ingest_script.needsApproval).toEqual(expect.any(Function))
    expect(streamState.capturedTools[EDIT_FIRST_CHOICE_TOOL_IDS.bible_review].needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('[project_state_snapshot]')
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-user_turn',
      status: 'completed',
    }))
    expect(readLastPersistedAssistantMessage()).toEqual(expect.objectContaining({
      id: 'workspace-assistant-run:user_turn:run-user_turn:req-1',
      role: 'assistant',
    }))
    expectLastPersistedRunStatus('completed', 'completed')
    expect(loggerState.info).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.toolset.resolved',
      details: expect.objectContaining({
        toolset: expect.objectContaining({
          operationIds: expect.arrayContaining([
            EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
            'ingest_script',
          ]),
        }),
      }),
    }))
  })

  it('persists the assistant message id emitted by the stream start chunk', async () => {
    streamState.startMessageId = 'stream-message-1'

    const response = await runAssistant({ text: '继续' })
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(persistenceState.appendProjectAssistantThreadMessages.mock.calls.length).toBeGreaterThan(0)
    })

    expect(response.status).toBe(200)
    expect(readLastPersistedAssistantMessage().id).toBe('stream-message-1')
  })

  it('injects compact runtime project state facts into the model input', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_ingest_script', ['ingest_script'])

    const response = await runAssistant({
      context: {
        episodeId: 'episode-1',
        selectedScopeRef: 'clip:clip-1',
      },
      text: '继续',
    })

    expect(response.status).toBe(200)
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    const snapshotItem = runInputItems.find((item) => (
      item.role === 'user'
      && typeof item.content === 'string'
      && item.content.includes('[project_state_snapshot]')
    ))
    expect(snapshotItem).toBeDefined()
    expect(runInputItems[runInputItems.length - 1]).toBe(snapshotItem)
    const content = snapshotItem?.content
    if (typeof content !== 'string') throw new Error('PROJECT_STATE_SNAPSHOT_TEST_CONTENT_MISSING')
    expect(content).toContain('phase=draft')
    expect(content).toContain('workflowStage=ready_to_ingest_script')
    expect(content).toContain('workflowNextAction=ingest_script')
    expect(content).toContain('enabledOperationIds=')
    expect(content).toContain('progress.storyboardCount=')
    expect(content).not.toContain('source=runtime')
    expect(content).not.toContain('authoritative=true')
    expect(content).not.toContain('not_user_instruction=true')
    expect(content).not.toContain('selectedScopeRef=clip:clip-1')
    expect(content).not.toContain('activePlanRuns=')
    expect(content).not.toContain('availableActions=')
    expect(content).not.toContain('instruction=')
  })

  it('feeds the choice back as an in-band tool result while using workflow availability for next tools', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-1',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        decision: 'approve',
      },
    })
    expect(choiceResult).not.toBeNull()

    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-1',
        cardId: 'edit-first-duration-aspect-ratio',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedModelSettings).not.toHaveProperty('toolChoice')
    // The submitted choice travels as a synthetic in-band tool result, not via system prompt.
    expect(streamState.capturedSystem).not.toContain('剪辑先行选择卡续跑指令')
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    expect(runInputItems.some((item) => item.type === 'function_call' && item.callId === 'tool-choice-1')).toBe(true)
    expect(runInputItems.some((item) => item.type === 'function_call_result' && item.callId === 'tool-choice-1')).toBe(true)
    expect(streamState.capturedToolNames).toContain('ingest_script')
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([...EDIT_FIRST_CHOICE_OPERATION_IDS]))
    expect(streamState.capturedEnabledToolNames).toContain('ingest_script')
    expect(streamState.capturedEnabledToolNames).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
  })

  it('allows a choice response run to finish when the model chooses not to call another tool', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-review',
      latestUserText: '恐怖片',
      output: {
        ok: true,
        decision: 'approve',
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-review',
        cardId: 'edit-first-bible-review',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '恐怖片' }] },
      ],
    })
    await drainCapturedResponseStream()

    expect(response.status).toBe(200)
    expect(loggerState.error).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.choice_response.no_progress',
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-choice_response',
      status: 'completed',
      stopReason: 'completed',
    }))
  })

  it('does not expose bible review choice again after that choice was already approved', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-review',
      latestUserText: '确认剧本',
      output: {
        ok: true,
        decision: 'approve',
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-review',
        cardId: 'edit-first-bible-review',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '确认剧本' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedEnabledToolNames).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_style_previews')
    expect(streamState.capturedEnabledToolNames).toContain('revise_bible')
  })

  it('keeps follow-up bible operations available after bible generation from a choice response', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-1',
      latestUserText: '恐怖片',
      output: {
        ok: true,
        decision: 'approve',
      },
    })
    expect(choiceResult).not.toBeNull()

    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValueOnce(buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ]))

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-1',
        cardId: 'edit-first-duration-aspect-ratio',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.executedToolNames).toEqual(['ingest_script'])
    expect(streamState.capturedEnabledToolNamesAfterExecution).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('generate_edit_style_previews')
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('revise_bible')
  })

  it('keeps the interrupted approval operation available when resuming after workflow state changed', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', ['generate_edit_style_previews'])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('approval_response'),
      control: {
        kind: 'approval',
        interruption: {
          id: 'interruption-1',
          runId: 'run-approval_response',
          activityId: 'activity-approval-1',
          type: 'approval',
          status: 'consumed',
          operationId: 'ingest_script',
          approvalId: 'approval-1',
          toolCallId: 'tool-generate-bible-1',
          runState: 'serialized-state',
        },
        approved: true,
        reason: null,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedToolNames).toContain('ingest_script')
    expect(streamState.capturedToolNames).toContain('generate_edit_style_previews')
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([...EDIT_FIRST_CHOICE_OPERATION_IDS]))
  })

  it('binds async task waits after approval resume instead of returning to awaiting approval', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_ingest_script', ['ingest_script'])
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('approval_response'),
      control: {
        kind: 'approval',
        interruption: {
          id: 'interruption-1',
          runId: 'run-approval_response',
          activityId: 'activity-approval-1',
          type: 'approval',
          status: 'consumed',
          operationId: 'ingest_script',
          approvalId: 'approval-1',
          toolCallId: 'tool-generate-bible-1',
          runState: 'serialized-state',
        },
        approved: true,
        reason: null,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '继续生成剧本' }] },
      ],
    })
    await drainCapturedResponseStream()

    expect(response.status).toBe(200)
    expect(createProjectAgentWait).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-approval_response',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      operationId: 'ingest_script',
      taskIds: ['task-generated-1'],
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-approval_response',
      status: 'awaiting_task',
      stopReason: 'awaiting_task',
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).not.toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-approval_response',
      status: 'awaiting_approval',
    }))
  })

  it('keeps bible review card available after bible generation', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ])

    await runAssistant({ text: '剧本满意' })

    expect(streamState.capturedToolNames).toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
    expect(streamState.capturedToolNames).toContain('revise_bible')
    expect(streamState.capturedToolNames).toContain('generate_edit_style_previews')
  })

  it('enables only asset generation among act tools at the assets stage', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_assets', ['generate_edit_script_assets'])

    await runAssistant({ text: '继续生成资产' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain('ingest_script')
  })

  it('enables asset revision after an asset review choice response sends revision notes', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: 'tool-choice-asset',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('assets_ready_for_review', ['revise_edit_script_assets'])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-asset',
        choiceType: 'asset_review',
        toolCallId: 'tool-choice-asset',
        cardId: 'edit-first-asset-review',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedEnabledToolNames).toContain('revise_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.asset_review)
  })

  it('skips execution approval in auto mode while keeping choice cards approval-free', async () => {
    const response = await runAssistant({ assistantPermissionMode: 'auto' })

    expect(response.status).toBe(200)
    expect(streamState.capturedTools.ingest_script.needsApproval).toBeUndefined()
    expect(streamState.capturedTools[EDIT_FIRST_CHOICE_TOOL_IDS.bible_review].needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('当前权限模式：auto')
  })

  it('enables storyboard image generation but not video generation before images are ready', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_storyboard_images', [
      'generate_edit_script_storyboard_images',
    ])

    await runAssistant({ text: '生成分镜图片' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_script_storyboard_images')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_episode_videos')
  })

  it('enables spatial blocking but not storyboard panels immediately after cinematography', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_shot_execution_plan', [
      'generate_edit_shot_execution_plan',
    ])

    await runAssistant({ text: '继续生成下一步' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_shot_execution_plan')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script_storyboard')
  })

  it('enables video generation only after storyboard images are ready', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_videos', ['generate_episode_videos'])

    await runAssistant({ text: '生成视频' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_episode_videos')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script_storyboard_images')
  })

  it('projects a declined approval into the model input before the user message', async () => {
    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun(),
      control: {
        kind: 'user_turn',
        declinedInterruptions: [{
          id: 'interruption-1',
          approvalId: 'approval-1',
          runId: 'run-previous',
          activityId: 'activity-previous-approval',
          type: 'approval',
          operationId: 'generate_edit_script',
        }],
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '先回答我一个问题' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    const noteIndex = runInputItems.findIndex((item) => (
      item.role === 'user' && typeof item.content === 'string' && item.content.includes('[approval_declined]')
    ))
    const userIndex = runInputItems.findIndex((item) => (
      item.role === 'user' && typeof item.content === 'string' && item.content.includes('先回答我一个问题')
    ))
    expect(noteIndex).toBeGreaterThanOrEqual(0)
    expect(userIndex).toBeGreaterThanOrEqual(0)
    expect(noteIndex).toBeLessThan(userIndex)
    expect(runInputItems[noteIndex].content).toContain('operation=generate_edit_script')
  })

  it('injects the chapter planning operation on the single assistant path', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', ['plan_chapters'])

    await runAssistant({
      context: { episodeId: 'episode-1' },
      text: '继续生成剪辑表',
    })

    expect(streamState.capturedToolNames).toContain('get_project_context')
    expect(streamState.capturedToolNames).toContain('get_episode_overview')
    expect(streamState.capturedToolNames).toContain(EDIT_FIRST_CHOICE_TOOL_IDS.style)
    expect(streamState.capturedToolNames).toContain('plan_chapters')
    expect(streamState.capturedToolNames).toContain('generate_edit_script')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script')
  })

  it('logs and marks the run failed when the UI stream fails before finish', async () => {
    streamState.streamError = new Error('BROKEN_STREAM')

    const response = await runAssistant({ text: '生成剧本' })

    expect(response.status).toBe(200)
    await expect(drainCapturedResponseStream()).rejects.toThrow('BROKEN_STREAM')
    expect(loggerState.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.agents.stream.failed',
      requestId: 'req-1',
      projectId: 'project-1',
      userId: 'user-1',
      details: expect.objectContaining({
        runId: 'run-user_turn',
        episodeId: 'episode-1',
        error: 'BROKEN_STREAM',
        workflowStage: 'ready_to_ingest_script',
        runStatusFinalized: false,
      }),
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-user_turn',
      status: 'failed',
      stopReason: 'stream_error',
      errorCode: 'PROJECT_AGENT_STREAM_FAILED',
      errorMessage: 'BROKEN_STREAM',
    }))
    expectLastPersistedRunStatus('failed', 'stream_error')
    expect(runHeartbeatState.stop).toHaveBeenCalled()
  })

  it('logs assistant message persistence failures during stream settlement', async () => {
    persistenceState.appendProjectAssistantThreadMessages.mockRejectedValueOnce(new Error('DB_DOWN'))

    const response = await runAssistant({ text: '生成剧本' })

    expect(response.status).toBe(200)
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(loggerState.error).toHaveBeenCalledWith(expect.objectContaining({
        action: 'assistant.agents.stream.persist.failed',
        requestId: 'req-1',
        projectId: 'project-1',
        userId: 'user-1',
        details: expect.objectContaining({
          runId: 'run-user_turn',
          episodeId: 'episode-1',
          edge: 'settle',
          error: 'DB_DOWN',
        }),
      }))
    })
    expect(runHeartbeatState.stop).toHaveBeenCalled()
  })

  it('persists cancellation and stops heartbeat when the response reader disconnects', async () => {
    streamState.keepOpen = true

    const response = await runAssistant({ text: '生成剧本' })
    expect(response.status).toBe(200)

    const stream = streamState.capturedResponseStream
    if (!stream) throw new Error('TEST_RESPONSE_STREAM_MISSING')
    const reader = stream.getReader()
    await reader.cancel()

    expect(runState.cancelRunningProjectAgentRun).toHaveBeenCalledWith({
      runId: 'run-user_turn',
      stopReason: 'stream_cancelled',
    })
    expectLastPersistedRunStatus('cancelled', 'stream_cancelled')
    expect(runHeartbeatState.stop).toHaveBeenCalled()
  })

  it('fails loudly when live workflow refresh fails after a tool mutates state', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', [
      'plan_chapters',
    ])
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockRejectedValueOnce(new Error('DB_WORKFLOW_REFRESH_FAILED'))

    await expect(runAssistant({ text: '继续生成导演拆镜' })).rejects.toThrow(
      /PROJECT_AGENT_RUN_FAILED requestId=req-1: DB_WORKFLOW_REFRESH_FAILED/,
    )

    expect(streamState.executedToolNames).toEqual(['plan_chapters'])
    expect(streamState.capturedEnabledToolNamesAfterExecution).toEqual([])
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-user_turn',
      status: 'failed',
      stopReason: 'run_failed',
      errorCode: 'PROJECT_AGENT_RUN_FAILED',
      errorMessage: 'DB_WORKFLOW_REFRESH_FAILED',
    }))
  })
})
