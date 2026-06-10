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
      kind: 'set_project_video_ratio_and_send_message',
      projectId: 'project-1',
      messageTemplate: '我选择 {durationSeconds} 秒和 {aspectRatio} 画面比例，请继续。',
    },
  })),
}))

vi.mock('@/lib/project-agent/choice-card', () => ({
  buildEditFirstAssistantChoiceCard: choiceCardMock.buildEditFirstAssistantChoiceCard,
  readEditFirstDurationSeconds: (text: string) => {
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(秒|s|sec|secs|second|seconds|分钟|minute|minutes|min|mins)/i)
    if (!match) return null
    const value = Number(match[1])
    const unit = match[2] ?? ''
    return /分钟|minute|minutes|min|mins/i.test(unit) ? value * 60 : value
  },
  readEditFirstAspectRatio: (text: string) => {
    if (text.includes('9:16')) return '9:16'
    if (text.includes('16:9')) return '16:9'
    if (text.includes('21:9')) return '21:9'
    return null
  },
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
    ])
    expect(operations.generate_edit_script?.summary).toContain('director decoupage')
    expect(operations.generate_edit_script?.confirmation?.required).toBe(true)
    expect(operations.request_edit_first_choice?.intent).toBe('query')
  })

  it('passes context episode and locale into screenplay generation', async () => {
    const operations = createEditScriptOperations()
    const result = await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a 60 seconds 16:9 short film',
      confirmed: true,
    })

    const screenplay = result as { readonly id: string }
    expect(screenplay.id).toBe('screenplay-1')
    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      prompt: 'make a 60 seconds 16:9 short film',
    }))
  })

  it('does not forward free-form artStyle from agent screenplay generation into project style config', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a 60 seconds 16:9 cyberpunk short film',
      confirmed: true,
      artStyle: 'cyberpunk',
    })

    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      prompt: 'make a 60 seconds 16:9 cyberpunk short film',
    }))
    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.not.objectContaining({
      artStyle: expect.anything(),
    }))
  })

  it('does not forward aspect ratio from agent screenplay generation', async () => {
    const operations = createEditScriptOperations()
    await operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a 60 seconds 9:16 vertical short film',
      confirmed: true,
      videoRatio: '9:16',
    })

    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      prompt: 'make a 60 seconds 9:16 vertical short film',
    }))
    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.not.objectContaining({
      videoRatio: expect.anything(),
    }))
  })

  it('rejects screenplay generation when the prompt does not include explicit duration', async () => {
    const operations = createEditScriptOperations()

    await expect(operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a short film',
      confirmed: true,
    })).rejects.toThrow('EDIT_FIRST_DURATION_REQUIRED')
    expect(serviceMock.generateProjectEditScreenplay).not.toHaveBeenCalled()
  })

  it('rejects screenplay generation when the prompt duration exceeds two minutes', async () => {
    const operations = createEditScriptOperations()

    await expect(operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a 180 seconds 16:9 short film',
      confirmed: true,
    })).rejects.toThrow('EDIT_FIRST_DURATION_EXCEEDS_LIMIT:durationSeconds=180:maxSeconds=120')
    expect(serviceMock.generateProjectEditScreenplay).not.toHaveBeenCalled()
  })

  it('rejects screenplay generation when the prompt does not include explicit aspect ratio', async () => {
    const operations = createEditScriptOperations()

    await expect(operations.generate_edit_screenplay.execute(buildContext(), {
      prompt: 'make a 60 seconds short film',
      confirmed: true,
    })).rejects.toThrow('EDIT_FIRST_ASPECT_RATIO_REQUIRED')
    expect(serviceMock.generateProjectEditScreenplay).not.toHaveBeenCalled()
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
    }))
    expect(writerEvents).toEqual([
      expect.objectContaining({
        type: 'data-assistant-choice-card',
        data: expect.objectContaining({
          cardId: 'edit-first-duration-aspect-ratio',
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

  it('submits style preview generation after screenplay review', async () => {
    const operations = createEditScriptOperations()
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
