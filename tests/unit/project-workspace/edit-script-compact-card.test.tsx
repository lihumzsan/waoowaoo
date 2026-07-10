import {
  describe,
  editAssetGroupNodeData,
  editScriptNodeData,
  editShotExecutionPlanNodeData,
  expect,
  it,
  renderWorkspaceNode,
  sourceScriptNodeData,
  videoPlanNodeData,
} from './edit-script-compact-card.fixture'

describe('edit script compact canvas card', () => {
  it('renders the collapsed edit script card as shot count plus characters only', async () => {
    const html = await renderWorkspaceNode(editScriptNodeData({ expanded: false }))

    expect(html).toContain('2 个镜头 · 人物 林晓、老陈')
    expect(html).toContain('展开')
    expect(html).not.toContain('手机屏幕特写')
    expect(html).not.toContain('远景')
  })

  it('renders a structured source script as a horizontal scene grid without the original request block', async () => {
    const html = await renderWorkspaceNode(sourceScriptNodeData({ expanded: true }))

    // 方案 A：顶部概览条 + 集/幕分组 + 场景网格卡片（复用核心剪辑表 ShotGrid），不再有「剧本结构」小节标题。
    expect(html).toContain('地下实验')
    expect(html).toContain('1 集 · 1 场景')
    expect(html).toContain('第一集：启动')
    expect(html).toContain('1 幕 · 1 场景')
    expect(html).toContain('场景一：地下实验室')
    expect(html).toContain('grid-cols-3')
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

  it('keeps the sequence video model hint only on unfinished video plan nodes', async () => {
    const pendingHtml = await renderWorkspaceNode(videoPlanNodeData({
      outputUrl: null,
      assetReferenceVideoModel: null,
    }))
    const completedHtml = await renderWorkspaceNode(videoPlanNodeData({
      outputUrl: '/videos/group-1.mp4',
      assetReferenceVideoModel: null,
    }))

    expect(pendingHtml).toContain('请先在项目设置中选择视频片段生成模型。')
    expect(completedHtml).toContain('/videos/group-1.mp4')
    expect(completedHtml).not.toContain('请先在项目设置中选择视频片段生成模型。')
  })
})
