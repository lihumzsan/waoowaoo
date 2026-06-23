import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { createEditScriptOperations } from '@/lib/operations/domains/media/edit-script-ops'
import { TASK_TYPE } from '@/lib/task/types'
import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
} from '@/lib/project-agent/edit-first-choice-tools'

const serviceMock = vi.hoisted(() => ({
  resolveEditDirectorDecoupageTaskTarget: vi.fn(async () => ({
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
  })),
  resolveEditCinematographyShotPlanTaskTarget: vi.fn(async () => ({
    episodeId: 'episode-1',
    editScriptId: 'edit-1',
  })),
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
    success: true,
    async: true,
    total: 1,
    taskIds: ['task-asset-1'],
    results: [{
      refId: 'req-1',
      taskId: 'task-asset-1',
      taskType: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
    }],
    submittedTasks: [{
      requirementId: 'req-1',
      kind: 'character',
      name: 'Pilot',
      taskId: 'task-asset-1',
      status: 'queued',
      runId: null,
      deduped: false,
      taskType: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
    }],
    editScript: {
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
    },
  })),
}))

const assetRevisionMock = vi.hoisted(() => ({
  reviseProjectEditScriptAssets: vi.fn(async () => ({
    success: true,
    async: true,
    total: 1,
    revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
    taskIds: ['task-asset-revision-1'],
    results: [{
      refId: 'req-1',
      taskId: 'task-asset-revision-1',
      taskType: 'modify_asset_image',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
    }],
    submittedTasks: [{
      requirementId: 'req-1',
      kind: 'character',
      name: 'Pilot',
      taskId: 'task-asset-revision-1',
      status: 'queued',
      runId: null,
      deduped: false,
      taskType: 'modify_asset_image',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
    }],
    editScript: {
      id: 'edit-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      title: 'Orbital Dock',
      durationSec: 30,
      shotCount: 6,
      status: 'ready',
      assetReviewStatus: 'pending',
      requirements: [
        { id: 'req-1', kind: 'character', name: 'Pilot', status: 'ready', targetId: 'character-1' },
      ],
      videoBlocks: [],
    },
  })),
}))

const taskSubmissionMock = vi.hoisted(() => ({
  submitProjectEditScreenplayGenerationTask: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-screenplay-1',
    runId: 'run-screenplay-1',
    status: 'queued',
    deduped: false,
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    taskType: 'edit_screenplay_generate',
    targetType: 'ProjectEditScreenplay',
    targetId: 'screenplay-1',
  })),
  submitProjectEditScreenplayRevisionTask: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-screenplay-revise-1',
    runId: 'run-screenplay-revise-1',
    status: 'queued',
    deduped: false,
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    taskType: 'edit_screenplay_revise',
    targetType: 'ProjectEditScreenplay',
    targetId: 'screenplay-1',
  })),
}))

vi.mock('@/lib/edit-script/service', () => serviceMock)
vi.mock('@/lib/edit-script/asset-revision', () => assetRevisionMock)
vi.mock('@/lib/edit-script/task-submission', async () => {
  const actual = await vi.importActual<typeof import('@/lib/edit-script/task-submission')>('@/lib/edit-script/task-submission')
  return {
    ...actual,
    submitProjectEditScreenplayGenerationTask: taskSubmissionMock.submitProjectEditScreenplayGenerationTask,
    submitProjectEditScreenplayRevisionTask: taskSubmissionMock.submitProjectEditScreenplayRevisionTask,
  }
})

const storyboardConsistencyServiceMock = vi.hoisted(() => ({
  submitEditScriptSpatialBlockingStoryboard: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-storyboard-1',
    runId: null,
    status: 'queued',
    deduped: false,
    editScriptId: 'edit-1',
    storyboardId: 'storyboard-1',
  })),
  submitEditScriptStoryboardPanels: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-panels-1',
    runId: null,
    status: 'queued',
    deduped: false,
    storyboardId: 'storyboard-1',
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

vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
  })),
}))

const choiceCardMock = vi.hoisted(() => ({
  buildEditFirstAssistantChoiceCard: vi.fn(async () => ({
    cardId: 'edit-first-duration-aspect-ratio',
    title: '选择短片时长和画面比例',
    groups: [
      {
        key: 'durationTier',
        label: '时长',
        required: true,
        options: [{ value: 'medium', label: '中 · 约 60 秒' }],
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

vi.mock('@/lib/project-agent/choice-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-agent/choice-card')>()
  return {
    ...actual,
    buildEditFirstAssistantChoiceCard: choiceCardMock.buildEditFirstAssistantChoiceCard,
  }
})

const interruptionMock = vi.hoisted(() => ({
  createProjectAgentChoiceInterruption: vi.fn(async () => 'choice-interruption-1'),
}))

vi.mock('@/lib/project-agent/interruptions', () => ({
  createProjectAgentChoiceInterruption: interruptionMock.createProjectAgentChoiceInterruption,
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
      runId: 'run-1',
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
    const expectedOperationIds = [
      'generate_edit_cinematography_shot_plan',
      'generate_edit_director_decoupage',
      'generate_edit_screenplay',
      'generate_edit_script',
      'generate_edit_script_assets',
      'generate_edit_script_storyboard',
      'generate_edit_script_storyboard_spatial_blocking',
      'generate_edit_style_previews',
      ...EDIT_FIRST_CHOICE_OPERATION_IDS,
      'revise_edit_script_assets',
      'revise_edit_screenplay',
    ].sort()

    expect(Object.keys(operations).sort()).toEqual(expectedOperationIds)
    expect(operations.generate_edit_script?.summary).toContain('director decoupage')
    expect(operations.generate_edit_script?.confirmation?.required).toBe(true)
    expect(operations.generate_edit_style_previews?.confirmation?.required).toBe(false)
    for (const operationId of EDIT_FIRST_CHOICE_OPERATION_IDS) {
      expect(operations[operationId]?.intent).toBe('query')
      expect(operations[operationId]?.agentFlow).toEqual({ interruptsFor: 'choice' })
    }
  })

  it('submits screenplay generation as an async screenplay task', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.generate_edit_screenplay.execute(buildContext(createTestWriter(writerEvents)), {
      prompt: 'make a short film',
      durationTier: 'medium',
      aspectRatio: '16:9',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-screenplay-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-1',
    }))
    expect(serviceMock.generateProjectEditScreenplay).not.toHaveBeenCalled()
    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      prompt: 'make a short film',
      durationTier: 'medium',
      aspectRatio: '16:9',
      source: 'assistant-panel',
      confirmed: true,
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-task-submitted',
        data: expect.objectContaining({
          operationId: 'generate_edit_screenplay',
          taskId: 'task-screenplay-1',
          taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
          targetType: 'ProjectEditScreenplay',
          targetId: 'screenplay-1',
        }),
      }),
    ])
  })

  it('does not forward free-form artStyle from agent screenplay generation into project style config', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a cyberpunk short film',
      durationTier: 'medium',
      aspectRatio: '16:9',
      confirmed: true,
      artStyle: 'cyberpunk',
    })

    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      prompt: 'make a cyberpunk short film',
      durationTier: 'medium',
      aspectRatio: '16:9',
    }))
    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).toHaveBeenCalledWith(expect.not.objectContaining({
      artStyle: expect.anything(),
    }))
  })

  it('keeps screenplay duration tier and aspect ratio as structured tool fields', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a vertical short film',
      durationTier: 'long',
      aspectRatio: '9:16',
      confirmed: true,
      videoRatio: '9:16',
    })

    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      prompt: 'make a vertical short film',
      durationTier: 'long',
      aspectRatio: '9:16',
    }))
    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).toHaveBeenCalledWith(expect.not.objectContaining({
      videoRatio: expect.anything(),
    }))
  })

  it('requires screenplay duration tier and aspect ratio in the structured tool schema', () => {
    const operations = createEditScriptOperations()

    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      durationTier: 'extra_long',
      aspectRatio: '16:9',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      durationTier: 'medium',
      aspectRatio: '4:3',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_screenplay.inputSchema.safeParse({
      prompt: 'make a short film',
      durationTier: 'medium',
      aspectRatio: '16:9',
      confirmed: true,
    }).success).toBe(true)
  })

  it('revises an edit-first screenplay during screenplay review with structured fields', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.revise_edit_screenplay.execute(buildContext(), {
      revisionInstruction: '改得更克苏鲁一些',
      durationTier: 'medium',
      aspectRatio: '16:9',
      screenplayId: 'screenplay-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-screenplay-revise-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      taskType: TASK_TYPE.EDIT_SCREENPLAY_REVISE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-1',
    }))
    expect(serviceMock.reviseProjectEditScreenplay).not.toHaveBeenCalled()
    expect(taskSubmissionMock.submitProjectEditScreenplayRevisionTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
      revisionInstruction: '改得更克苏鲁一些',
      durationTier: 'medium',
      aspectRatio: '16:9',
    }))
  })

  it('requires screenplay revision instruction, duration tier, and aspect ratio in the structured schema', () => {
    const operations = createEditScriptOperations()

    expect(operations.revise_edit_screenplay.inputSchema.safeParse({
      revisionInstruction: '改得更克苏鲁一些',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.revise_edit_screenplay.inputSchema.safeParse({
      revisionInstruction: '改得更克苏鲁一些',
      durationTier: 'medium',
      aspectRatio: '16:9',
      confirmed: true,
    }).success).toBe(true)
  })

  it('emits a fixed assistant choice card through the request choice operation', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations[EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio].execute(buildContext(createTestWriter(writerEvents)), {})

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
    expect(interruptionMock.createProjectAgentChoiceInterruption).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio,
      toolCallId: 'tool-call-choice',
      payload: expect.objectContaining({
        choiceType: 'duration_and_aspect_ratio',
        cardId: 'edit-first-duration-aspect-ratio',
        card: expect.objectContaining({
          cardId: 'edit-first-duration-aspect-ratio',
          runId: 'run-1',
        }),
      }),
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-assistant-choice-card',
        data: expect.objectContaining({
          cardId: 'edit-first-duration-aspect-ratio',
          toolCallId: 'tool-call-choice',
          runId: 'run-1',
          interruptionId: 'choice-interruption-1',
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

  it('does not use choiceType as a request choice input field', () => {
    const operations = createEditScriptOperations()

    expect(operations[EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio].inputSchema.safeParse({
      choiceType: 'next_step_confirmation',
    }).success).toBe(true)
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
    }))
    expect(operations.generate_edit_style_previews.inputSchema.safeParse({
      screenplayId: 'screenplay-1',
      count: 4,
      confirmed: true,
    }).success).toBe(false)
  })

  it('returns edit asset generation as a batch async task signal for assistant waits', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.generate_edit_script_assets.execute(buildContext(createTestWriter(writerEvents)), {
      editScriptId: 'edit-1',
      confirmed: true,
    }) as {
      results: Array<{
        refId: string
        taskId: string
        taskType: string
        targetType: string
        targetId: string
      }>
    }

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      total: 1,
      taskIds: ['task-asset-1'],
      editScript: expect.objectContaining({
        id: 'edit-1',
        requirements: [expect.objectContaining({
          id: 'req-1',
          status: 'generating',
        })],
      }),
    }))
    expect(result.results).toEqual([{
      refId: 'req-1',
      taskId: 'task-asset-1',
      taskType: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
    }])
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-task-batch-submitted',
        data: expect.objectContaining({
          operationId: 'generate_edit_script_assets',
          taskIds: ['task-asset-1'],
          results: [{
            refId: 'req-1',
            taskId: 'task-asset-1',
            taskType: TASK_TYPE.IMAGE_CHARACTER,
            targetType: 'CharacterAppearance',
            targetId: 'appearance-1',
          }],
        }),
      }),
    ])
    expect(serviceMock.generateProjectEditScriptAssets).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      editScriptId: 'edit-1',
    }))
  })

  it('rejects wildcard edit asset requirement ids so all-assets generation omits the field', () => {
    const operations = createEditScriptOperations()

    expect(operations.generate_edit_script_assets.inputSchema.safeParse({
      editScriptId: 'edit-1',
      requirementId: '*',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.generate_edit_script_assets.inputSchema.safeParse({
      editScriptId: 'edit-1',
      confirmed: true,
    }).success).toBe(true)
    expect(operations.generate_edit_script_assets.inputSchema.safeParse({
      editScriptId: 'edit-1',
      requirementId: 'req-1',
      confirmed: true,
    }).success).toBe(true)
  })

  it('submits asset review revision notes as edit asset image modification tasks', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.revise_edit_script_assets.execute(buildContext(createTestWriter(writerEvents)), {
      editScriptId: 'edit-1',
      revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      total: 1,
      revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
      taskIds: ['task-asset-revision-1'],
      editScript: expect.objectContaining({
        id: 'edit-1',
        assetReviewStatus: 'pending',
      }),
    }))
    expect(assetRevisionMock.reviseProjectEditScriptAssets).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      editScriptId: 'edit-1',
      revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-task-batch-submitted',
        data: expect.objectContaining({
          operationId: 'revise_edit_script_assets',
          taskIds: ['task-asset-revision-1'],
          results: [{
            refId: 'req-1',
            taskId: 'task-asset-revision-1',
            taskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
            targetType: 'CharacterAppearance',
            targetId: 'appearance-1',
          }],
        }),
      }),
    ])
  })

  it('requires concrete asset revision notes and rejects wildcard revision requirement ids', () => {
    const operations = createEditScriptOperations()

    expect(operations.revise_edit_script_assets.inputSchema.safeParse({
      editScriptId: 'edit-1',
      revisionNotes: '',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.revise_edit_script_assets.inputSchema.safeParse({
      editScriptId: 'edit-1',
      requirementId: '*',
      revisionNotes: '把角色改老一些',
      confirmed: true,
    }).success).toBe(false)
    expect(operations.revise_edit_script_assets.inputSchema.safeParse({
      editScriptId: 'edit-1',
      requirementId: 'req-1',
      revisionNotes: '把角色改老一些',
      confirmed: true,
    }).success).toBe(true)
  })

  it('submits director decoupage generation as an async screenplay task', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.generate_edit_director_decoupage.execute(buildContext(createTestWriter(writerEvents)), {
      screenplayId: 'screenplay-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-edit-script-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      taskType: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-1',
    }))
    expect(serviceMock.generateProjectEditDirectorDecoupage).not.toHaveBeenCalled()
    expect(serviceMock.resolveEditDirectorDecoupageTaskTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
    })
    expect(submitOperationTaskMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-1',
      operationId: 'generate_edit_director_decoupage',
      source: 'assistant-panel',
      confirmed: true,
      locale: 'zh',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        displayMode: 'detail',
      }),
      dedupeKey: 'edit_director_decoupage_generate:project-1:screenplay-1',
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-task-submitted',
        data: expect.objectContaining({
          operationId: 'generate_edit_director_decoupage',
          taskId: 'task-edit-script-1',
          taskType: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
          targetType: 'ProjectEditScreenplay',
          targetId: 'screenplay-1',
        }),
      }),
    ])
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
        analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
        maxInputTokens: 12_000,
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

  it('submits cinematography shot plan generation as an async edit-script task', async () => {
    const operations = createEditScriptOperations()
    const writerEvents: Record<string, unknown>[] = []
    const result = await operations.generate_edit_cinematography_shot_plan.execute(buildContext(createTestWriter(writerEvents)), {
      editScriptId: 'edit-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-edit-script-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      taskType: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
    }))
    expect(serviceMock.generateProjectEditCinematographyShotPlan).not.toHaveBeenCalled()
    expect(serviceMock.resolveEditCinematographyShotPlanTaskTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
    })
    expect(submitOperationTaskMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
      operationId: 'generate_edit_cinematography_shot_plan',
      source: 'assistant-panel',
      confirmed: true,
      locale: 'zh',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
        displayMode: 'detail',
      }),
      dedupeKey: 'edit_cinematography_shot_plan_generate:project-1:edit-1',
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-task-submitted',
        data: expect.objectContaining({
          operationId: 'generate_edit_cinematography_shot_plan',
          taskId: 'task-edit-script-1',
          taskType: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
          targetType: 'ProjectEditScript',
          targetId: 'edit-1',
        }),
      }),
    ])
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
      targetType: 'ProjectStoryboard',
      targetId: 'storyboard-1',
    }))
    expect(storyboardConsistencyServiceMock.submitEditScriptStoryboardPanels).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      locale: 'zh',
    }))
  })

  it('submits storyboard spatial blocking as the prerequisite async production task', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_script_storyboard_spatial_blocking.execute(buildContext(), {
      editScriptId: 'edit-1',
      confirmed: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-storyboard-1',
      episodeId: 'episode-1',
      taskType: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE,
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
    }))
    expect(storyboardConsistencyServiceMock.submitEditScriptSpatialBlockingStoryboard).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      locale: 'zh',
    }))
  })
})
