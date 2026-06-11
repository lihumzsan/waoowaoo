import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

const streamState = vi.hoisted(() => ({
  capturedToolNames: [] as string[],
  capturedTools: {} as Record<string, { needsApproval?: unknown }>,
  capturedSystem: '',
  writerEvents: [] as Array<Record<string, unknown>>,
}))

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
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
    convertToModelMessages: vi.fn(async (messages) => messages),
    streamText: vi.fn((input) => {
      streamState.capturedToolNames = Object.keys(input.tools ?? {})
      streamState.capturedTools = input.tools ?? {}
      streamState.capturedSystem = input.system
      return {
        toUIMessageStream: () => ({
          pipeThrough: () => undefined,
        }),
      }
    }),
    createUIMessageStream: vi.fn(({ execute }) => {
      const writer = {
        write: (chunk: Record<string, unknown>) => {
          streamState.writerEvents.push(chunk)
        },
        merge: vi.fn(),
      }
      void execute({ writer })
      return { writer }
    }),
    createUIMessageStreamResponse: vi.fn(() => new Response('ok', { status: 200 })),
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
    availableActions: {
      actMode: [],
      planMode: [],
    },
    editFirstWorkflow: phaseState.editFirstWorkflow,
  })),
}))

vi.mock('@/lib/project-agent/stop-conditions', () => ({
  createProjectAgentStopController: vi.fn(() => ({
    stopWhen: undefined,
    buildStopPart: () => null,
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

import { createProjectAgentChatResponse } from '@/lib/project-agent/runtime'

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
}) {
  const response = await createProjectAgentChatResponse({
    request: buildRequest(),
    userId: 'user-1',
    projectId: 'project-1',
    context: params.context ?? { episodeId: 'episode-1' },
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
    streamState.writerEvents = []
    loggerState.info.mockReset()
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
    expect(streamState.capturedSystem).toContain('当前 workflow 阶段')
    expect(loggerState.info).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.toolset.result',
      details: expect.objectContaining({
        operationIds: expect.arrayContaining(['request_edit_first_choice', 'generate_edit_screenplay']),
      }),
    }))
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

  it('does not inject act tools in explicit plan mode', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', ['generate_edit_script'])

    await runAssistant({
      context: { episodeId: 'episode-1', interactionMode: 'plan' },
      text: '先给我计划',
    })

    expect(streamState.capturedToolNames).toContain('get_project_phase')
    expect(streamState.capturedToolNames).toContain('request_edit_first_choice')
    expect(streamState.capturedToolNames).not.toContain('generate_edit_script')
  })
})
