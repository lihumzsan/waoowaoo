import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { createElement, type ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'
import {
  AssistantChoiceCardView,
  ConfirmationActionCard,
  isWorkspaceAssistantToolDetailsOpen,
  setWorkspaceAssistantToolDetailsOpen,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
import type { OperationPlanView } from '@/lib/operations/planning'
import { TASK_TYPE } from '@/lib/task/types'

const assistantMessages = {
  assistantAgent: {
    cards: {
      billingTaskCount: '{count} 个媒体生成任务',
      billingActionSummary: '生成 {items}',
      billingActionImageItems: '{count} 张图片',
      billingActionVideoItems: '{count} 个视频',
      billingActionMusicItems: '{count} 段音乐',
      billingActionMusicSecondItems: '{count} 秒音乐',
      billingActionVideoSecondItems: '{count} 秒视频',
      billingActionListSeparator: '、',
      billingActionQuoteWithCredits: '{action} · 预计消耗 {cost} credits',
      billingActionQuoteWithoutCredits: '将提交：{action}',
      billingQuoteWithCredits: '{count} 个媒体生成任务 · 预计消耗 {cost} credits',
      billingQuoteWithoutCredits: '将提交 {count} 个媒体生成任务',
      confirmContinue: '继续执行',
      cancelAction: '取消操作',
    },
  },
} as const

function renderWithIntl(node: React.ReactElement): string {
  const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
    locale: 'zh',
    messages: assistantMessages as unknown as AbstractIntlMessages,
    timeZone: 'Asia/Shanghai',
    children: node,
  }
  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps))
}

function buildOperationPlanView(): OperationPlanView {
  return {
    operationId: 'generate_edit_script_assets',
    kind: 'task_submission',
    taskCount: 3,
    tasks: [],
    quote: {
      showCredits: true,
      billingMode: 'ENFORCE',
      billable: true,
      taskCount: 3,
      mediaTaskCount: 3,
      totalMaxFrozenCost: 3.4128,
      currency: 'credits',
      items: [
        {
          id: 'task-1',
          taskType: TASK_TYPE.IMAGE_PANEL,
          targetType: 'storyboard_panel',
          targetId: 'panel-1',
          apiType: 'image',
          model: 'image-model',
          quantity: 3,
          unit: 'image',
          maxFrozenCost: 1.1376,
        },
        {
          id: 'task-2',
          taskType: TASK_TYPE.IMAGE_PANEL,
          targetType: 'storyboard_panel',
          targetId: 'panel-2',
          apiType: 'image',
          model: 'image-model',
          quantity: 3,
          unit: 'image',
          maxFrozenCost: 1.1376,
        },
        {
          id: 'task-3',
          taskType: TASK_TYPE.IMAGE_PANEL,
          targetType: 'storyboard_panel',
          targetId: 'panel-3',
          apiType: 'image',
          model: 'image-model',
          quantity: 3,
          unit: 'image',
          maxFrozenCost: 1.1376,
        },
      ],
    },
  }
}

describe('workspace assistant renderers', () => {
  it('keeps confirmation continue wider than cancel and carries the price suffix', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderWithIntl(
      createElement(ConfirmationActionCard, {
        operationId: 'generate_edit_script_assets',
        title: '生成分镜图片',
        subtitle: '提交前确认这次生成',
        operationPlan: buildOperationPlanView(),
        onConfirm: async () => undefined,
        onCancel: async () => undefined,
      }),
    )

    expect(html).toContain('继续执行')
    expect(html).toContain('取消操作')
    expect(html).toContain('生成 9 张图片')
    expect(html).not.toContain('3 个媒体生成任务')
    expect(html).toContain('3.41')
    expect(html).toContain('text-white/70')
    expect(html).toContain('flex-1 rounded-xl py-2 text-sm')
    expect(html).toContain('shrink-0 whitespace-nowrap rounded-xl')
    expect(html).not.toContain('flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-white')
  })

  it('keeps tool call detail expansion keyed by tool call id', () => {
    const toolCallId = 'tool-call-regression-expand'

    setWorkspaceAssistantToolDetailsOpen(toolCallId, false)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(false)

    setWorkspaceAssistantToolDetailsOpen(toolCallId, true)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(true)

    setWorkspaceAssistantToolDetailsOpen('tool-call-regression-other', true)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(true)

    setWorkspaceAssistantToolDetailsOpen(toolCallId, false)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(false)
  })

  it('does not render mutation batch undo controls for submitted task cards', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )
    const taskSubmittedCardSource = rendererSource.slice(
      rendererSource.indexOf('function TaskSubmittedDataCard'),
      rendererSource.indexOf('function TaskBatchSubmittedDataCard'),
    )
    const taskBatchSubmittedCardSource = rendererSource.slice(
      rendererSource.indexOf('function TaskBatchSubmittedDataCard'),
      rendererSource.indexOf('function isEditStylePreviewChoiceReady'),
    )

    expect(rendererSource).not.toContain('useRevertMutationBatch')
    expect(taskSubmittedCardSource).not.toContain('mutationBatchId')
    expect(taskBatchSubmittedCardSource).not.toContain('mutationBatchId')
    expect(taskSubmittedCardSource).not.toContain('undoCurrentChange')
    expect(taskBatchSubmittedCardSource).not.toContain('undoCurrentBatch')
  })

  it('renders required choice groups for confirm-or-reply choice cards', () => {
    const html = renderWithIntl(createElement(AssistantChoiceCardView, {
      data: {
        cardId: 'edit-first-bible-review',
        runId: 'run-1',
        interruptionId: null,
        toolCallId: 'tool-call-1',
        choiceType: 'bible_review',
        variant: 'confirm_or_reply',
        title: '确认剧集规划',
        description: '选择比例后确认',
        groups: [{
          key: 'aspectRatio',
          label: '画面比例',
          required: true,
          options: [
            { value: '9:16', label: '9:16' },
            { value: '16:9', label: '16:9' },
            { value: '21:9', label: '21:9' },
          ],
        }],
        submitLabel: '确认剧集规划',
        submit: { kind: 'submit_tool_output' },
        replyLabel: '需要修改',
        replyPlaceholder: '输入修改意见',
        replySubmitLabel: '提交修改意见',
        replyToolOutputKey: 'revisionNotes',
      },
      onSubmitChoiceResponse: async () => undefined,
      onConfirmEditStylePreviewChoice: async () => undefined,
    } satisfies ComponentProps<typeof AssistantChoiceCardView>))

    expect(html).toContain('画面比例')
    expect(html).toContain('9:16')
    expect(html).toContain('16:9')
    expect(html).toContain('21:9')
    expect(html).toContain('确认剧集规划')
  })
})
