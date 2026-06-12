import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { createEditScriptOperations } from '@/lib/operations/domains/media/edit-script-ops'
import { TASK_TYPE } from '@/lib/task/types'

const serviceMock = vi.hoisted(() => ({
  generateProjectEditScreenplay: vi.fn(async () => ({
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'make a short film',
    screenplayText: 'INT. ORBITAL DOCK - NIGHT',
    status: 'screenplay_ready',
  })),
  reviseProjectEditScreenplay: vi.fn(async () => ({
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'make a short film',
    screenplayText: 'INT. ORBITAL DOCK - NIGHT\nCthulhu symbols pulse.',
    status: 'screenplay_ready',
  })),
  generateProjectEditStylePreviews: vi.fn(async () => ({
    success: true,
    async: true,
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    status: 'queued',
    total: 3,
    taskIds: ['task-style-a', 'task-style-b', 'task-style-c'],
    results: [
      { refId: 'style-preview-a', taskId: 'task-style-a' },
      { refId: 'style-preview-b', taskId: 'task-style-b' },
      { refId: 'style-preview-c', taskId: 'task-style-c' },
    ],
    stylePreviews: [
      { id: 'style-preview-a', styleKey: 'style_a', title: 'Style A', summary: 'Summary A', status: 'generating', taskId: 'task-style-a' },
      { id: 'style-preview-b', styleKey: 'style_b', title: 'Style B', summary: 'Summary B', status: 'generating', taskId: 'task-style-b' },
      { id: 'style-preview-c', styleKey: 'style_c', title: 'Style C', summary: 'Summary C', status: 'generating', taskId: 'task-style-c' },
    ],
  })),
  generateProjectEditDirectorDecoupage: vi.fn(async () => ({
    id: 'decoupage-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    status: 'ready',
    shots: [
      { shotNumber: 1 },
      { shotNumber: 2 },
    ],
  })),
  generateProjectEditScript: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    title: 'Orbital Dock',
    logline: 'A pilot lands.',
    durationSec: 30,
    shotCount: 6,
    status: 'ready',
    requirements: [],
    videoBlocks: [
      { kind: 'group', shotNumbers: [1, 2] },
      { kind: 'single', shotNumbers: [3] },
    ],
  })),
  generateProjectEditCinematographyShotPlan: vi.fn(async () => ({
    id: 'cinematography-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    editScriptId: 'edit-1',
    status: 'ready',
    shots: [
      { shotNumber: 1 },
      { shotNumber: 2 },
    ],
  })),
  generateProjectEditScriptAssets: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    title: 'Orbital Dock',
    durationSec: 30,
    shotCount: 6,
    status: 'ready',
    requirements: [
      { id: 'req-1', kind: 'character', name: 'Pilot', status: 'generating', targetId: 'character-1' },
    ],
    videoBlocks: [],
  })),
}))

vi.mock('@/lib/edit-script/service', () => serviceMock)

const storyboardConsistencyServiceMock = vi.hoisted(() => ({
  submitEditScriptSpatialBlockingStoryboard: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-storyboard-1',
    runId: null,
    status: 'queued',
    deduped: false,
  })),
  submitEditScriptStoryboardPanels: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-panels-1',
    runId: null,
    status: 'queued',
    deduped: false,
  })),
}))

vi.mock('@/lib/edit-script/storyboard-consistency/service', () => storyboardConsistencyServiceMock)

const submitOperationTaskMock = vi.hoisted(() => ({
  submitOperationTask: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-edit-script-1',
    runId: 'run-1',
    status: 'queued',
    deduped: false,
  })),
}))

vi.mock('@/lib/operations/submit-operation-task', () => submitOperationTaskMock)

const choiceCardMock = vi.hoisted(() => ({
  buildEditFirstAssistantChoiceCard: vi.fn(async () => ({
    cardId: 'edit-first-duration-aspect-ratio',
    title: '选择短片时长和画面比例',
    groups: [
      {
        key: 'durationSeconds',
        label: '时长',
        required: true,
        options: [{ value: '60', label: '60 秒' }],
      },
      {
        key: 'aspectRatio',
        label: '画面比例',
        required: true,
        options: [{ value: '16:9', label: '16:9' }],
      },
    ],
    submitLabel: '继续生成',
    submit: {
      kind: 'set_project_video_ratio',
      projectId: 'project-1',
    },
    toolCallId: 'tool-call-choice',
    choiceType: 'duration_and_aspect_ratio',
  })),
}))

vi.mock('@/lib/project-agent/choice-card', () => ({
  buildEditFirstAssistantChoiceCard: choiceCardMock.buildEditFirstAssistantChoiceCard,
}))

const workflowMock = vi.hoisted(() => ({
  resolveEditFirstWorkflowState: vi.fn(async () => ({
    active: true,
    stage: 'ready_to_generate_screenplay',
    blocking: {
      kind: 'needs_confirmation',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  })),
}))

vi.mock('@/lib/project-workflow/edit-first', () => ({
  resolveEditFirstWorkflowState: workflowMock.resolveEditFirstWorkflowState,
}))

function buildContext(writer: UIMessageStreamWriter<UIMessage> | null = null): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    source: 'assistant-panel',
    context: {
      locale: 'zh',
      episodeId: 'episode-1',
    },
    writer,
    toolCallId: 'tool-call-choice',
  }
}

function createTestWriter(events: Record<string, unknown>[]): UIMessageStreamWriter<UIMessage> {
  return {
    write: (chunk) => events.push(chunk as unknown as Record<string, unknown>),
    merge: vi.fn(),
    onError: vi.fn(),
  }
}

describe('edit-script operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes edit-first artifacts as independent operations', () => {
    const operations = createEditScriptOperations()

    expect(Object.keys(operations).sort()).toEqual([
      'generate_edit_cinematography_shot_plan',
      'generate_edit_director_decoupage',
      'generate_edit_screenplay',
      'generate_edit_script',
      'generate_edit_script_assets',
      'generate_edit_script_storyboard',
      'generate_edit_style_previews',
      'request_edit_first_choice',
      'revise_edit_screenplay',
    ])
    expect(operations.generate_edit_script?.summary).toContain('director decoupage')
    expect(operations.generate_edit_script?.confirmation?.required).toBe(true)
    expect(operations.request_edit_first_choice?.intent).toBe('query')
  })

  it('passes context episode and locale into screenplay generation', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a short film',
      durationSeconds: 60,
      aspectRatio: '16:9',
      confirmed: true,
    })

    const screenplay = result as { readonly id: string }
    expect(screenplay.id).toBe('screenplay-1')
    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      prompt: [
        'make a short film',
        '',
        '剪辑先行结构化参数：目标总时长 60 秒；最终画面比例 16:9。',
      ].join('\n'),
    }))
  })

  it('does not forward free-form artStyle from agent screenplay generation into project style config', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a cyberpunk short film',
      durationSeconds: 60,
      aspectRatio: '16:9',
      confirmed: true,
      artStyle: 'cyberpunk',
    })

    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      prompt: [
        'make a cyberpunk short film',
        '',
        '剪辑先行结构化参数：目标总时长 60 秒；最终画面比例 16:9。',
      ].join('\n'),
    }))
    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.not.objectContaining({
      artStyle: expect.anything(),
    }))
  })

  it('keeps screenplay duration and aspect ratio as structured tool fields', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a vertical short film',
      durationSeconds: 90,
      aspectRatio: '9:16',
      confirmed: true,
      videoRatio: '9:16',
    })

    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      prompt: [
        'make a vertical short film',
        '',
        '剪辑先行结构化参数：目标总时长 90 秒；最终画面比例 9:16。',
      ].join('\n'),
    }))
    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.not.objectContaining({
      videoRatio: expect.anything(),
    }))
  })

  it('requires screenplay duration and aspect ratio in the structured tool schema', () => {
    const operations = createEditScriptOperations()

    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      durationSeconds: 121,
      aspectRatio: '16:9',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      durationSeconds: 60,
      aspectRatio: '4:3',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      durationSeconds: 60,
      aspectRatio: '16:9',
      confirmed: true,
    }).success).toBe(true)
  })

  it('revises an edit-first screenplay during screenplay review with structured fields', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.revise_edit_screenplay.execute(buildContext(), {
      revisionInstruction: '改得更克苏鲁一些',
      durationSeconds: 60,
      aspectRatio: '16:9',
      screenplayId: 'screenplay-1',
      confirmed: true,
    })

    const screenplay = result as { readonly screenplayText: string; readonly status: string }
    expect(screenplay.status).toBe('screenplay_ready')
    expect(screenplay.screenplayText).toContain('Cthulhu')
    expect(serviceMock.reviseProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
      revisionInstruction: '改得更克苏鲁一些',
      durationSeconds: 60,
      aspectRatio: '16:9',
    }))
  })

  it('requires screenplay revision instruction, duration, and aspect ratio in the structured schema', () => {
    const operations = createEditScriptOperations()

    expect(operations.revise_edit_screenplay.inputSchema.safeParse({
      revisionInstruction: '改得更克苏鲁一些',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.revise_edit_screenplay.inputSchema.safeParse({
      revisionInstruction: '改得更克苏鲁一些',
      durationSeconds: 60,
      aspectRatio: '16:9',
      confirmed: true,
    }).success).toBe(true)
  })

  it('emits a fixed assistant choice card through the request choice operation', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.request_edit_first_choice.execute(buildContext(createTestWriter(writerEvents)), {
      choiceType: 'duration_and_aspect_ratio',
    })

    expect(workflowMock.resolveEditFirstWorkflowState).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
    expect(choiceCardMock.buildEditFirstAssistantChoiceCard).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-call-choice',
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-assistant-choice-card',
        data: expect.objectContaining({
          cardId: 'edit-first-duration-aspect-ratio',
          toolCallId: 'tool-call-choice',
        }),
      }),
    ])
    expect(result).toEqual({
      emitted: true,
      choiceType: 'duration_and_aspect_ratio',
      cardId: 'edit-first-duration-aspect-ratio',
      workflowStage: 'ready_to_generate_screenplay',
    })
  })

  it('rejects next-step confirmation as a structured request choice type', () => {
    const operations = createEditScriptOperations()

    expect(operations.request_edit_first_choice.inputSchema.safeParse({
      choiceType: 'next_step_confirmation',
    }).success).toBe(false)
  })

  it('submits style preview generation after screenplay review', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.generate_edit_style_previews.execute(buildContext(), {
      screenplayId: 'screenplay-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      screenplayId: 'screenplay-1',
      taskIds: ['task-style-a', 'task-style-b', 'task-style-c'],
      total: 3,
    }))
    expect(serviceMock.generateProjectEditStylePreviews).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
    }))
    await operations.generate_edit_style_previews.execute(buildContext(createTestWriter(writerEvents)), {
      screenplayId: 'screenplay-1',
      confirmed: true,
    })
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-edit-style-preview-generation',
        data: expect.objectContaining({
          operationId: 'generate_edit_style_previews',
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'style-preview-a',
              title: expect.any(String),
              taskId: 'task-style-a',
            }),
          ]),
        }),
      }),
    ])
  })

  it('passes flexible style preview regeneration fields into the style preview service', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_style_previews.execute(buildContext(), {
      screenplayId: 'screenplay-1',
      styleDirection: '更黑暗一些',
      count: 2,
      replaceExisting: true,
      confirmed: true,
    })

    expect(serviceMock.generateProjectEditStylePreviews).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
      styleDirection: '更黑暗一些',
      count: 2,
      replaceExisting: true,
    }))
    expect(operations.generate_edit_style_previews.inputSchema.safeParse({
      screenplayId: 'screenplay-1',
      count: 4,
      confirmed: true,
    }).success).toBe(false)
  })

  it('passes screenplay id into director decoupage generation', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_director_decoupage.execute(buildContext(), {
      screenplayId: 'screenplay-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      id: 'decoupage-1',
      shotCount: 2,
    }))
    expect(serviceMock.generateProjectEditDirectorDecoupage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
    }))
  })

  it('submits edit script generation as an async episode task', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_script.execute(buildContext(), {
      screenplayId: 'screenplay-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-edit-script-1',
      episodeId: 'episode-1',
    }))
    expect(serviceMock.generateProjectEditScript).not.toHaveBeenCalled()
    expect(submitOperationTaskMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      operationId: 'generate_edit_script',
      confirmed: true,
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
      }),
    }))
    expect(submitOperationTaskMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.not.objectContaining({
        prompt: expect.anything(),
      }),
    }))
  })

  it('does not forward free-form artStyle from agent edit script generation into task payload', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_script.execute(buildContext(), {
      screenplayId: 'screenplay-1',
      confirmed: true,
      artStyle: 'cyberpunk',
    })

    expect(submitOperationTaskMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
      }),
    }))
    expect(submitOperationTaskMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.not.objectContaining({
        artStyle: expect.anything(),
      }),
    }))
  })

  it('passes edit script id into cinematography shot plan generation', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_cinematography_shot_plan.execute(buildContext(), {
      editScriptId: 'edit-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      id: 'cinematography-1',
      shotCount: 2,
    }))
    expect(serviceMock.generateProjectEditCinematographyShotPlan).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      editScriptId: 'edit-1',
    }))
  })

  it('submits storyboard panel generation as an async production task', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_script_storyboard.execute(buildContext(), {
      editScriptId: 'edit-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-panels-1',
      episodeId: 'episode-1',
      taskType: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
    }))
    expect(storyboardConsistencyServiceMock.submitEditScriptStoryboardPanels).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      locale: 'zh',
    }))
  })
})
