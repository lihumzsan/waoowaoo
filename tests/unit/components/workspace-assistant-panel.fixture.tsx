import { createElement, type ComponentProps, type ComponentType, type ReactElement } from 'react'

import { readFileSync } from 'node:fs'

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderToStaticMarkup } from 'react-dom/server'

import { NextIntlClientProvider } from 'next-intl'

import type { AbstractIntlMessages } from 'next-intl'

import { createTranslator } from 'use-intl/core'

import {
  resolveWorkspaceAssistantExternalTaskOperationId,
  resolveWorkspaceAssistantRunFailureDetail,
  shouldSuppressWorkspaceAssistantOperationRunCard,
  shouldShowWorkspaceAssistantExternalTaskRunCard,
  shouldShowWorkspaceAssistantRunFailureNotice,
  shouldDockWorkspaceStylePreviewGenerationCard,
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
} from '@/features/project-workspace/components/workspace-assistant/panel-layout'

type ProgressTranslator = Parameters<typeof resolveProgressStageLabel>[1]

function buildStylePreview(overrides: Partial<ProjectEditStylePreview>): ProjectEditStylePreview {
  return {
    id: 'preview-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    bibleId: 'bible-1',
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

export { createElement } from 'react'
export type { ComponentProps, ComponentType, ReactElement } from 'react'
export { readFileSync } from 'node:fs'
export { join } from 'node:path'
export { describe, expect, it } from 'vitest'
export { renderToStaticMarkup } from 'react-dom/server'
export { NextIntlClientProvider } from 'next-intl'
export type { AbstractIntlMessages } from 'next-intl'
export { createTranslator } from 'use-intl/core'
export { resolveWorkspaceAssistantExternalTaskOperationId, resolveWorkspaceAssistantRunFailureDetail, shouldSuppressWorkspaceAssistantOperationRunCard, shouldShowWorkspaceAssistantExternalTaskRunCard, shouldShowWorkspaceAssistantRunFailureNotice, shouldDockWorkspaceStylePreviewGenerationCard, WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE } from '@/features/project-workspace/components/WorkspaceAssistantPanel'
export { resolveDisplayedEditStylePreviewItems, resolveEditStylePreviewCardStatus, resolveProgressStageLabel, WorkspaceAssistantToolCallCard, WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
export type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
export type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'
export type { ProjectEditStylePreview } from '@/types/project'
export { buildWorkspaceAssistantPanelLayout, clampWorkspaceAssistantPanelWidth, WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX, WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX, WORKSPACE_ASSISTANT_PANEL_WIDTH_PX } from '@/features/project-workspace/components/workspace-assistant/panel-layout'
export { assistantToolCallMessages, buildActivity, buildStylePreview, buildTaskState, createProgressTranslator, renderAssistantToolCallCard }
export type { ProgressTranslator }
