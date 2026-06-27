'use client'

import type { CardKit, CardSample } from './types'
import {
  DEMO_ACTIVE_RUN,
  DEMO_APPROVAL,
  DEMO_BATCH_TASK,
  DEMO_CHOICE,
  DEMO_CONFIRM,
  DEMO_PHASE,
  DEMO_PROJECT_CONTEXT,
  DEMO_STOP,
  DEMO_STYLE_PREVIEW,
  DEMO_TASK,
  DEMO_TOOL_FAILED,
  DEMO_TOOL_RUNNING,
  DEMO_TOOL_SUCCESS,
} from './types'

/**
 * 共享对话脚本 — 所有设计套用同一段剧情,保证横向对比公平。
 * 用户右对齐,助手内容左侧成列。
 */
export function KitConversation({ kit }: { kit: CardKit }) {
  const {
    AssistantText,
    Reasoning,
    ToolCall,
    ProjectPhase,
    ProjectContext,
    Choice,
    Approval,
    Confirm,
    StylePreview,
    TaskSubmitted,
    BatchTask,
    ActiveRun,
    AgentStop,
    Thinking,
    UserBubble,
  } = kit
  return (
    <div className="space-y-4">
      <UserBubble text="帮我把第 3 集的剧本做成 30 秒的竖屏短片。" />

      <div className="space-y-3">
        <AssistantText>好的,我先看一下当前项目和这一集的剧本结构,然后给出制作方案。</AssistantText>
        <ProjectContext {...DEMO_PROJECT_CONTEXT} />
        <ProjectPhase {...DEMO_PHASE} />
        <Reasoning text="目标:30 秒竖屏。需先确认画面比例与时长档位,再分析剧本结构、生成分镜,最后批量出片。" />
        <ToolCall {...DEMO_TOOL_RUNNING} />
        <ToolCall {...DEMO_TOOL_SUCCESS} />
      </div>

      <UserBubble text="比例你帮我选,要适合手机看的。" />

      <div className="space-y-3">
        <AssistantText>那我建议竖屏 9:16。请确认一下画面比例:</AssistantText>
        <Choice {...DEMO_CHOICE} />
        <AssistantText>顺便生成几个风格预览给你挑:</AssistantText>
        <StylePreview {...DEMO_STYLE_PREVIEW} />
        <Confirm {...DEMO_CONFIRM} />
      </div>

      <div className="space-y-3">
        <AssistantText>这一步会覆盖已有分镜,需要你确认:</AssistantText>
        <Approval {...DEMO_APPROVAL} />
        <ToolCall {...DEMO_TOOL_FAILED} />
      </div>

      <div className="space-y-3">
        <AssistantText>已重新提交生成任务,正在后台渲染:</AssistantText>
        <TaskSubmitted {...DEMO_TASK} />
        <BatchTask {...DEMO_BATCH_TASK} />
        <ActiveRun {...DEMO_ACTIVE_RUN} />
        <AgentStop {...DEMO_STOP} />
        <Thinking />
      </div>
    </div>
  )
}

/** 单卡画廊条目:横排对比时逐项渲染。 */
export const CARD_SAMPLES: readonly CardSample[] = [
  { id: 'user', title: '用户消息', render: (k) => <k.UserBubble text="帮我把这段剧本做成 30 秒竖屏短片。" /> },
  { id: 'assistant', title: '助手文本', render: (k) => <k.AssistantText>好的,我先分析剧本结构,再给出分镜与制作方案。</k.AssistantText> },
  { id: 'reasoning', title: '思考 / 推理', render: (k) => <k.Reasoning text="先确认画面比例与时长,再分析剧本结构并生成分镜。" /> },
  { id: 'project-context', title: '项目上下文', render: (k) => <k.ProjectContext {...DEMO_PROJECT_CONTEXT} /> },
  { id: 'phase', title: '项目进度', render: (k) => <k.ProjectPhase {...DEMO_PHASE} /> },
  { id: 'tool-running', title: '工具调用 · 执行中', render: (k) => <k.ToolCall {...DEMO_TOOL_RUNNING} /> },
  { id: 'tool-success', title: '工具调用 · 成功', render: (k) => <k.ToolCall {...DEMO_TOOL_SUCCESS} /> },
  { id: 'tool-failed', title: '工具调用 · 失败', render: (k) => <k.ToolCall {...DEMO_TOOL_FAILED} /> },
  { id: 'choice', title: '选择卡片', render: (k) => <k.Choice {...DEMO_CHOICE} /> },
  { id: 'style-preview', title: '风格预览生成', render: (k) => <k.StylePreview {...DEMO_STYLE_PREVIEW} /> },
  { id: 'confirm', title: '确认卡片', render: (k) => <k.Confirm {...DEMO_CONFIRM} /> },
  { id: 'approval', title: '审批卡片', render: (k) => <k.Approval {...DEMO_APPROVAL} /> },
  { id: 'task', title: '任务已提交', render: (k) => <k.TaskSubmitted {...DEMO_TASK} /> },
  { id: 'batch-task', title: '批量任务', render: (k) => <k.BatchTask {...DEMO_BATCH_TASK} /> },
  { id: 'active-run', title: '进行中 · 等待外部任务', render: (k) => <k.ActiveRun {...DEMO_ACTIVE_RUN} /> },
  { id: 'stop', title: '已停止 / 出错', render: (k) => <k.AgentStop {...DEMO_STOP} /> },
  { id: 'thinking', title: '生成指示器', render: (k) => <k.Thinking /> },
]
