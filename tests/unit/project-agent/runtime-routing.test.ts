import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectAgentRunRecord } from '@/lib/project-agent/runs'
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
      controller.enqueue({ type: 'finish' })
      controller.close()
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
        name: 'generate_edit_screenplay',
        rawItem: {
          id: 'approval-1',
          callId: 'tool-generate-screenplay-1',
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
      const executable = agent.tools.find((tool) => (
        streamState.capturedEnabledToolNames.includes(tool.name)
        && typeof tool.execute === 'function'
        && tool.name.startsWith('generate_edit_')
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
      clipCount: 0,
      screenplayClipCount: 0,
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
  executeProjectAgentOperationFromTool: vi.fn(async () => ({ ok: true, data: {} })),
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
}))

import { createProjectAgentChatResponse, type ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'
import { buildEditFirstChoiceResult } from '@/lib/project-agent/edit-first-choice-result'

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
    'ui_cancel',
    'ui_confirm',
    'ui_single_select',
    'ui_multi_select',
    'ui_safety_ack',
    'get_project_phase',
    'get_project_context',
    'get_project_snapshot',
    'get_task_status',
    'get_project_command',
    'list_recent_commands',
    'get_project_assets',
    'get_project_costs',
    'get_project_data',
    'get_task',
    'list_tasks',
    'request_edit_first_choice',
  ]
  const actIds = [
    'generate_edit_screenplay',
    'revise_edit_screenplay',
    'generate_edit_style_previews',
    'generate_edit_director_decoupage',
    'generate_edit_script',
    'generate_edit_script_assets',
    'generate_edit_cinematography_shot_plan',
    'generate_edit_script_storyboard_spatial_blocking',
    'generate_edit_script_storyboard',
    'generate_edit_script_storyboard_images',
    'generate_episode_videos',
    'render_final_video',
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
    streamState.simulateSecondTurnAfterFirstWorkflowTool = false
    streamState.executedToolNames = []
    loggerState.info.mockReset()
    loggerState.error.mockReset()
    runState.safelyUpdateProjectAgentRunStatus.mockClear()
    registryState.registry = createRegistry()
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_screenplay', ['generate_edit_screenplay'])
    workflowRefreshState.resolveEditFirstWorkflowState.mockReset()
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValue(phaseState.editFirstWorkflow)
  })

  it('injects edit-first choice and screenplay tools without an LLM router', async () => {
    const response = await runAssistant({})

    expect(response.status).toBe(200)
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([
      'get_project_phase',
      'get_project_context',
      'request_edit_first_choice',
      'generate_edit_screenplay',
    ]))
    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_screenplay')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script')
    expect(streamState.capturedTools.generate_edit_screenplay.needsApproval).toBeUndefined()
    expect(streamState.capturedTools.request_edit_first_choice.needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('[project_state_snapshot]')
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-user_turn',
      status: 'completed',
    }))
    expect(loggerState.info).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.toolset.resolved',
      details: expect.objectContaining({
        toolset: expect.objectContaining({
          operationIds: expect.arrayContaining(['request_edit_first_choice', 'generate_edit_screenplay']),
        }),
      }),
    }))
  })

  it('injects compact runtime project state into the model input', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_screenplay', ['generate_edit_screenplay'])

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
    expect(content).toContain('source=runtime')
    expect(content).toContain('authoritative=true')
    expect(content).toContain('phase=draft')
    expect(content).toContain('workflowStage=ready_to_generate_screenplay')
    expect(content).toContain('workflowNextAction=generate_edit_screenplay')
    expect(content).toContain('enabledOperationIds=')
    expect(content).toContain('selectedScopeRef=clip:clip-1')
    expect(content).toContain('Do not call get_project_phase by default')
  })

  it('feeds the choice back as an in-band tool result while using workflow availability for next tools', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-choice-1',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        durationTier: 'medium',
        aspectRatio: '16:9',
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
        choiceType: 'duration_and_aspect_ratio',
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
    expect(streamState.capturedToolNames).toContain('generate_edit_screenplay')
    expect(streamState.capturedToolNames).toContain('request_edit_first_choice')
    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_screenplay')
    expect(streamState.capturedEnabledToolNames).toContain('request_edit_first_choice')
  })

  it('allows a choice response run to finish when the model chooses not to call another tool', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'screenplay_review',
      toolCallId: 'tool-choice-review',
      latestUserText: '恐怖片',
      output: {
        ok: true,
        decision: 'approve',
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('screenplay_ready_for_review', [
      'generate_edit_style_previews',
      'revise_edit_screenplay',
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
        choiceType: 'screenplay_review',
        toolCallId: 'tool-choice-review',
        cardId: 'edit-first-screenplay-review',
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

  it('keeps screenplay review choice available after screenplay generation from a choice response', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-choice-1',
      latestUserText: '恐怖片',
      output: {
        ok: true,
        durationTier: 'short',
        aspectRatio: '16:9',
      },
    })
    expect(choiceResult).not.toBeNull()

    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValueOnce(buildWorkflow('screenplay_ready_for_review', [
      'generate_edit_style_previews',
      'revise_edit_screenplay',
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
        choiceType: 'duration_and_aspect_ratio',
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
    expect(streamState.executedToolNames).toEqual(['generate_edit_screenplay'])
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('request_edit_first_choice')
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('generate_edit_style_previews')
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('revise_edit_screenplay')
  })

  it('keeps the interrupted approval operation available when resuming after workflow state changed', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('screenplay_ready_for_review', ['generate_edit_style_previews'])

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
          type: 'approval',
          status: 'consumed',
          operationId: 'generate_edit_screenplay',
          approvalId: 'approval-1',
          toolCallId: 'tool-generate-screenplay-1',
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
    expect(streamState.capturedToolNames).toContain('generate_edit_screenplay')
    expect(streamState.capturedToolNames).toContain('generate_edit_style_previews')
    expect(streamState.capturedToolNames).toContain('request_edit_first_choice')
  })

  it('keeps screenplay review card available after screenplay generation', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('screenplay_ready_for_review', [
      'generate_edit_style_previews',
      'revise_edit_screenplay',
    ])

    await runAssistant({ text: '剧本满意' })

    expect(streamState.capturedToolNames).toContain('request_edit_first_choice')
    expect(streamState.capturedToolNames).toContain('revise_edit_screenplay')
    expect(streamState.capturedToolNames).toContain('generate_edit_style_previews')
  })

  it('enables only asset generation among act tools at the assets stage', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_assets', ['generate_edit_script_assets'])

    await runAssistant({ text: '继续生成资产' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_screenplay')
  })

  it('skips execution approval in auto mode while keeping choice cards approval-free', async () => {
    const response = await runAssistant({ assistantPermissionMode: 'auto' })

    expect(response.status).toBe(200)
    expect(streamState.capturedTools.generate_edit_screenplay.needsApproval).toBeUndefined()
    expect(streamState.capturedTools.request_edit_first_choice.needsApproval).toBeUndefined()
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
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_storyboard_spatial_blocking', [
      'generate_edit_script_storyboard_spatial_blocking',
    ])

    await runAssistant({ text: '继续生成下一步' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_script_storyboard_spatial_blocking')
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

  it('injects the immediate workflow operation on the single assistant path', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', ['generate_edit_script'])

    await runAssistant({
      context: { episodeId: 'episode-1' },
      text: '继续生成剪辑表',
    })

    expect(streamState.capturedToolNames).toContain('get_project_phase')
    expect(streamState.capturedToolNames).toContain('request_edit_first_choice')
    expect(streamState.capturedToolNames).toContain('generate_edit_script')
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
        workflowStage: 'ready_to_generate_screenplay',
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
  })

  it('fails loudly when live workflow refresh fails after a tool mutates state', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_director_decoupage', [
      'generate_edit_director_decoupage',
    ])
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockRejectedValueOnce(new Error('DB_WORKFLOW_REFRESH_FAILED'))

    await expect(runAssistant({ text: '继续生成导演拆镜' })).rejects.toThrow(
      /PROJECT_AGENT_RUN_FAILED requestId=req-1: DB_WORKFLOW_REFRESH_FAILED/,
    )

    expect(streamState.executedToolNames).toEqual(['generate_edit_director_decoupage'])
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
