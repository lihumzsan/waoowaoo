import type { ComponentType, ReactNode } from 'react'
import type { AppIconName } from '@/components/ui/icons/registry'

/**
 * Agent Card Lab — 共享类型与模拟数据。
 *
 * 该目录是「设计对比」测试页面,用于横向评估 assistant 各类卡片的多套视觉方案。
 * 仅供设计走查使用,不接入真实运行时;文案为演示用的固定中文。
 */

export type CardTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger'

export type ToolCallStatus = 'running' | 'success' | 'failed' | 'needs-action'

export interface ToolCallData {
  readonly title: string
  readonly status: ToolCallStatus
  readonly args: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: string
}

export interface ApprovalData {
  readonly title: string
  readonly summary: string
  readonly reasons: readonly string[]
}

export interface ConfirmData {
  readonly title: string
  readonly subtitle: string
}

export interface ChoiceOption {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly ratio?: string
}

export interface ChoiceData {
  readonly title: string
  readonly description: string
  readonly groupLabel: string
  readonly step: string
  readonly options: readonly ChoiceOption[]
  readonly submitLabel: string
}

export interface TaskData {
  readonly title: string
  readonly taskId: string
  readonly stage: string
  readonly progress: number
}

export interface PhaseData {
  readonly clips: number
  readonly screenplays: number
  readonly storyboards: number
}

export interface StopData {
  readonly title: string
  readonly detail: string
}

/** 进行中 / 等待外部任务的「活跃运行」卡片(不确定进度,持续转圈)。 */
export interface ActiveRunData {
  readonly title: string
  readonly detail: string
}

export type StylePreviewStatus = 'generating' | 'done' | 'failed'

export interface StylePreviewCandidate {
  readonly id: string
  readonly label: string
  readonly progress: number
  readonly status: StylePreviewStatus
  readonly selected?: boolean
  /** 仅用于演示的占位缩略图渐变。 */
  readonly swatch: string
}

/** 风格预览生成卡片:多候选,每个独立进度。 */
export interface StylePreviewData {
  readonly title: string
  readonly candidates: readonly StylePreviewCandidate[]
}

/** 批量任务提交卡片。 */
export interface BatchTaskData {
  readonly title: string
  readonly total: number
  readonly taskIds: readonly string[]
}

/** 项目上下文卡片。 */
export interface ProjectContextData {
  readonly projectName: string
  readonly episodeName: string
  readonly status: string
}

/** 一套完整的卡片设计实现。每套设计独立实现以保证视觉差异化。 */
export interface CardKit {
  readonly id: string
  readonly label: string
  readonly blurb: string
  /** 选项卡上的强调色,纯展示用。 */
  readonly swatch: string
  readonly UserBubble: ComponentType<{ readonly text: string }>
  readonly AssistantText: ComponentType<{ readonly children: ReactNode }>
  readonly Reasoning: ComponentType<{ readonly text: string }>
  readonly Thinking: ComponentType
  readonly ToolCall: ComponentType<ToolCallData>
  readonly Approval: ComponentType<ApprovalData>
  readonly Confirm: ComponentType<ConfirmData>
  readonly Choice: ComponentType<ChoiceData>
  readonly TaskSubmitted: ComponentType<TaskData>
  readonly ProjectPhase: ComponentType<PhaseData>
  readonly AgentStop: ComponentType<StopData>
  readonly ActiveRun: ComponentType<ActiveRunData>
  readonly StylePreview: ComponentType<StylePreviewData>
  readonly BatchTask: ComponentType<BatchTaskData>
  readonly ProjectContext: ComponentType<ProjectContextData>
}

/** 单卡画廊里的一项。 */
export interface CardSample {
  readonly id: string
  readonly title: string
  readonly render: (kit: CardKit) => ReactNode
}

/* ------------------------------------------------------------------ */
/* 模拟数据 — 所有设计共用,保证横向对比公平                              */
/* ------------------------------------------------------------------ */

export const DEMO_TONE_BY_STATUS: Record<ToolCallStatus, CardTone> = {
  running: 'info',
  success: 'success',
  failed: 'danger',
  'needs-action': 'warn',
}

export const DEMO_TOOL_RUNNING: ToolCallData = {
  title: '分析剧本结构',
  status: 'running',
  args: { episodeId: 'ep_018', mode: 'structure', depth: 'full' },
}

export const DEMO_TOOL_SUCCESS: ToolCallData = {
  title: '生成分镜草稿',
  status: 'success',
  args: { sceneCount: 10, ratio: '9:16' },
  result: { storyboardId: 'sb_4471', shots: 10, durationSec: 30 },
}

export const DEMO_TOOL_FAILED: ToolCallData = {
  title: '渲染预览片段',
  status: 'failed',
  args: { clipId: 'clip_207', quality: 'preview' },
  error: '上游模型暂时不可用,请稍后重试 (code: PROVIDER_BUSY)。',
}

export const DEMO_APPROVAL: ApprovalData = {
  title: '需要审批',
  summary: '即将覆盖第 3 集已存在的 8 个分镜,此操作不可撤销。',
  reasons: ['目标剧集已有人工调整过的分镜', '本次会重写镜头时长与运镜参数'],
}

export const DEMO_CONFIRM: ConfirmData = {
  title: '批量生成视频片段',
  subtitle: '将为 10 个分镜并发提交生成任务,预计消耗 120 积分。',
}

export const DEMO_CHOICE: ChoiceData = {
  title: '选择画面比例',
  description: '不同比例适配不同的投放渠道,选定后将用于全片。',
  groupLabel: '画面比例',
  step: '2/2',
  options: [
    { value: '9:16', label: '9:16', description: '竖屏 · 适合手机优先', ratio: '9:16' },
    { value: '16:9', label: '16:9', description: '横屏 · 标准宽屏', ratio: '16:9' },
    { value: '1:1', label: '1:1', description: '方形 · 社交信息流', ratio: '1:1' },
  ],
  submitLabel: '继续',
}

export const DEMO_TASK: TaskData = {
  title: '任务已提交',
  taskId: 'task_9f31c2',
  stage: '排队中 · 等待生成节点',
  progress: 42,
}

export const DEMO_PHASE: PhaseData = {
  clips: 10,
  screenplays: 3,
  storyboards: 8,
}

export const DEMO_STOP: StopData = {
  title: '已停止',
  detail: '工具返回错误,已停止本轮执行。',
}

export const DEMO_ACTIVE_RUN: ActiveRunData = {
  title: '正在生成分镜画面',
  detail: '等待 3 个外部渲染任务完成,完成后自动继续…',
}

export const DEMO_STYLE_PREVIEW: StylePreviewData = {
  title: '生成风格预览',
  candidates: [
    { id: 'sp_1', label: '胶片颗粒', progress: 100, status: 'done', selected: true, swatch: 'linear-gradient(135deg,#d6a35c,#7a4a2b)' },
    { id: 'sp_2', label: '清新日系', progress: 68, status: 'generating', swatch: 'linear-gradient(135deg,#a7d8c8,#5b9bd5)' },
    { id: 'sp_3', label: '赛博霓虹', progress: 34, status: 'generating', swatch: 'linear-gradient(135deg,#7b5cff,#ff5ca8)' },
    { id: 'sp_4', label: '油画质感', progress: 0, status: 'failed', swatch: 'linear-gradient(135deg,#9aa0a6,#5f6368)' },
  ],
}

export const DEMO_BATCH_TASK: BatchTaskData = {
  title: '批量任务已提交',
  total: 10,
  taskIds: ['task_a1f2', 'task_b3c4', 'task_d5e6', 'task_f7a8', 'task_g9b0'],
}

export const DEMO_PROJECT_CONTEXT: ProjectContextData = {
  projectName: '最后的引力',
  episodeName: '第 3 集 · 坠落',
  status: '编辑中',
}

/* 状态 → 图标 的语义映射,各设计可复用 */
export const TONE_ICON: Record<CardTone, AppIconName> = {
  neutral: 'infoCircle',
  info: 'sparkles',
  success: 'badgeCheck',
  warn: 'alert',
  danger: 'alertSolid',
}
