import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectAgentRunRecord } from '@/lib/project-agent/runs'
import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

const streamState = vi.hoisted(() => ({
  capturedToolNames: [] as string[],
  capturedTools: {} as Record<string, { needsApproval?: unknown }>,
  capturedSystem: '',
  capturedModelSettings: {} as Record<string, unknown>,
  capturedRunInput: null as unknown,
}))

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
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

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    safeValidateUIMessages: vi.fn(async ({ messages }) => ({ success: true, data: messages })),
    createUIMessageStreamResponse: vi.fn(() => new Response('ok', { status: 200 })),
  }
})

vi.mock('@openai/agents-extensions/ai-sdk', () => ({
  aisdk: vi.fn((model) => model),
}))

vi.mock('@openai/agents-extensions/ai-sdk-ui', () => ({
  createAiSdkUiMessageStream: vi.fn(() => new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'finish' })
      controller.close()
    },
  })),
}))

vi.mock('@openai/agents', () => {
  class Agent {
    name: string
    instructions: string
    modelSettings: Record<string, unknown>
    tools: Array<{ name: string; needsApproval?: unknown }>

    constructor(config: {
      name: string
      instructions: string
      modelSettings?: Record<string, unknown>
      tools: Array<{ name: string; needsApproval?: unknown }>
    }) {
      this.name = config.name
      this.instructions = config.instructions
      this.modelSettings = config.modelSettings ?? {}
      this.tools = config.tools
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

  const run = vi.fn(async (agent: Agent, runInput: unknown) => {
    streamState.capturedToolNames = agent.tools.map((tool) => tool.name)
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

  const tool = vi.fn((definition: { name: string; needsApproval?: unknown }) => ({
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
    error: vi.fn(),
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
  supersedePendingProjectAgentInterruptions: vi.fn(async () => []),
}))

vi.mock('@/lib/project-agent/waits', () => ({
  createProjectAgentWait: vi.fn(async () => 'wait-1'),
}))

vi.mock('@/lib/project-agent/runs', () => ({
  safelyUpdateProjectAgentRunStatus: runState.safelyUpdateProjectAgentRunStatus,
}))

import { createProjectAgentChatResponse, type ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'
import { resolveEditFirstChoiceContinuation } from '@/lib/project-agent/edit-first-choice-continuation'

const USER_TURN_CONTROL: ProjectAgentResolvedControl = {
  kind: 'user_turn',
  supersededInterruptions: [],
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
    'list_skill_catalog',
    'list_saved_skills',
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
    streamState.capturedTools = {}
    streamState.capturedSystem = ''
    streamState.capturedModelSettings = {}
    loggerState.info.mockReset()
    runState.safelyUpdateProjectAgentRunStatus.mockClear()
    registryState.registry = createRegistry()
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_screenplay', ['generate_edit_screenplay'])
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
    expect(streamState.capturedTools.generate_edit_screenplay.needsApproval).toBe(true)
    expect(streamState.capturedTools.request_edit_first_choice.needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('当前 workflow 阶段')
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

  it('feeds the choice back as an in-band tool result and narrows the toolset', async () => {
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-choice-1',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        durationSeconds: 60,
        aspectRatio: '16:9',
      },
    })
    expect(continuation).not.toBeNull()

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
        continuation: continuation!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedModelSettings).not.toHaveProperty('toolChoice')
    // continuation guidance travels as a synthetic in-band tool result, not via system prompt
    expect(streamState.capturedSystem).not.toContain('剪辑先行选择卡续跑指令')
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    expect(runInputItems.some((item) => item.type === 'function_call' && item.callId === 'tool-choice-1')).toBe(true)
    expect(runInputItems.some((item) => item.type === 'function_call_result' && item.callId === 'tool-choice-1')).toBe(true)
    expect(streamState.capturedToolNames).toContain('generate_edit_screenplay')
    expect(streamState.capturedToolNames).not.toContain('request_edit_first_choice')
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

  it('injects asset generation at the assets stage', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_assets', ['generate_edit_script_assets'])

    await runAssistant({ text: '继续生成资产' })

    expect(streamState.capturedToolNames).toContain('generate_edit_script_assets')
    expect(streamState.capturedToolNames).not.toContain('generate_edit_screenplay')
  })

  it('skips execution approval in auto mode while keeping choice cards approval-free', async () => {
    const response = await runAssistant({ assistantPermissionMode: 'auto' })

    expect(response.status).toBe(200)
    expect(streamState.capturedTools.generate_edit_screenplay.needsApproval).toBeUndefined()
    expect(streamState.capturedTools.request_edit_first_choice.needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('Assistant 权限模式：auto')
  })

  it('injects storyboard image generation before video generation', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_storyboard_images', [
      'generate_edit_script_storyboard_images',
    ])

    await runAssistant({ text: '生成分镜图片' })

    expect(streamState.capturedToolNames).toContain('generate_edit_script_storyboard_images')
    expect(streamState.capturedToolNames).not.toContain('generate_episode_videos')
  })

  it('injects video generation only after storyboard images are ready', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_videos', ['generate_episode_videos'])

    await runAssistant({ text: '生成视频' })

    expect(streamState.capturedToolNames).toContain('generate_episode_videos')
    expect(streamState.capturedToolNames).not.toContain('generate_edit_script_storyboard_images')
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
})
