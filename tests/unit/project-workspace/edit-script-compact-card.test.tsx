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
          axisAndEyeline: '轴线与视线',
          cameraAngle: '拍摄角度',
          cameraHeight: '机位高度',
          characters: '出场角色',
          characterAsset: '需求人物',
          composition: '构图',
          collapseDetails: '收起',
          description: '描述',
          dialogue: '对白',
          duration: '时长',
          editScriptCompactSummary: '{count} 个镜头',
          editScriptCompactSummaryWithCharacters: '{count} 个镜头 · 人物 {characters}',
          expandDetails: '展开',
          keyObjects: '关键物体',
          lens: '焦段',
          lighting: '光线',
          listSeparator: '、',
          location: '地点',
          locationAsset: '需求场景',
          linkedShots: '关联镜头',
          locations: '场景',
          movement: '摄影运动',
          noCharacters: '无角色',
          acts: '幕',
          beats: '节拍',
          episodes: '集',
          sceneBody: '场景正文',
          scenes: '场景',
          scriptOverview: '剧本结构',
          scriptText: '剧本正文',
          scene: '场景',
          shotIndex: '镜头 {index}',
          shotScale: '景别',
          sound: '声音',
          timeOfDay: '时间',
          previewLarge: '查看大图',
          viewVideoPreview: '查看视频预览',
          focus: '焦点',
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
      bibleText: '剧本文本',
      durationSec: 7,
      shotCount: 2,
      shots: [
        {
          shotId: 'shot-1',
          shotNumber: 1,
          durationSec: 3,
          sceneName: '客厅深夜',
          action: '林晓低头检查手机。',
          characters: ['林晓 / visible / focus', '老陈 / hidden / hidden_subject'],
          keyObjects: ['手机 / clue'],
          imagePrompt: null,
          dialogue: ['林晓: 别出声。'],
          sound: '低频环境声。',
          imageUrl: null,
          videoUrl: null,
        },
        {
          shotId: 'shot-2',
          shotNumber: 2,
          durationSec: 4,
          sceneName: '手机屏幕特写',
          action: '屏幕弹出警报。',
          characters: ['林晓 / visible / focus'],
          keyObjects: ['手机 / clue', '警报窗口 / plot_device'],
          imagePrompt: null,
          dialogue: [],
          sound: '短促提示音。',
          imageUrl: null,
          videoUrl: null,
        },
      ],
    },
  }
}

function editBibleNodeData(input?: {
  readonly expanded?: boolean
}): WorkspaceCanvasNodeData {
  const disclosure = disclosureFor({
    kind: 'editBible',
    expanded: input?.expanded,
  })
  return {
    nodeId: 'edit-bible:episode-1',
    projectId: 'project-1',
    episodeName: 'Episode 1',
    kind: 'editBible',
    layoutNodeType: 'editBible',
    targetType: 'editBible',
    targetId: 'bible-1',
    title: '剧本创作',
    eyebrow: '源剧本',
    body: '完整剧本文本',
    meta: '',
    artifactPhase: 'succeeded',
    statusLabel: '成功',
    isRunning: false,
    width: 760,
    height: 360,
    disclosure,
    expanded: disclosure.effectiveExpanded,
    onToggleExpanded: () => undefined,
    editBibleDetails: {
      bibleText: '完整剧本文本。这里是全文，不应该在结构卡片展开态直接铺开。',
      scriptStructure: {
        version: 1,
        title: '地下实验',
        summary: '林在深夜启动装置，并发现实验代价。',
        episodes: [{
          episodeIndex: 0,
          title: '第一集：启动',
          summary: '林进入地下实验室，启动装置后听见未知回声。',
          acts: [{
            actIndex: 0,
            title: '第一幕：进入',
            summary: '林抵达实验室并确认实验目标。',
            scenes: [{
              sceneIndex: 0,
              title: '场景一：地下实验室',
              location: '地下实验室',
              timeOfDay: '夜',
              characters: ['林'],
              summary: '林启动装置，空间开始扭曲。',
              body: '场景一：地下实验室。林启动装置，空间开始扭曲。',
              beats: [{
                beatIndex: 0,
                title: '启动装置',
                summary: '林按下开关，实验进入不可逆状态。',
              }],
            }],
          }],
        }],
      },
      chapters: [],
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
          fields: [
            { label: '景别', value: '中远景' },
            { label: '焦段', value: '24mm 广角镜头' },
            { label: '焦点', value: '浅景深' },
            { label: '机位高度', value: '略高于视平线' },
            { label: '拍摄角度', value: '微俯视角度' },
            { label: '摄影运动', value: '缓慢推进' },
            { label: '构图', value: '窒息式不对称构图' },
            { label: '光线', value: '冷暖极度冲突' },
            { label: '轴线与视线', value: '前后纵深窥视对立' },
          ],
          body: '空间说明保留为字段网格里的描述。',
          chips: ['林晓 / visible', '黑影人 / hidden', '沙发', '手机'],
        },
        {
          title: '镜头 2 · 手机屏幕',
          fields: [
            { label: '景别', value: '特写' },
            { label: '焦段', value: '50mm 宏观镜头' },
            { label: '焦点', value: '极浅景深' },
            { label: '机位高度', value: '低于视平线' },
            { label: '拍摄角度', value: '垂直俯视' },
            { label: '摄影运动', value: '轻微手持抖动' },
            { label: '构图', value: '中心压迫构图' },
            { label: '光线', value: '屏幕冷蓝光' },
            { label: '轴线与视线', value: '垂直轴线' },
          ],
          body: '手机屏幕刺眼发光。',
          chips: ['林晓 / visible', '手机'],
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
          shotIds: ['shot-1', 'shot-2'],
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
          shotIds: ['shot-1', 'shot-2'],
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

  it('renders a structured source script as layered preview cards without the original request block', async () => {
    const html = await renderWorkspaceNode(editBibleNodeData({ expanded: true }))

    expect(html).toContain('剧本结构')
    expect(html).toContain('地下实验')
    expect(html).toContain('第一集：启动')
    expect(html).toContain('1 幕 · 1 场景')
    expect(html).toContain('剧本正文')
    expect(html).not.toContain('原始需求')
    expect(html).not.toContain('完整剧本文本。这里是全文，不应该在结构卡片展开态直接铺开。')
  })

  it('shows compact shot cards and the streamed active detail while streaming', async () => {
    const html = await renderWorkspaceNode(editScriptNodeData({
      expanded: false,
      streamPresentation: {
        isStreaming: true,
        activeItemKey: 'shot-2',
        displayedItemKeys: ['shot-1', 'shot-2'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: {
          'shot-1': Number.MAX_SAFE_INTEGER,
          'shot-2': Number.MAX_SAFE_INTEGER,
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

    expect(html).toContain('2 个镜头 · 人物 林晓、黑影人')
    expect(html).toContain('展开')
    expect(html).not.toContain('中远景 · 24mm 广角镜头')
  })

  it('renders the expanded shot execution plan as compact shot cards with a field grid', async () => {
    const html = await renderWorkspaceNode(editShotExecutionPlanNodeData({ expanded: true }))

    expect(html).toContain('中远景 · 24mm 广角镜头')
    expect(html).toContain('data-icon="usersRound"')
    expect(html).not.toContain('2 个镜头 · 人物 林晓、黑影人')
    expect(html).not.toContain('关联镜头')
    expect(html).not.toContain('border-cyan-500')
  })

  it('renders the streamed shot execution active item as a field grid', async () => {
    const html = await renderWorkspaceNode(editShotExecutionPlanNodeData({
      expanded: false,
      streamPresentation: {
        isStreaming: true,
        activeItemKey: '1',
        displayedItemKeys: ['1'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: {
          1: Number.MAX_SAFE_INTEGER,
        },
      },
    }))

    expect(html).toContain('中远景 · 24mm 广角镜头')
    expect(html).toContain('镜头 1')
    expect(html).toContain('浅景深')
    expect(html).toContain('轴线与视线')
    expect(html).toContain('border-slate-900')
    expect(html).toContain('bg-slate-900')
    expect(html).toContain('workspace-node-stream-soft-detail')
  })

  it('renders the completed asset group as two-column hero cards without the top description block', async () => {
    const html = await renderWorkspaceNode(editAssetGroupNodeData())

    expect(html).toContain('人物与场景')
    expect(html).toContain('林晓')
    expect(html).toContain('客厅')
    expect(html).toContain('grid-cols-2')
    expect(html).toContain('bg-gradient-to-t')
    expect(html).toContain('data-icon="chevronDown"')
    expect(html).not.toContain('林晓 / character')
    expect(html).not.toContain('>展开</button>')
  })
})
