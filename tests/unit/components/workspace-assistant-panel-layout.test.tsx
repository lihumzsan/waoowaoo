import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'use-intl/core'
import { WorkspaceAssistantCollapseHandle } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantCollapseHandle'
import { WorkspaceAssistantPanelRail } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantPanelRail'
import { WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE } from '@/features/project-workspace/components/WorkspaceAssistantPanel'
import {
  resolveEditStylePreviewCardStatus,
  resolveProgressStageLabel,
  WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
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

  it('keeps edit script video prompt stage translated in supported locales', () => {
    const zhProgressSource = readFileSync(join(process.cwd(), 'messages/zh/progress.json'), 'utf8')
    const enProgressSource = readFileSync(join(process.cwd(), 'messages/en/progress.json'), 'utf8')

    expect(zhProgressSource).toContain('"editScriptVideoPrompt"')
    expect(enProgressSource).toContain('"editScriptVideoPrompt"')
  })
})
