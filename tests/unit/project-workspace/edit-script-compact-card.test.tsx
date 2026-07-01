import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceCanvasNodeData, WorkspaceCanvasStreamPresentation } from '@/features/project-workspace/canvas/node-canvas-types'

vi.mock('@xyflow/react', () => ({
  Handle: (props: { readonly type?: string }) => createElement('span', { 'data-handle': props.type }),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

vi.mock('@/components/ui/ImagePreviewModal', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/task/EstimatedTaskProgressOverlay', () => ({
  EstimatedTaskProgressInline: () => null,
}))

vi.mock('@/components/media/MediaGenerationLoading', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: (props: {
    readonly src: string
    readonly alt: string
    readonly className?: string
    readonly containerClassName?: string
  }) => createElement('img', {
    src: props.src,
    alt: props.alt,
    className: [props.containerClassName, props.className].filter(Boolean).join(' '),
  }),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: (props: { readonly name?: string; readonly className?: string }) =>
    createElement('span', { 'data-icon': props.name, className: props.className }),
}))

vi.mock('@/features/project-workspace/canvas/details/EditScriptPreviewDetail', () => ({
  __esModule: true,
  default: () => null,
}))

const messages = {
  projectWorkflow: {
    canvas: {
      workspace: {
        nodeFields: {
          action: '动作',
          characters: '出场角色',
          collapseDetails: '收起',
          duration: '时长',
          editScriptCompactSummary: '{count} 个镜头',
          editScriptCompactSummaryWithCharacters: '{count} 个镜头 · 人物 {characters}',
          expandDetails: '展开',
          keyObjects: '关键物体',
          listSeparator: '、',
          noCharacters: '无角色',
          scene: '场景',
          shotIndex: '镜头 {index}',
          sound: '声音',
          viewVideoPreview: '查看视频预览',
        },
      },
    },
  },
} as const

const TestIntlProvider = NextIntlClientProvider as React.ComponentType<{
  readonly locale: string
  readonly messages: AbstractIntlMessages
  readonly timeZone: string
  readonly children?: React.ReactNode
}>

function editScriptNodeData(input?: {
  readonly expanded?: boolean
  readonly streamPresentation?: WorkspaceCanvasStreamPresentation
}): WorkspaceCanvasNodeData {
  return {
    nodeId: 'edit-script:episode-1',
    projectId: 'project-1',
    episodeName: 'Episode 1',
    kind: 'editScript',
    layoutNodeType: 'editScript',
    targetType: 'editScript',
    targetId: 'edit-script-1',
    title: '剪辑表',
    eyebrow: '核心剪辑表',
    body: '核心剪辑表摘要',
    meta: '2 个镜头',
    artifactPhase: 'succeeded',
    statusLabel: '成功',
    isRunning: false,
    width: 760,
    height: 360,
    expanded: input?.expanded ?? false,
    streamPresentation: input?.streamPresentation,
    onToggleExpanded: () => undefined,
    editScriptDetails: {
      screenplayText: '剧本文本',
      durationSec: 7,
      shotCount: 2,
      shots: [
        {
          shotNumber: 1,
          durationSec: 3,
          sceneName: '客厅深夜',
          action: '林晓低头检查手机。',
          characters: ['林晓 / visible / focus', '老陈 / hidden / hidden_subject'],
          keyObjects: ['手机 / clue'],
          imagePrompt: null,
          sound: '低频环境声。',
          imageUrl: null,
          videoUrl: null,
        },
        {
          shotNumber: 2,
          durationSec: 4,
          sceneName: '手机屏幕特写',
          action: '屏幕弹出警报。',
          characters: ['林晓 / visible / focus'],
          keyObjects: ['手机 / clue', '警报窗口 / plot_device'],
          imagePrompt: null,
          sound: '短促提示音。',
          imageUrl: null,
          videoUrl: null,
        },
      ],
    },
  }
}

async function renderEditScriptNode(data: WorkspaceCanvasNodeData): Promise<string> {
  Reflect.set(globalThis, 'React', React)
  const { default: WorkspaceNode } = await import('@/features/project-workspace/canvas/nodes/WorkspaceNode')
  return renderToStaticMarkup(
    createElement(
      TestIntlProvider,
      {
        locale: 'zh',
        messages: messages as unknown as AbstractIntlMessages,
        timeZone: 'Asia/Shanghai',
      },
      createElement(WorkspaceNode as React.ComponentType<{ readonly data: WorkspaceCanvasNodeData }>, { data }),
    ),
  )
}

describe('edit script compact canvas card', () => {
  it('renders the collapsed edit script card as shot count plus characters only', async () => {
    const html = await renderEditScriptNode(editScriptNodeData({ expanded: false }))

    expect(html).toContain('2 个镜头 · 人物 林晓、老陈')
    expect(html).toContain('展开')
    expect(html).not.toContain('手机屏幕特写')
    expect(html).not.toContain('远景')
  })

  it('shows compact shot cards and the streamed active detail while streaming', async () => {
    const html = await renderEditScriptNode(editScriptNodeData({
      expanded: false,
      streamPresentation: {
        isStreaming: true,
        activeItemKey: '2',
        displayedItemKeys: ['1', '2'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: {
          1: Number.MAX_SAFE_INTEGER,
          2: Number.MAX_SAFE_INTEGER,
        },
      },
    }))

    expect(html).toContain('data-icon="usersRound"')
    expect(html).toContain('手机屏幕特写')
    expect(html).toContain('短促提示音。')
    expect(html).toContain('workspace-node-stream-soft-detail')
  })
})
