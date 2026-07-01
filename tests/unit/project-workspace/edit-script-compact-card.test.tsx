import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceCanvasNodeData,
  WorkspaceCanvasNodeKind,
  WorkspaceCanvasStreamPresentation,
} from '@/features/project-workspace/canvas/node-canvas-types'
import { resolveWorkspaceCanvasNodeDisclosure } from '@/features/project-workspace/canvas/node-presentation-profiles'

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
          editAssetGroupCompactSummary: '{characters} 个人物 · {locations} 个场景',
          editScriptCompactSummary: '{count} 个镜头',
          editScriptCompactSummaryWithCharacters: '{count} 个镜头 · 人物 {characters}',
          expandDetails: '展开',
          keyObjects: '关键物体',
          listSeparator: '、',
          linkedShots: '关联镜头',
          locations: '场景',
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
  const streamPresentation = input?.streamPresentation
  const isStreaming = streamPresentation?.isStreaming === true
  const disclosure = resolveWorkspaceCanvasNodeDisclosure({
    kind: 'editScript',
    userExpandedOverride: input?.expanded,
    defaultExpanded: false,
    isStreaming,
  })
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
    artifactPhase: isStreaming ? 'running' : 'succeeded',
    statusLabel: isStreaming ? '处理中' : '成功',
    isRunning: isStreaming,
    width: 760,
    height: 360,
    disclosure,
    expanded: disclosure.effectiveExpanded,
    streamPresentation,
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

function disclosureFor(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly expanded?: boolean
  readonly streamPresentation?: WorkspaceCanvasStreamPresentation
}) {
  return resolveWorkspaceCanvasNodeDisclosure({
    kind: input.kind,
    userExpandedOverride: input.expanded,
    defaultExpanded: false,
    isStreaming: input.streamPresentation?.isStreaming === true,
  })
}

function editShotExecutionPlanNodeData(input?: {
  readonly expanded?: boolean
  readonly streamPresentation?: WorkspaceCanvasStreamPresentation
}): WorkspaceCanvasNodeData {
  const disclosure = disclosureFor({
    kind: 'editShotExecutionPlan',
    expanded: input?.expanded,
    streamPresentation: input?.streamPresentation,
  })
  return {
    nodeId: 'edit-shot-execution-plan:edit-script:1',
    projectId: 'project-1',
    episodeName: 'Episode 1',
    kind: 'editShotExecutionPlan',
    layoutNodeType: 'editShotExecutionPlan',
    targetType: 'editShotExecutionPlan',
    targetId: 'edit-script-1',
    title: '镜头执行计划',
    eyebrow: '摄影与空间执行',
    body: '2 个镜头 · 摄影执行计划',
    meta: '2 个镜头',
    artifactPhase: input?.streamPresentation?.isStreaming === true ? 'running' : 'succeeded',
    statusLabel: input?.streamPresentation?.isStreaming === true ? '处理中' : '成功',
    isRunning: input?.streamPresentation?.isStreaming === true,
    width: 760,
    height: 360,
    disclosure,
    expanded: disclosure.effectiveExpanded,
    streamPresentation: input?.streamPresentation,
    onToggleExpanded: () => undefined,
    editPipelineStepDetails: {
      items: [
        {
          title: '镜头 1 · 低角度推进',
          fields: [{ label: '运动', value: '缓慢推进' }],
          body: '镜头执行细节。',
          chips: ['1'],
        },
      ],
    },
  }
}

function editAssetGroupNodeData(input?: {
  readonly expanded?: boolean
}): WorkspaceCanvasNodeData {
  const disclosure = disclosureFor({
    kind: 'editAssetGroup',
    expanded: input?.expanded,
  })
  return {
    nodeId: 'edit-asset-group:edit-script-1',
    projectId: 'project-1',
    episodeName: 'Episode 1',
    kind: 'editAssetGroup',
    layoutNodeType: 'editAssetGroup',
    targetType: 'editAssetRequirement',
    targetId: 'edit-script-1',
    title: '资产需求',
    eyebrow: '人物与场景',
    body: '林晓 / character\n客厅 / location',
    meta: '2 个资产',
    artifactPhase: 'succeeded',
    statusLabel: '成功',
    isRunning: false,
    width: 720,
    height: 360,
    disclosure,
    expanded: disclosure.effectiveExpanded,
    onToggleExpanded: () => undefined,
    editAssetGroupDetails: {
      editScriptId: 'edit-script-1',
      assets: [
        {
          requirementId: 'asset-1',
          kind: 'character',
          name: '林晓',
          eyebrow: '主要人物',
          description: '年轻女性。',
          shotNumbers: [1, 2],
          statusLabel: '成功',
          isRunning: false,
          previewImageUrl: null,
          runtimeTarget: null,
          taskProgress: null,
        },
        {
          requirementId: 'asset-2',
          kind: 'location',
          name: '客厅',
          eyebrow: '主要场景',
          description: '深夜客厅。',
          shotNumbers: [1, 2],
          statusLabel: '成功',
          isRunning: false,
          previewImageUrl: null,
          runtimeTarget: null,
          taskProgress: null,
        },
      ],
    },
  }
}

async function renderWorkspaceNode(data: WorkspaceCanvasNodeData): Promise<string> {
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
    const html = await renderWorkspaceNode(editScriptNodeData({ expanded: false }))

    expect(html).toContain('2 个镜头 · 人物 林晓、老陈')
    expect(html).toContain('展开')
    expect(html).not.toContain('手机屏幕特写')
    expect(html).not.toContain('远景')
  })

  it('shows compact shot cards and the streamed active detail while streaming', async () => {
    const html = await renderWorkspaceNode(editScriptNodeData({
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

  it('renders the completed shot execution plan as a collapsible top-level summary', async () => {
    const html = await renderWorkspaceNode(editShotExecutionPlanNodeData({ expanded: false }))

    expect(html).toContain('2 个镜头 · 摄影执行计划')
    expect(html).toContain('展开')
    expect(html).not.toContain('镜头 1 · 低角度推进')
  })

  it('renders the completed asset group as a collapsible top-level summary', async () => {
    const html = await renderWorkspaceNode(editAssetGroupNodeData({ expanded: false }))

    expect(html).toContain('1 个人物 · 1 个场景')
    expect(html).toContain('展开')
    expect(html).not.toContain('年轻女性。')
  })
})
