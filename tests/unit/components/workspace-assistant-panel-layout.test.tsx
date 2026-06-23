import { createElement, type ComponentProps, type ComponentType, type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'
import { createTranslator } from 'use-intl/core'
import { WorkspaceAssistantCollapseHandle } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantCollapseHandle'
import { WorkspaceAssistantPanelRail } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantPanelRail'
import {
  resolveWorkspaceAssistantExternalTaskOperationId,
  shouldSuppressWorkspaceAssistantOperationRunCard,
  shouldShowWorkspaceAssistantExternalTaskRunCard,
  shouldDockWorkspaceStylePreviewGenerationCard,
  shouldDeferWorkspaceAssistantTaskFollowUp,
  WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE,
} from '@/features/project-workspace/components/WorkspaceAssistantPanel'
import {
  resolveDisplayedEditStylePreviewItems,
  resolveEditStylePreviewCardStatus,
  resolveProgressStageLabel,
  WorkspaceAssistantToolCallCard,
  WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'
import type { ProjectEditStylePreview } from '@/types/project'
import {
  buildWorkspaceAssistantPanelLayout,
  clampWorkspaceAssistantPanelWidth,
  WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX,
  WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX,
  WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
  WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
} from '@/features/project-workspace/components/workspace-assistant/panel-layout'

type ProgressTranslator = Parameters<typeof resolveProgressStageLabel>[1]

function buildStylePreview(overrides: Partial<ProjectEditStylePreview>): ProjectEditStylePreview {
  return {
    id: 'preview-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    styleKey: 'style_a',
    aspectRatio: '16:9',
    title: 'Style A',
    summary: 'A visual style.',
    styleBible: {},
    gridImagePrompt: 'Prompt',
    imageKey: null,
    imageUrl: null,
    status: 'generating',
    taskId: 'task-1',
    errorMessage: null,
    ...overrides,
  }
}

function buildTaskState(overrides: Partial<TaskTargetState>): TaskTargetState {
  return {
    targetType: 'ProjectEditStylePreview',
    targetId: 'preview-1',
    phase: 'processing',
    runningTaskId: 'task-1',
    runningTaskType: 'edit_style_preview_image',
    intent: 'process',
    hasOutputAtStart: null,
    progress: 45,
    stage: null,
    stageLabel: null,
    lastError: null,
    updatedAt: null,
    ...overrides,
  }
}

function buildActivity(overrides: Partial<ProjectAgentSessionActivity>): ProjectAgentSessionActivity {
  return {
    activityId: 'activity-1',
    runId: 'run-1',
    type: 'waiting_task',
    status: 'running',
    operationId: 'generate_edit_script',
    sourceOperationId: null,
    toolCallId: null,
    choiceType: null,
    ...overrides,
  }
}

function createProgressTranslator(messages: {
  stage?: Record<string, string>
}): ProgressTranslator {
  return createTranslator({
    locale: 'zh',
    namespace: 'progress',
    messages: {
      progress: messages,
    },
  }) as ProgressTranslator
}

const assistantToolCallMessages = {
  assistantAgent: {
    toolCall: {
      success: '成功',
      failed: '失败',
      needsAction: '待处理',
      running: '进行中',
      arguments: '参数',
      result: '结果',
      waiting: '等待工具返回结果...',
    },
    cards: {
      confirmationRequired: '需要确认',
    },
  },
} as const

function renderAssistantToolCallCard(props: Record<string, unknown>): string {
  const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
    locale: 'zh',
    messages: assistantToolCallMessages as unknown as AbstractIntlMessages,
    timeZone: 'Asia/Shanghai',
    children: createElement(
      WorkspaceAssistantToolCallCard as ComponentType<Record<string, unknown>>,
      props,
    ) as ReactElement,
  }

  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps))
}

describe('workspace assistant panel layout', () => {
  it('returns expanded width when panel is visible', () => {
    expect(buildWorkspaceAssistantPanelLayout(false)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
      railWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      translateXPx: 0,
      state: 'expanded',
    })
  })

  it('clamps custom expanded width into the supported resize range', () => {
    expect(buildWorkspaceAssistantPanelLayout(false, 640)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: 640,
      railWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      translateXPx: 0,
      state: 'expanded',
    })
    expect(clampWorkspaceAssistantPanelWidth(200)).toBe(WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX)
    expect(clampWorkspaceAssistantPanelWidth(1200)).toBe(WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX)
  })

  it('keeps the right-side overlay out of canvas layout when collapsed', () => {
    expect(buildWorkspaceAssistantPanelLayout(true)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      railWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      translateXPx: 0,
      state: 'collapsed',
    })
  })

  it('renders explicit floating collapse and expand controls for the sidebar rail', () => {
    const collapseHandleHtml = renderToStaticMarkup(
      createElement(WorkspaceAssistantCollapseHandle, {
        collapseLabel: 'Collapse AI assistant sidebar',
        onCollapse: () => undefined,
      }),
    )
    const railHtml = renderToStaticMarkup(
      createElement(WorkspaceAssistantPanelRail, {
        expandLabel: 'Expand AI assistant sidebar',
        onExpand: () => undefined,
      }),
    )

    expect(collapseHandleHtml).toContain('Collapse AI assistant sidebar')
    expect(collapseHandleHtml).toContain('lucide-chevron-right')
    expect(collapseHandleHtml).toContain('absolute')
    expect(collapseHandleHtml).toContain('right-4')
    expect(collapseHandleHtml).toContain('top-4')
    expect(collapseHandleHtml).toContain('h-10 w-10')
    expect(collapseHandleHtml).toContain('rounded-2xl')
    expect(collapseHandleHtml).not.toContain('fixed')
    expect(collapseHandleHtml).not.toContain('right:calc')
    expect(collapseHandleHtml).not.toContain('top:calc')
    expect(collapseHandleHtml).not.toContain('pointer-events-auto')
    expect(collapseHandleHtml).not.toContain('shrink-0')
    expect(collapseHandleHtml).not.toContain('h-14 w-6')
    expect(collapseHandleHtml).not.toContain('Workspace Chat')
    expect(collapseHandleHtml).not.toContain('View full raw context')
    expect(collapseHandleHtml).not.toContain('Download Log')
    expect(collapseHandleHtml).not.toContain('lucide-file-text')
    expect(collapseHandleHtml).not.toContain('lucide-download')
    expect(collapseHandleHtml).not.toContain('sticky')
    expect(collapseHandleHtml).not.toContain('top-0')
    expect(collapseHandleHtml).not.toContain('z-10')
    expect(railHtml).toContain('Expand AI assistant sidebar')
    expect(railHtml).toContain('lucide-chevron-left')
    expect(railHtml).not.toContain('Workspace Chat')
    expect(railHtml).not.toContain('lucide-sparkles')
  })

  it('keeps user messages as flat gray bubbles without border or shadow', () => {
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).toContain('bg-neutral-100')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('border')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('shadow')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('backdrop-blur')
  })

  it('fades scrolled messages near the top boundary instead of clipping them hard', () => {
    expect(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.maskImage).toBe(
      'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
    )
    expect(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.WebkitMaskImage).toBe(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.maskImage)
  })

  it('reserves only the inline area around the collapse control', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('float-right h-14 w-14')
    expect(panelSource).not.toContain('pr-16')
  })

  it('keeps SDK tool approval actions in the message stream without a duplicate pending action summary', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).not.toContain('pendingActionsTitle')
    expect(panelSource).not.toContain('pendingConfirmationChip')
    expect(rendererSource).toContain('ToolCallMessagePartProps')
    expect(rendererSource).toContain("toolStatus === 'requires-action'")
    expect(rendererSource).toContain('ConfirmationActionCard')
  })

  it('renders completed tool calls with ok=false as failed instead of successful', () => {
    const html = renderAssistantToolCallCard({
      toolName: 'request_edit_duration_aspect_ratio_choice',
      toolCallId: 'tool-call-choice-1',
      status: { type: 'complete' },
      args: {
        episodeId: 'episode-1',
      },
      result: {
        ok: false,
        error: {
          code: 'OPERATION_EXECUTION_FAILED',
          message: 'PROJECT_AGENT_ACTIVITY_OVERLAP',
        },
      },
    })

    expect(html).toContain('失败 · 选择时长与画幅')
    expect(html).toContain('PROJECT_AGENT_ACTIVITY_OVERLAP')
    expect(html).not.toContain('成功 · 选择时长与画幅')
  })

  it('uses server-side pending approval state instead of reviving persisted approval cards', () => {
    const runtimeSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime.ts'),
      'utf8',
    )

    expect(runtimeSource).not.toContain('pendingApprovalId: findPendingToolApprovalId')
    expect(runtimeSource).toContain('pendingApprovalId: pendingRunApproval?.approvalId ?? null')
  })

  it('resolves progress stage labels without crashing on missing translations', () => {
    const progressT = createProgressTranslator({
      stage: {
        editScriptVideoPrompt: '生成视频提示词',
      },
    })

    expect(resolveProgressStageLabel('progress.stage.editScriptVideoPrompt', progressT)).toBe('生成视频提示词')
    expect(resolveProgressStageLabel('progress.stage.missingStage', progressT)).toBe('MISSING_MESSAGE:progress.stage.missingStage')
    expect(resolveProgressStageLabel('外部阶段', progressT)).toBe('外部阶段')
  })

  it('marks style preview cards as failed when the preview record or task state fails', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({ status: 'failed', errorMessage: 'FAL balance exhausted' }),
      taskState: buildTaskState({ phase: 'processing' }),
    })).toBe('failed')
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({ status: 'generating' }),
      taskState: buildTaskState({
        phase: 'failed',
        lastError: {
          code: 'FORBIDDEN',
          message: 'Provider rejected the request',
        },
      }),
    })).toBe('failed')
  })

  it('marks style preview cards as completed only when a completed preview has an image', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({
        status: 'completed',
        imageUrl: 'https://example.test/style.png',
      }),
      taskState: buildTaskState({ phase: 'completed' }),
    })).toBe('completed')
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({
        status: 'completed',
        imageUrl: null,
      }),
      taskState: buildTaskState({ phase: 'completed' }),
    })).toBe('generating')
  })

  it('separates style preview loading state from active generation', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: null,
      taskState: undefined,
      loading: true,
    })).toBe('loading')
  })

  it('shows only the confirmed style preview after a visual style is selected', () => {
    const items = [
      {
        id: 'preview-a',
        styleKey: 'style_a',
        title: 'Style A',
        summary: 'A',
        taskId: 'task-a',
        aspectRatio: '16:9',
      },
      {
        id: 'preview-b',
        styleKey: 'style_b',
        title: 'Style B',
        summary: 'B',
        taskId: 'task-b',
        aspectRatio: '16:9',
      },
      {
        id: 'preview-c',
        styleKey: 'style_c',
        title: 'Style C',
        summary: 'C',
        taskId: 'task-c',
        aspectRatio: '16:9',
      },
    ] satisfies Parameters<typeof resolveDisplayedEditStylePreviewItems>[0]['items']
    const previewsById = new Map<string, ProjectEditStylePreview>([
      ['preview-a', buildStylePreview({ id: 'preview-a', status: 'completed' })],
      ['preview-b', buildStylePreview({ id: 'preview-b', status: 'confirmed' })],
      ['preview-c', buildStylePreview({ id: 'preview-c', status: 'completed' })],
    ])

    expect(resolveDisplayedEditStylePreviewItems({ items, previewsById })).toEqual([
      {
        id: 'preview-b',
        styleKey: 'style_b',
        title: 'Style B',
        summary: 'B',
        taskId: 'task-b',
        aspectRatio: '16:9',
      },
    ])
  })

  it('docks style preview generation only until the user confirms a style', () => {
    expect(shouldDockWorkspaceStylePreviewGenerationCard({
      hasCard: true,
      stylePreviewConfirmed: false,
    })).toBe(true)
    expect(shouldDockWorkspaceStylePreviewGenerationCard({
      hasCard: true,
      stylePreviewConfirmed: true,
    })).toBe(false)
    expect(shouldDockWorkspaceStylePreviewGenerationCard({
      hasCard: false,
      stylePreviewConfirmed: false,
    })).toBe(false)
  })

  it('suppresses only the generic style preview operation card once the docked generation card exists', () => {
    expect(shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: 'generate_edit_style_previews',
      stylePreviewGenerationDocked: true,
    })).toBe(true)
    expect(shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: 'generate_edit_script',
      stylePreviewGenerationDocked: true,
    })).toBe(false)
    expect(shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: 'generate_edit_style_previews',
      stylePreviewGenerationDocked: false,
    })).toBe(false)
  })

  it('shows the active run card only for external task waits', () => {
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: false,
      operationId: 'generate_edit_screenplay',
      stylePreviewGenerationDocked: false,
    })).toBe(true)
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: false,
      operationId: null,
      stylePreviewGenerationDocked: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: true,
      operationId: 'generate_edit_screenplay',
      stylePreviewGenerationDocked: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: false,
      operationId: 'generate_edit_style_previews',
      stylePreviewGenerationDocked: true,
    })).toBe(false)
  })

  it('renders external task waits from session-state through the unified active-run loading card', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('assistantRuntime.sessionState?.currentActivity')
    expect(panelSource).toContain('resolveWorkspaceAssistantExternalTaskOperationId(currentActivity)')
    expect(panelSource).toContain('showExternalTaskRunCard')
    expect(panelSource).toContain('<WorkspaceAssistantActiveRunCard operationId={activeExternalTaskOperationId} />')
    expect(panelSource).not.toContain('<WorkspaceAssistantActiveRunCard operationId={assistantRuntime.pendingOperationId} />')
    expect(panelSource).not.toContain('!assistantRuntime.pendingOperationId')
    expect(rendererSource).toContain("data.reason === 'awaiting_external_task'")

    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'waiting_task',
      status: 'running',
      operationId: 'generate_edit_script',
      sourceOperationId: null,
    }))).toBe('generate_edit_script')
    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'waiting_task',
      status: 'waiting',
      operationId: null,
      sourceOperationId: 'generate_edit_director_decoupage',
    }))).toBe('generate_edit_director_decoupage')
    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'operation',
      status: 'running',
      operationId: 'get_project_context',
    }))).toBeNull()
    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'waiting_task',
      status: 'completed',
      operationId: 'generate_edit_script',
    }))).toBeNull()
  })

  it('periodically claims resolved assistant waits to recover missed task events', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('WORKSPACE_ASSISTANT_WAIT_FOLLOW_UP_POLL_MS')
    expect(panelSource).toContain('window.setInterval')
    expect(panelSource).toContain('flushResolvedWaitFollowUps')
  })

  it('does not defer task follow-up only because the current run is awaiting an external task', () => {
    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'awaiting_task',
    })).toBe(false)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'streaming',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'awaiting_task',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: true,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'awaiting_task',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: 'approval-1',
      currentRunStatus: 'awaiting_task',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'running',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: null,
    })).toBe(false)
  })

  it('keeps style preview loading label scoped to the card namespace in supported locales', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )
    const zhMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh/assistantAgent.json'), 'utf8')) as {
      cards: {
        stylePreviewLoading?: string
        stylePreviewConfirmed?: string
      }
    }
    const enMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/en/assistantAgent.json'), 'utf8')) as {
      cards: {
        stylePreviewLoading?: string
        stylePreviewConfirmed?: string
      }
    }

    expect(rendererSource).toContain("t('cards.stylePreviewLoading')")
    expect(rendererSource).not.toContain("t('loading')")
    expect(zhMessages.cards.stylePreviewLoading).toBe('加载中...')
    expect(enMessages.cards.stylePreviewLoading).toBe('Loading...')
    expect(zhMessages.cards.stylePreviewConfirmed).toBe('已确认风格')
    expect(enMessages.cards.stylePreviewConfirmed).toBe('Style confirmed')
  })

  it('keeps project phase card summary free of runtime phase metadata', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )
    const projectPhaseCardSource = rendererSource.slice(
      rendererSource.indexOf('function ProjectPhaseDataCard'),
      rendererSource.indexOf('export function AgentStopDataCard'),
    )
    const zhMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh/assistantAgent.json'), 'utf8')) as {
      cards: {
        projectPhase?: string
        runs?: string
      }
    }
    const enMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/en/assistantAgent.json'), 'utf8')) as {
      cards: {
        projectPhase?: string
        runs?: string
      }
    }

    expect(projectPhaseCardSource).toContain("t('cards.projectPhase')")
    expect(projectPhaseCardSource).not.toContain('data.phase')
    expect(projectPhaseCardSource).not.toContain('activePlanRunCount')
    expect(projectPhaseCardSource).not.toContain("t('cards.runs'")
    expect(zhMessages.cards.projectPhase).toBe('项目阶段')
    expect(enMessages.cards.projectPhase).toBe('Project Phase')
    expect(zhMessages.cards.runs).toBeUndefined()
    expect(enMessages.cards.runs).toBeUndefined()
  })

  it('keeps edit script video prompt stage translated in supported locales', () => {
    const zhProgressSource = readFileSync(join(process.cwd(), 'messages/zh/progress.json'), 'utf8')
    const enProgressSource = readFileSync(join(process.cwd(), 'messages/en/progress.json'), 'utf8')

    expect(zhProgressSource).toContain('"editScriptVideoPrompt"')
    expect(enProgressSource).toContain('"editScriptVideoPrompt"')
  })

  it('keeps style preview image modal state outside the volatile generation card', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)')
    expect(panelSource).toContain('onPreviewImage: setPreviewImageUrl')
    expect(panelSource).toContain('onPreviewImage={setPreviewImageUrl}')
    expect(panelSource).toContain('<ImagePreviewModal imageUrl={previewImageUrl}')
    expect(rendererSource).toContain('onPreviewImage?: (imageUrl: string) => void')
    expect(rendererSource).toContain('props.onPreviewImage(imageUrl)')
    expect(rendererSource).not.toContain('onClick={() => setPreviewImageUrl(preview.imageUrl)}')
  })

  it('keeps estimated progress overlays from blurring generated card content', () => {
    const overlaySource = readFileSync(
      join(process.cwd(), 'src/components/task/EstimatedTaskProgressOverlay.tsx'),
      'utf8',
    )

    expect(overlaySource).toContain('pointer-events-none absolute inset-0')
    expect(overlaySource).not.toContain('backdrop-blur')
  })
})
