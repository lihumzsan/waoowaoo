'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChatStatus } from 'ai'
import { useLocale, useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
} from '@assistant-ui/react'
import {
  AssistantChoiceCardView,
  ConfirmationActionCard,
  WorkspaceAssistantActiveRunCard,
  EditStylePreviewGenerationDataCard,
  useWorkspaceAssistantMessagePartComponents,
  WorkspaceAssistantPendingTurnPlaceholder,
  WorkspaceAssistantThreadMessage,
} from './workspace-assistant/WorkspaceAssistantRenderers'
import { useWorkspaceAssistantRuntime, type WorkspaceAssistantChoiceType } from './workspace-assistant/useWorkspaceAssistantRuntime'
import { apiFetch } from '@/lib/api-fetch'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { TextAttachmentUploadDialog } from '@/components/project-assistant/TextAttachmentUploadDialog'
import { WorkspaceAssistantComposer } from './workspace-assistant/WorkspaceAssistantComposer'
import {
  buildWorkspaceAssistantPanelLayout,
  clampWorkspaceAssistantPanelWidth,
  WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
  WORKSPACE_ASSISTANT_TOP_OFFSET,
} from './workspace-assistant/panel-layout'
import {
  isWorkspaceAssistantSendMessageEvent,
  releaseWorkspaceAssistantMessageKey,
  reserveWorkspaceAssistantMessageKey,
  WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT,
} from './workspace-assistant/assistant-send-event'
import {
  collectAssistantAsyncTaskSubmissions,
  resolveAssistantAsyncTaskTerminalEvent,
} from './workspace-assistant/async-task-follow-up'
import {
  extractWorkspaceResourceChangesFromWriteResult,
  syncWorkspaceResourceChanges,
} from '@/lib/query/resource-change-sync'
import { useConfirmProjectEditStylePreview } from '@/lib/query/hooks'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import { queryKeys } from '@/lib/query/keys'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import type { WorkspaceAssistantSelectionContext } from '../canvas/ProjectWorkspaceCanvas'
import {
  isAssistantPermissionMode,
  type AssistantPermissionMode,
} from '@/lib/project-agent/permission-mode'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import type { ProjectAgentSessionActivity, ProjectAgentSessionState } from '@/lib/project-agent/session-state'
import type {
  WorkspaceAssistantActiveFocusRequest,
  WorkspaceAssistantActiveTaskTarget,
} from '../workspace-assistant-focus'

const WORKSPACE_ASSISTANT_WAIT_FOLLOW_UP_POLL_MS = 5000

interface ProjectAgentWaitFollowUp {
  runId: string | null
  waitId: string
  followUpKey: string
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
  failedTasks: Array<{
    taskId: string
    taskType: string | null
    targetType: string | null
    targetId: string | null
    status: string | null
    errorCode: string | null
    errorMessage: string | null
  }>
  terminalStatus: 'completed' | 'failed'
  total: number
  successCount: number
  failedCount: number
  claimId: string
}

interface ProjectAgentWaitFollowUpResponse {
  success: boolean
  followUps: ProjectAgentWaitFollowUp[]
}

interface WorkspaceAssistantPanelProps {
  projectId: string
  episodeId?: string
  selection?: WorkspaceAssistantSelectionContext
  autoStartDraft?: {
    readonly message: string
    readonly attachments: readonly ProjectAssistantTextAttachment[]
  } | null
  autoStartKey?: string | null
  onAutoStartConsumed?: () => void
  onActiveOperationChange?: (focusRequest: WorkspaceAssistantActiveFocusRequest | null) => void
  onStyleBibleConfirmed?: () => void
}

export function shouldDeferWorkspaceAssistantTaskFollowUp(input: {
  pending: boolean
  controlPending: boolean
  chatStatus: ChatStatus
  storageLoading: boolean
  pendingApprovalId: string | null
  currentRunStatus?: ProjectAgentRunPartData['status'] | null
}): boolean {
  if (input.storageLoading || input.pendingApprovalId) return true
  if (input.chatStatus === 'submitted' || input.chatStatus === 'streaming') return true
  if (input.controlPending) return true
  if (!input.pending) return false
  return input.currentRunStatus === 'running'
}

export function shouldPollWorkspaceAssistantWaitFollowUps(input: {
  storageLoading: boolean
  sessionState: {
    activeWaits: ReadonlyArray<Pick<ProjectAgentSessionState['activeWaits'][number], 'status'>>
  } | null
}): boolean {
  if (input.storageLoading) return false
  return Boolean(input.sessionState?.activeWaits.some((wait) => (
    wait.status === 'pending'
    || wait.status === 'resolved'
    || wait.status === 'claimed'
  )))
}

const WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY = 'workspace-assistant-panel-width'
const WORKSPACE_ASSISTANT_PERMISSION_MODE_STORAGE_KEY = 'workspace-assistant-permission-mode'
export const WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
} satisfies CSSProperties

export function shouldDockWorkspaceStylePreviewGenerationCard(params: {
  hasCard: boolean
  stylePreviewConfirmed: boolean
}): boolean {
  return params.hasCard && !params.stylePreviewConfirmed
}

export function shouldSuppressWorkspaceAssistantOperationRunCard(params: {
  operationId: string | null | undefined
  stylePreviewGenerationDocked: boolean
}): boolean {
  return params.stylePreviewGenerationDocked && params.operationId === 'generate_edit_style_previews'
}

export function shouldShowWorkspaceAssistantExternalTaskRunCard(params: {
  storageLoading: boolean
  operationId: string | null | undefined
  stylePreviewGenerationDocked: boolean
}): boolean {
  return !params.storageLoading
    && Boolean(params.operationId)
    && !shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: params.operationId,
      stylePreviewGenerationDocked: params.stylePreviewGenerationDocked,
    })
}

export function resolveWorkspaceAssistantExternalTaskOperationId(
  currentActivity: ProjectAgentSessionActivity | null,
): string | null {
  if (currentActivity?.type !== 'waiting_task') return null
  if (currentActivity.status !== 'running' && currentActivity.status !== 'waiting') return null
  return currentActivity.operationId ?? currentActivity.sourceOperationId
}

function buildWorkspaceAssistantActiveTaskTarget(input: {
  readonly taskId: string | null | undefined
  readonly operationId: string | null
  readonly taskType: string | null | undefined
  readonly targetType: string | null | undefined
  readonly targetId: string | null | undefined
  readonly sourceKind?: string | null
}): WorkspaceAssistantActiveTaskTarget | null {
  const targetType = input.targetType?.trim()
  const targetId = input.targetId?.trim()
  const taskId = input.taskId?.trim()
  if (!taskId || !targetType || !targetId) return null
  const taskType = input.taskType?.trim()
  const operationId = input.operationId?.trim() || null
  return {
    taskId,
    targetType,
    targetId,
    ...(taskType ? { types: [taskType] } : {}),
    ...(operationId ? { operationId } : {}),
    ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
  }
}

function dedupeWorkspaceAssistantActiveTaskTargets(
  targets: readonly WorkspaceAssistantActiveTaskTarget[],
): readonly WorkspaceAssistantActiveTaskTarget[] {
  const byKey = new Map<string, WorkspaceAssistantActiveTaskTarget>()
  targets.forEach((target) => {
    byKey.set([
      target.operationId ?? '',
      target.taskId,
      target.targetType,
      target.targetId,
      (target.types ?? []).join(','),
      target.sourceKind ?? '',
    ].join(':'), target)
  })
  return Array.from(byKey.values())
}

export function shouldShowWorkspaceAssistantReplyLoading(params: {
  storageLoading: boolean
  replyInFlight: boolean
  awaitingUserInput: boolean
  awaitingExternalTask: boolean
}): boolean {
  return !params.storageLoading
    && params.replyInFlight
    && !params.awaitingUserInput
    && !params.awaitingExternalTask
}

export function shouldShowWorkspaceAssistantRunFailureNotice(params: {
  storageLoading: boolean
  replyInFlight: boolean
  currentRunStatus?: ProjectAgentRunPartData['status'] | null
}): boolean {
  return !params.storageLoading
    && !params.replyInFlight
    && params.currentRunStatus === 'failed'
}

export function resolveWorkspaceAssistantRunFailureDetail(params: {
  errorMessage?: string | null
  errorCode?: string | null
  fallback: string
}): string {
  const errorMessage = params.errorMessage?.trim()
  if (errorMessage) return errorMessage
  const errorCode = params.errorCode?.trim()
  if (errorCode) return errorCode
  return params.fallback
}

export function resolveWorkspaceAssistantAwaitingUserInput(params: {
  replyInFlight: boolean
  hasPendingInteraction: boolean
}): boolean {
  return !params.replyInFlight && params.hasPendingInteraction
}

export function resolveWorkspaceAssistantAwaitingExternalTask(params: {
  replyInFlight: boolean
  currentRunStatus?: ProjectAgentRunPartData['status'] | null
  activeExternalTaskOperationId?: string | null
}): boolean {
  return !params.replyInFlight && (
    params.currentRunStatus === 'awaiting_task'
      || Boolean(params.activeExternalTaskOperationId)
  )
}

function WorkspaceAssistantRunFailureNotice({
  run,
}: {
  run: Pick<NonNullable<ProjectAgentSessionState['currentRun']>, 'errorCode' | 'errorMessage'> | null
}) {
  const t = useTranslations('assistantAgent')
  const detail = resolveWorkspaceAssistantRunFailureDetail({
    errorMessage: run?.errorMessage ?? null,
    errorCode: run?.errorCode ?? null,
    fallback: t('panel.runFailedDetail'),
  })
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-[12px] leading-5 text-[var(--glass-tone-warn-fg)]"
    >
      <AppIcon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{t('panel.runFailedTitle')}</div>
        <div className="break-words text-[11px] leading-4 opacity-80">{detail}</div>
      </div>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readAssistantToolOutput(part: unknown): unknown | null {
  if (!isRecord(part)) return null
  const type = typeof part.type === 'string' ? part.type : ''
  if (type !== 'dynamic-tool' && !type.startsWith('tool-')) return null
  if (part.state !== 'output-available') return null
  return 'output' in part ? part.output : null
}

function readStoredAssistantPanelWidth(): number {
  if (typeof window === 'undefined') return WORKSPACE_ASSISTANT_PANEL_WIDTH_PX
  const storedValue = window.localStorage.getItem(WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY)
  if (!storedValue) return WORKSPACE_ASSISTANT_PANEL_WIDTH_PX
  const parsedValue = Number(storedValue)
  return Number.isFinite(parsedValue)
    ? clampWorkspaceAssistantPanelWidth(parsedValue)
    : WORKSPACE_ASSISTANT_PANEL_WIDTH_PX
}

function readStoredAssistantPermissionMode(): AssistantPermissionMode {
  if (typeof window === 'undefined') return 'ask'
  const storedValue = window.localStorage.getItem(WORKSPACE_ASSISTANT_PERMISSION_MODE_STORAGE_KEY)
  return isAssistantPermissionMode(storedValue) ? storedValue : 'ask'
}

export default function WorkspaceAssistantPanel({
  projectId,
  episodeId,
  selection,
  autoStartDraft,
  autoStartKey,
  onAutoStartConsumed,
  onActiveOperationChange,
  onStyleBibleConfirmed,
}: WorkspaceAssistantPanelProps) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const queryClient = useQueryClient()
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const confirmEditStylePreview = useConfirmProjectEditStylePreview(projectId)
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(readStoredAssistantPanelWidth)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStateRef = useRef<{
    startX: number
    startWidth: number
    currentWidth: number
  } | null>(null)
  const layout = buildWorkspaceAssistantPanelLayout(assistantPanelWidth)
  const [composerText, setComposerText] = useState('')
  const [composerAttachments, setComposerAttachments] = useState<ProjectAssistantTextAttachment[]>([])
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false)
  const [stylePreviewDockCollapsed, setStylePreviewDockCollapsed] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [assistantPermissionMode, setAssistantPermissionModeState] = useState<AssistantPermissionMode>(
    readStoredAssistantPermissionMode,
  )
  const setAssistantPermissionMode = useCallback((mode: AssistantPermissionMode) => {
    setAssistantPermissionModeState(mode)
    window.localStorage.setItem(WORKSPACE_ASSISTANT_PERMISSION_MODE_STORAGE_KEY, mode)
  }, [])
  const assistantRuntime = useWorkspaceAssistantRuntime({
    projectId,
    episodeId,
    selectedScopeRef: selection?.selectedScopeRef ?? null,
    selectedPanelId: selection?.selectedPanelId ?? null,
    selectedAssetId: selection?.selectedAssetId ?? null,
    assistantPermissionMode,
  })
  const assistantRuntimeRef = useRef(assistantRuntime)
  const syncedAssistantToolOutputKeysRef = useRef<Set<string>>(new Set())
  const queuedTaskFollowUpsRef = useRef<Array<{ runId: string; waitId: string; claimId: string }>>([])
  useEffect(() => {
    assistantRuntimeRef.current = assistantRuntime
  }, [assistantRuntime])
  useEffect(() => {
    const pendingSyncs: Promise<unknown>[] = []
    for (const message of assistantRuntime.messages) {
      message.parts.forEach((part, partIndex) => {
        const output = readAssistantToolOutput(part)
        if (output === null) return
        const partRecord: Record<string, unknown> | null = isRecord(part) ? part : null
        const toolCallId = typeof partRecord?.toolCallId === 'string' ? partRecord.toolCallId : null
        const key = toolCallId
          ? `${message.id}:${toolCallId}`
          : `${message.id}:part:${String(partIndex)}`
        if (syncedAssistantToolOutputKeysRef.current.has(key)) return
        const changes = extractWorkspaceResourceChangesFromWriteResult({
          result: output,
          projectId,
          fallbackEpisodeId: episodeId ?? null,
        })
        if (changes.length === 0) return
        syncedAssistantToolOutputKeysRef.current.add(key)
        pendingSyncs.push(syncWorkspaceResourceChanges({
          queryClient,
          changes,
        }))
      })
    }
    if (pendingSyncs.length === 0) return
    void Promise.all(pendingSyncs)
  }, [assistantRuntime.messages, episodeId, projectId, queryClient])
  // Claimed follow-ups are consumed exactly once by the chat endpoint
  // (task_follow_up control). If sending fails, the claim simply expires
  // server-side and the wait becomes claimable again — no local bookkeeping.
  const sendTaskFollowUp = useCallback(async (followUp: { runId: string; waitId: string; claimId: string }) => {
    const runtime = assistantRuntimeRef.current
    if (shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: runtime.pending,
      controlPending: runtime.controlPending,
      chatStatus: runtime.status,
      storageLoading: runtime.storageLoading,
      pendingApprovalId: runtime.pendingApprovalId,
      currentRunStatus: runtime.sessionState?.currentRun?.status ?? null,
    })) {
      queuedTaskFollowUpsRef.current = [...queuedTaskFollowUpsRef.current, followUp]
      return
    }
    await runtime.submitTaskFollowUp(followUp)
  }, [])
  useEffect(() => {
    if (shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: assistantRuntime.pending,
      controlPending: assistantRuntime.controlPending,
      chatStatus: assistantRuntime.status,
      storageLoading: assistantRuntime.storageLoading,
      pendingApprovalId: assistantRuntime.pendingApprovalId,
      currentRunStatus: assistantRuntime.sessionState?.currentRun?.status ?? null,
    })) return
    const [queuedFollowUp, ...remainingFollowUps] = queuedTaskFollowUpsRef.current
    if (!queuedFollowUp) return
    queuedTaskFollowUpsRef.current = remainingFollowUps
    void assistantRuntime.submitTaskFollowUp(queuedFollowUp)
  }, [
    assistantRuntime,
    assistantRuntime.controlPending,
    assistantRuntime.pending,
    assistantRuntime.pendingApprovalId,
    assistantRuntime.sessionState?.currentRun?.status,
    assistantRuntime.status,
    assistantRuntime.storageLoading,
  ])
  const flushResolvedWaitFollowUps = useCallback(async () => {
    const runtime = assistantRuntimeRef.current
    if (shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: runtime.pending,
      controlPending: runtime.controlPending,
      chatStatus: runtime.status,
      storageLoading: runtime.storageLoading,
      pendingApprovalId: runtime.pendingApprovalId,
      currentRunStatus: runtime.sessionState?.currentRun?.status ?? null,
    })) return
    const response = await apiFetch(`/api/projects/${projectId}/assistant/waits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        ...(episodeId ? { episodeId } : {}),
      }),
    })
    if (!response.ok) return
    const payload = await response.json().catch(() => null) as ProjectAgentWaitFollowUpResponse | null
    if (!payload?.success || !Array.isArray(payload.followUps)) return
    for (const followUp of payload.followUps) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      if (episodeId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
      }
      if (!followUp.runId) continue
      await sendTaskFollowUp({
        runId: followUp.runId,
        waitId: followUp.waitId,
        claimId: followUp.claimId,
      })
    }
  }, [episodeId, projectId, queryClient, sendTaskFollowUp])
  const shouldPollWaitFollowUps = shouldPollWorkspaceAssistantWaitFollowUps({
    storageLoading: assistantRuntime.storageLoading,
    sessionState: assistantRuntime.sessionState,
  })
  useEffect(() => {
    if (!shouldPollWaitFollowUps) return
    void flushResolvedWaitFollowUps()
  }, [flushResolvedWaitFollowUps, shouldPollWaitFollowUps])
  useEffect(() => {
    if (!shouldPollWaitFollowUps) return
    const timer = window.setInterval(() => {
      void flushResolvedWaitFollowUps()
    }, WORKSPACE_ASSISTANT_WAIT_FOLLOW_UP_POLL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [flushResolvedWaitFollowUps, shouldPollWaitFollowUps])
  useEffect(() => {
    return subscribeTaskEvents((event) => {
      const terminalEvent = resolveAssistantAsyncTaskTerminalEvent(event)
      if (!terminalEvent) return
      const runtime = assistantRuntimeRef.current
      if (!shouldPollWorkspaceAssistantWaitFollowUps({
        storageLoading: runtime.storageLoading,
        sessionState: runtime.sessionState,
      })) return
      void flushResolvedWaitFollowUps()
    })
  }, [flushResolvedWaitFollowUps, subscribeTaskEvents])
  const consumedMessageKeysRef = useRef<Set<string>>(new Set())
  const sendAssistantMessageOnce = useCallback(async (
    key: string,
    message: string,
    hidden = false,
    attachments: readonly ProjectAssistantTextAttachment[] = [],
  ) => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage && attachments.length === 0) return
    const reservedKey = reserveWorkspaceAssistantMessageKey(key, consumedMessageKeysRef.current)
    if (!reservedKey) return
    try {
      if (hidden) {
        await assistantRuntime.sendHiddenMessage(normalizedMessage)
      } else {
        await assistantRuntime.sendMessage({
          text: normalizedMessage,
          attachments,
        })
      }
    } catch (error) {
      releaseWorkspaceAssistantMessageKey(reservedKey, consumedMessageKeysRef.current)
      throw error
    }
  }, [assistantRuntime])
  const handleComposerSubmit = useCallback(async () => {
    const normalizedText = composerText.trim()
    if (!normalizedText && composerAttachments.length === 0) return
    // 发消息时把底部停靠的视觉风格卡收成细条，避免大卡占满底部、把刚发的消息顶出视口
    setStylePreviewDockCollapsed(true)
    setComposerText('')
    setComposerAttachments([])
    try {
      await assistantRuntime.sendMessage({
        text: normalizedText,
        attachments: composerAttachments,
      })
    } catch (error) {
      setComposerText(normalizedText)
      setComposerAttachments([...composerAttachments])
      throw error
    }
  }, [assistantRuntime, composerAttachments, composerText])
  const handleAttachmentUploaded = useCallback((attachment: ProjectAssistantTextAttachment) => {
    setComposerAttachments((current) => {
      if (current.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) return current
      return [...current, attachment]
    })
  }, [])
  const handleRemoveComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])
  useEffect(() => {
    if (!autoStartDraft || !autoStartKey) return
    if (assistantRuntime.storageLoading || assistantRuntime.pending) return
    onAutoStartConsumed?.()
    void sendAssistantMessageOnce(
      autoStartKey,
      autoStartDraft.message,
      false,
      autoStartDraft.attachments,
    )
  }, [
    assistantRuntime.pending,
    assistantRuntime.storageLoading,
    autoStartKey,
    autoStartDraft,
    onAutoStartConsumed,
    sendAssistantMessageOnce,
  ])
  useEffect(() => {
    const handleSendMessage = (event: Event) => {
      if (!isWorkspaceAssistantSendMessageEvent(event)) return
      void sendAssistantMessageOnce(event.detail.key, event.detail.message, event.detail.hidden === true)
    }
    window.addEventListener(WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT, handleSendMessage)
    return () => window.removeEventListener(WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT, handleSendMessage)
  }, [sendAssistantMessageOnce])
  const handleRespondRunApproval = async (params: {
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    approved: boolean
    reason?: string
  }) => {
    await assistantRuntime.addRunApprovalResponse(params)
  }
  const handleSubmitChoiceResponse = async (params: {
    runId: string
    interruptionId: string | null
    choiceType: WorkspaceAssistantChoiceType
    toolCallId: string | null
    output: Record<string, unknown>
    visibleUserText?: string
  }) => {
    await assistantRuntime.submitChoiceResponse({
      runId: params.runId,
      interruptionId: params.interruptionId,
      choiceType: params.choiceType,
      toolCallId: params.toolCallId,
      output: params.output,
      visibleUserText: params.visibleUserText,
    })
  }
  const handleStylePreviewSelected = useCallback(async (params: {
    runId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => {
    onStyleBibleConfirmed?.()
    await assistantRuntimeRef.current.submitChoiceResponse({
      runId: params.runId,
      interruptionId: null,
      choiceType: 'style',
      toolCallId: null,
      output: {
        ok: true,
        stylePreviewId: params.stylePreviewId,
        aspectRatio: params.aspectRatio,
      },
    })
  }, [onStyleBibleConfirmed])
  const handleConfirmEditStylePreviewChoice = async (params: {
    projectId: string
    episodeId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => {
    if (params.projectId !== projectId) {
      throw new Error('ASSISTANT_CHOICE_PROJECT_MISMATCH')
    }
    await confirmEditStylePreview.mutateAsync({
      episodeId: params.episodeId,
      stylePreviewId: params.stylePreviewId,
      aspectRatio: params.aspectRatio,
    })
    onStyleBibleConfirmed?.()
  }
  const pendingInteraction = assistantRuntime.pendingInteraction
  const serverPendingApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const activeChoiceCard = pendingInteraction?.kind === 'choice'
    ? {
      key: pendingInteraction.interruptionId,
      data: pendingInteraction.choiceCard,
    }
    : null
  const displayedStylePreviewGenerationCard = assistantRuntime.sessionState?.activeStylePreviewGeneration ?? null
  const stylePreviewDockCardKey = displayedStylePreviewGenerationCard?.key ?? null
  // 仅在「用户发消息」时折叠；卡片本身变化（新一批候选）或消失时回到展开态
  useEffect(() => {
    setStylePreviewDockCollapsed(false)
  }, [stylePreviewDockCardKey])
  const currentActivity = assistantRuntime.sessionState?.currentActivity ?? null
  const activeExternalTaskOperationId = resolveWorkspaceAssistantExternalTaskOperationId(currentActivity)
  const taskSubmissions = useMemo(
    () => collectAssistantAsyncTaskSubmissions(assistantRuntime.messages),
    [assistantRuntime.messages],
  )
  const activeAssistantTaskTargets = useMemo(() => {
    const operationId = activeExternalTaskOperationId ?? assistantRuntime.pendingOperationId ?? null
    const fromActiveTasks = (assistantRuntime.sessionState?.activeTasks ?? []).flatMap((task) => {
      const submission = taskSubmissions.get(task.taskId)
      const taskOperationId = task.operationId ?? submission?.operationId ?? null
      if (operationId && taskOperationId !== operationId) return []
      const target = buildWorkspaceAssistantActiveTaskTarget({
        taskId: task.taskId,
        operationId: taskOperationId,
        taskType: task.taskType,
        targetType: task.targetType,
        targetId: task.targetId,
        sourceKind: submission?.kind === 'single' ? submission.data.sourceKind ?? null : null,
      })
      return target ? [target] : []
    })
    return dedupeWorkspaceAssistantActiveTaskTargets(fromActiveTasks)
  }, [
    activeExternalTaskOperationId,
    assistantRuntime.pendingOperationId,
    assistantRuntime.sessionState?.activeTasks,
    taskSubmissions,
  ])
  const activeExternalTaskFocusRequest = useMemo<WorkspaceAssistantActiveFocusRequest | null>(() => (
    activeExternalTaskOperationId && currentActivity
      ? {
          operationId: activeExternalTaskOperationId,
          requestKey: `${currentActivity.runId}:${currentActivity.activityId}:${activeExternalTaskOperationId}`,
        }
      : null
  ), [activeExternalTaskOperationId, currentActivity])
  const activeAssistantFocusRequest = useMemo(() => {
    const baseFocusRequest = assistantRuntime.activeFocusRequest ?? activeExternalTaskFocusRequest
    if (!baseFocusRequest) return null
    if (activeAssistantTaskTargets.length === 0) return baseFocusRequest
    return {
      ...baseFocusRequest,
      taskTargets: activeAssistantTaskTargets,
    }
  }, [
    activeAssistantTaskTargets,
    activeExternalTaskFocusRequest,
    assistantRuntime.activeFocusRequest,
  ])
  useEffect(() => {
    onActiveOperationChange?.(assistantRuntime.storageLoading ? null : activeAssistantFocusRequest)
    return () => onActiveOperationChange?.(null)
  }, [
    activeAssistantFocusRequest,
    assistantRuntime.storageLoading,
    onActiveOperationChange,
  ])
  const shouldDockStylePreviewGenerationCard = shouldDockWorkspaceStylePreviewGenerationCard({
    hasCard: Boolean(displayedStylePreviewGenerationCard),
    stylePreviewConfirmed: false,
  })
  const displayedActiveChoiceCard = serverPendingApproval ? null : activeChoiceCard
  const partComponents = useWorkspaceAssistantMessagePartComponents({
    hideChoiceCards: true,
    hideStylePreviewGenerationCards: shouldDockStylePreviewGenerationCard,
    onSubmitChoiceResponse: handleSubmitChoiceResponse,
    onConfirmEditStylePreviewChoice: handleConfirmEditStylePreviewChoice,
    onStylePreviewSelected: handleStylePreviewSelected,
    onPreviewImage: setPreviewImageUrl,
  })
  const awaitingUserInput = resolveWorkspaceAssistantAwaitingUserInput({
    replyInFlight: assistantRuntime.replyInFlight,
    hasPendingInteraction: Boolean(pendingInteraction),
  })
  const awaitingExternalTask = resolveWorkspaceAssistantAwaitingExternalTask({
    replyInFlight: assistantRuntime.replyInFlight,
    currentRunStatus: assistantRuntime.sessionState?.currentRun?.status ?? null,
    activeExternalTaskOperationId,
  })
  const showExternalTaskRunCard = shouldShowWorkspaceAssistantExternalTaskRunCard({
    storageLoading: assistantRuntime.storageLoading,
    operationId: activeExternalTaskOperationId,
    stylePreviewGenerationDocked: shouldDockStylePreviewGenerationCard,
  })
  const showAssistantReplyLoading = shouldShowWorkspaceAssistantReplyLoading({
    storageLoading: assistantRuntime.storageLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    awaitingUserInput,
    awaitingExternalTask,
  })
  const showRunFailureNotice = shouldShowWorkspaceAssistantRunFailureNotice({
    storageLoading: assistantRuntime.storageLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    currentRunStatus: assistantRuntime.sessionState?.currentRun?.status ?? null,
  })
  const composerError = showRunFailureNotice
    ? null
    : assistantRuntime.error ? assistantRuntime.error.message || 'UNKNOWN_ERROR' : null
  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: assistantPanelWidth,
      currentWidth: assistantPanelWidth,
    }
    setIsResizing(true)
  }, [assistantPanelWidth])

  useEffect(() => {
    if (!isResizing) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) return
      const nextWidth = clampWorkspaceAssistantPanelWidth(
        resizeState.startWidth + resizeState.startX - event.clientX,
      )
      resizeState.currentWidth = nextWidth
      setAssistantPanelWidth(nextWidth)
    }

    const handlePointerUp = () => {
      const currentWidth = resizeStateRef.current?.currentWidth ?? assistantPanelWidth
      window.localStorage.setItem(WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY, String(currentWidth))
      resizeStateRef.current = null
      setIsResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [assistantPanelWidth, isResizing])

  return (
    <aside
      className="pointer-events-none fixed inset-y-0 right-0 z-20 w-0"
      style={{ width: `${layout.occupiedWidthPx}px` }}
      data-state={layout.state}
    >
      <div
        className={`pointer-events-auto fixed right-4 z-20 overflow-hidden rounded-[34px] border border-white/80 bg-white/82 ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl ${isResizing ? '' : 'transition-[width] duration-300 ease-out'}`}
        style={{
          top: WORKSPACE_ASSISTANT_TOP_OFFSET,
          width: `${layout.panelWidthPx}px`,
          height: `calc(100vh - ${WORKSPACE_ASSISTANT_TOP_OFFSET} - 1.5rem)`,
        }}
        data-state={layout.state}
      >
        <button
          type="button"
          aria-label={t('panel.resize')}
          title={t('panel.resize')}
          className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-transparent"
          onPointerDown={handleResizePointerDown}
        />
        <div
          className="h-full transition-opacity duration-200 opacity-100"
        >
          <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
            <ThreadPrimitive.Root className="relative flex h-full min-h-0 flex-col">
              <ThreadPrimitive.Viewport
                autoScroll
                className="flex-1 overflow-y-auto px-5 pb-4 pt-4"
                style={WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE}
              >
                <div>
                  <div className="space-y-3">
                    <ThreadPrimitive.Messages>
                      {() => (
                        <WorkspaceAssistantThreadMessage
                          messagePartComponents={partComponents}
                        />
                      )}
                    </ThreadPrimitive.Messages>
                    {showAssistantReplyLoading ? (
                      <WorkspaceAssistantPendingTurnPlaceholder />
                    ) : null}
                    {showRunFailureNotice ? (
                      <WorkspaceAssistantRunFailureNotice run={assistantRuntime.sessionState?.currentRun ?? null} />
                    ) : null}
                    {showExternalTaskRunCard && activeExternalTaskOperationId ? (
                      <WorkspaceAssistantActiveRunCard
                        operationId={activeExternalTaskOperationId}
                        taskCount={(assistantRuntime.sessionState?.activeTasks ?? []).filter((task) => (
                          task.operationId === activeExternalTaskOperationId
                        )).length}
                      />
                    ) : null}
                    {serverPendingApproval ? (
                      <ConfirmationActionCard
                        operationId={serverPendingApproval.operationId}
                        title={localizeProjectAgentOperationTitle(serverPendingApproval.operationId, locale)}
                        subtitle={t('cards.confirmationRequired')}
                        operationPlan={serverPendingApproval.operationPlan}
                        onConfirm={async () => handleRespondRunApproval({
                          ...serverPendingApproval,
                          approved: true,
                        })}
                        onCancel={async () => handleRespondRunApproval({
                          ...serverPendingApproval,
                          approved: false,
                        })}
                      />
                    ) : null}
                    {displayedStylePreviewGenerationCard && shouldDockStylePreviewGenerationCard ? (
                      stylePreviewDockCollapsed ? (
                        <button
                          type="button"
                          onClick={() => setStylePreviewDockCollapsed(false)}
                          className="flex w-full items-center gap-2 rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 px-3.5 py-2.5 text-left shadow-[0_2px_10px_rgba(15,23,42,0.04)] transition-colors hover:bg-neutral-50"
                        >
                          <AppIcon name="imageAlt" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--glass-text-primary)]">
                            {t('panel.stylePreviewDockCollapsed', { count: displayedStylePreviewGenerationCard.data.items.length })}
                          </span>
                          <span className="shrink-0 text-[12px] font-medium text-[var(--glass-text-tertiary)]">{t('panel.stylePreviewDockExpand')}</span>
                          <AppIcon name="chevronDown" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
                        </button>
                      ) : (
                        <EditStylePreviewGenerationDataCard
                          type="data"
                          name="edit-style-preview-generation"
                          status={{ type: 'complete' }}
                          data={displayedStylePreviewGenerationCard.data}
                          onStyleSelected={handleStylePreviewSelected}
                          onPreviewImage={setPreviewImageUrl}
                        />
                      )
                    ) : null}
                  </div>
                </div>
              </ThreadPrimitive.Viewport>

              <div className="mx-4 mb-2 shrink-0">
                {displayedActiveChoiceCard ? (
                  <div className="mb-2">
                    <AssistantChoiceCardView
                      data={displayedActiveChoiceCard.data}
                      onSubmitChoiceResponse={handleSubmitChoiceResponse}
                      onConfirmEditStylePreviewChoice={handleConfirmEditStylePreviewChoice}
                    />
                  </div>
                ) : null}
                <div>
                  <WorkspaceAssistantComposer
                    value={composerText}
                    error={composerError}
                    pending={assistantRuntime.pending || assistantRuntime.storageLoading}
                    canStopReply={assistantRuntime.canStopReply}
                    attachments={composerAttachments}
                    attachDisabled={composerAttachments.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES}
                    assistantPermissionMode={assistantPermissionMode}
                    onChange={setComposerText}
                    onSubmit={handleComposerSubmit}
                    onStopReply={assistantRuntime.stopReply}
                    onAttachClick={() => setAttachmentDialogOpen(true)}
                    onRemoveAttachment={handleRemoveComposerAttachment}
                    onAssistantPermissionModeChange={setAssistantPermissionMode}
                  />
                </div>
              </div>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        </div>
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
      <TextAttachmentUploadDialog
        open={attachmentDialogOpen}
        disabled={
          assistantRuntime.pending
          || assistantRuntime.storageLoading
          || composerAttachments.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES
        }
        onClose={() => setAttachmentDialogOpen(false)}
        onUploaded={handleAttachmentUploaded}
      />
    </aside>
  )
}
