'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
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
  hasWorkspaceAssistantPendingActivityAfterLatestUser,
  hasWorkspaceAssistantVisibleTextAfterLatestUser,
  resolveWorkspaceAssistantActiveThinkingMessageId,
  shouldShowPendingAssistantTurnPlaceholder,
  useWorkspaceAssistantMessagePartComponents,
  WorkspaceAssistantPendingTurnPlaceholder,
  WorkspaceAssistantThreadMessage,
} from './workspace-assistant/WorkspaceAssistantRenderers'
import { useWorkspaceAssistantRuntime } from './workspace-assistant/useWorkspaceAssistantRuntime'
import { apiFetch } from '@/lib/api-fetch'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { WorkspaceAssistantComposer } from './workspace-assistant/WorkspaceAssistantComposer'
import { WorkspaceAssistantCollapseHandle } from './workspace-assistant/WorkspaceAssistantCollapseHandle'
import { WorkspaceAssistantPanelRail } from './workspace-assistant/WorkspaceAssistantPanelRail'
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

const WORKSPACE_ASSISTANT_WAIT_FOLLOW_UP_POLL_MS = 5000

interface ProjectAgentWaitFollowUp {
  runId: string | null
  waitId: string
  followUpKey: string
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
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
  autoStartMessage?: string | null
  autoStartKey?: string | null
  onAutoStartConsumed?: () => void
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onActiveOperationChange?: (operationId: string | null) => void
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readResponseErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback
  const error = isRecord(payload.error) ? payload.error : null
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  const details = isRecord(error?.details) ? error.details : null
  if (typeof details?.message === 'string' && details.message.trim()) return details.message.trim()
  return fallback
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
  autoStartMessage,
  autoStartKey,
  onAutoStartConsumed,
  isCollapsed,
  onToggleCollapsed,
  onActiveOperationChange,
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
  const layout = buildWorkspaceAssistantPanelLayout(isCollapsed, assistantPanelWidth)
  const [composerText, setComposerText] = useState('')
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
    selectedClipId: selection?.selectedClipId ?? null,
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
    if (runtime.pending || runtime.storageLoading || runtime.pendingApprovalId) {
      queuedTaskFollowUpsRef.current = [...queuedTaskFollowUpsRef.current, followUp]
      return
    }
    await runtime.submitTaskFollowUp(followUp)
  }, [])
  useEffect(() => {
    if (assistantRuntime.pending || assistantRuntime.storageLoading || assistantRuntime.pendingApprovalId) return
    const [queuedFollowUp, ...remainingFollowUps] = queuedTaskFollowUpsRef.current
    if (!queuedFollowUp) return
    queuedTaskFollowUpsRef.current = remainingFollowUps
    void assistantRuntime.submitTaskFollowUp(queuedFollowUp)
  }, [assistantRuntime, assistantRuntime.pending, assistantRuntime.pendingApprovalId, assistantRuntime.storageLoading])
  const flushResolvedWaitFollowUps = useCallback(async () => {
    const runtime = assistantRuntimeRef.current
    if (runtime.pending || runtime.storageLoading || runtime.pendingApprovalId) return
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
  useEffect(() => {
    if (assistantRuntime.storageLoading) return
    void flushResolvedWaitFollowUps()
  }, [assistantRuntime.storageLoading, flushResolvedWaitFollowUps])
  useEffect(() => {
    if (assistantRuntime.storageLoading) return
    const timer = window.setInterval(() => {
      void flushResolvedWaitFollowUps()
    }, WORKSPACE_ASSISTANT_WAIT_FOLLOW_UP_POLL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [assistantRuntime.storageLoading, flushResolvedWaitFollowUps])
  useEffect(() => {
    return subscribeTaskEvents((event) => {
      const terminalEvent = resolveAssistantAsyncTaskTerminalEvent(event)
      if (!terminalEvent) return
      void flushResolvedWaitFollowUps()
    })
  }, [flushResolvedWaitFollowUps, subscribeTaskEvents])
  const consumedMessageKeysRef = useRef<Set<string>>(new Set())
  const sendAssistantMessageOnce = useCallback(async (key: string, message: string, hidden = false) => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage) return
    const reservedKey = reserveWorkspaceAssistantMessageKey(key, consumedMessageKeysRef.current)
    if (!reservedKey) return
    try {
      if (hidden) {
        await assistantRuntime.sendHiddenMessage(normalizedMessage)
      } else {
        await assistantRuntime.sendMessage(normalizedMessage)
      }
    } catch (error) {
      releaseWorkspaceAssistantMessageKey(reservedKey, consumedMessageKeysRef.current)
      throw error
    }
  }, [assistantRuntime])
  const handleComposerSubmit = useCallback(async () => {
    const normalizedText = composerText.trim()
    if (!normalizedText) return
    // 发消息时把底部停靠的视觉风格卡收成细条，避免大卡占满底部、把刚发的消息顶出视口
    setStylePreviewDockCollapsed(true)
    setComposerText('')
    await assistantRuntime.sendMessage(normalizedText)
  }, [assistantRuntime, composerText])
  useEffect(() => {
    if (!autoStartMessage || !autoStartKey) return
    if (assistantRuntime.storageLoading || assistantRuntime.pending) return
    onAutoStartConsumed?.()
    void sendAssistantMessageOnce(autoStartKey, autoStartMessage)
  }, [
    assistantRuntime.pending,
    assistantRuntime.storageLoading,
    autoStartKey,
    autoStartMessage,
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
  const [confirmationSubmittingKey, setConfirmationSubmittingKey] = useState<string | null>(null)
  const handleRespondToolApproval = async (params: {
    approvalId: string
    approved: boolean
    reason?: string
  }) => {
    setConfirmationSubmittingKey(`approval:${params.approvalId}:${params.approved ? 'approve' : 'deny'}`)
    try {
      await assistantRuntime.addToolApprovalResponse(params)
    } finally {
      setConfirmationSubmittingKey(null)
    }
  }
  const handleRespondRunApproval = async (params: {
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    approved: boolean
    reason?: string
  }) => {
    setConfirmationSubmittingKey(`approval:${params.approvalId}:${params.approved ? 'approve' : 'deny'}`)
    try {
      await assistantRuntime.addRunApprovalResponse(params)
    } finally {
      setConfirmationSubmittingKey(null)
    }
  }
  const handleSubmitChoiceResponse = async (params: {
    runId: string
    interruptionId: string | null
    choiceType: 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review'
    toolCallId: string | null
    output: Record<string, unknown>
  }) => {
    await assistantRuntime.submitChoiceResponse({
      runId: params.runId,
      interruptionId: params.interruptionId,
      choiceType: params.choiceType,
      toolCallId: params.toolCallId,
      output: params.output,
    })
  }
  const handleStylePreviewSelected = useCallback(async (params: {
    runId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => {
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
  }, [])
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
  }
  const handleSetProjectVideoRatioChoice = async (params: {
    projectId: string
    aspectRatio: EditScriptVideoRatio
  }) => {
    if (params.projectId !== projectId) {
      throw new Error('ASSISTANT_CHOICE_PROJECT_MISMATCH')
    }
    const response = await apiFetch(`/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        videoRatio: params.aspectRatio,
      }),
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
      throw new Error(readResponseErrorMessage(payload, t('cards.operationExecutionFailedFallback')))
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    if (episodeId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
    }
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
  const activeExternalTaskOperationId = assistantRuntime.sessionState?.activeWaits.find((wait) => wait.status === 'pending')?.operationId
    ?? assistantRuntime.sessionState?.activeTasks.find((task) => task.operationId)?.operationId
    ?? null
  const activeAssistantOperationId = assistantRuntime.pendingOperationId ?? activeExternalTaskOperationId
  useEffect(() => {
    onActiveOperationChange?.(assistantRuntime.storageLoading ? null : activeAssistantOperationId)
    return () => onActiveOperationChange?.(null)
  }, [
    activeAssistantOperationId,
    assistantRuntime.storageLoading,
    onActiveOperationChange,
  ])
  const shouldDockStylePreviewGenerationCard = shouldDockWorkspaceStylePreviewGenerationCard({
    hasCard: Boolean(displayedStylePreviewGenerationCard),
    stylePreviewConfirmed: false,
  })
  const displayedActiveChoiceCard = serverPendingApproval ? null : activeChoiceCard
  const partComponents = useWorkspaceAssistantMessagePartComponents({
    onRespondToolApproval: handleRespondToolApproval,
    confirmationSubmittingKey,
    approvalRespondedIds: assistantRuntime.approvalRespondedIds,
    pendingApprovalId: null,
    hideChoiceCards: true,
    hideStylePreviewGenerationCards: shouldDockStylePreviewGenerationCard,
    onSubmitChoiceResponse: handleSubmitChoiceResponse,
    onSetProjectVideoRatioChoice: handleSetProjectVideoRatioChoice,
    onConfirmEditStylePreviewChoice: handleConfirmEditStylePreviewChoice,
    onStylePreviewSelected: handleStylePreviewSelected,
    onPreviewImage: setPreviewImageUrl,
  })
  const assistantTurnHasVisibleText = useMemo(
    () => hasWorkspaceAssistantVisibleTextAfterLatestUser(assistantRuntime.messages),
    [assistantRuntime.messages],
  )
  const assistantTurnHasPendingActivity = useMemo(
    () => hasWorkspaceAssistantPendingActivityAfterLatestUser(assistantRuntime.messages),
    [assistantRuntime.messages],
  )
  const assistantTurnPending = !assistantRuntime.storageLoading
    && (assistantRuntime.pending || assistantTurnHasPendingActivity)
  const isAwaitingAssistantText = assistantTurnPending && !assistantTurnHasVisibleText
  const activeThinkingAssistantMessageId = useMemo(() => {
    return resolveWorkspaceAssistantActiveThinkingMessageId({
      pending: assistantTurnPending,
      hasVisibleAssistantText: assistantTurnHasVisibleText,
      messages: assistantRuntime.messages,
    })
  }, [assistantRuntime.messages, assistantTurnHasVisibleText, assistantTurnPending])
  const showPendingAssistantTurnPlaceholder = shouldShowPendingAssistantTurnPlaceholder({
    pending: isAwaitingAssistantText,
    activeAssistantMessageId: activeThinkingAssistantMessageId,
    hasVisibleAssistantText: assistantTurnHasVisibleText,
  })
  const suppressActiveRunCard = shouldSuppressWorkspaceAssistantOperationRunCard({
    operationId: assistantRuntime.pendingOperationId,
    stylePreviewGenerationDocked: shouldDockStylePreviewGenerationCard,
  })
  const suppressExternalTaskRunCard = shouldSuppressWorkspaceAssistantOperationRunCard({
    operationId: activeExternalTaskOperationId,
    stylePreviewGenerationDocked: shouldDockStylePreviewGenerationCard,
  })
  const showActiveRunCard = Boolean(
    assistantRuntime.pending
      && !assistantRuntime.storageLoading
      && assistantRuntime.pendingOperationId
      && !suppressActiveRunCard,
  )
  const showExternalTaskRunCard = Boolean(
    !showActiveRunCard
      && !assistantRuntime.storageLoading
      && activeExternalTaskOperationId
      && !suppressExternalTaskRunCard,
  )
  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isCollapsed) return
    event.preventDefault()
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: assistantPanelWidth,
      currentWidth: assistantPanelWidth,
    }
    setIsResizing(true)
  }, [assistantPanelWidth, isCollapsed])

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
        {!isCollapsed ? (
          <WorkspaceAssistantCollapseHandle
            collapseLabel={t('panel.collapse')}
            onCollapse={onToggleCollapsed}
          />
        ) : null}
        {!isCollapsed ? (
          <button
            type="button"
            aria-label={t('panel.resize')}
            title={t('panel.resize')}
            className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-transparent"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}
        <div
          className={`h-full transition-opacity duration-200 ${isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          aria-hidden={isCollapsed}
        >
          <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
            <ThreadPrimitive.Root className="relative flex h-full min-h-0 flex-col">
              <ThreadPrimitive.Viewport
                autoScroll
                className="flex-1 overflow-y-auto px-5 pb-4 pt-4"
                style={WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE}
              >
                <div>
                  {!isCollapsed ? <div aria-hidden="true" className="float-right h-14 w-14" /> : null}
                  <div className="space-y-3">
                    <ThreadPrimitive.Messages>
                      {() => (
                        <WorkspaceAssistantThreadMessage
                          messagePartComponents={partComponents}
                          activeThinkingAssistantMessageId={activeThinkingAssistantMessageId}
                        />
                      )}
                    </ThreadPrimitive.Messages>
                    {showPendingAssistantTurnPlaceholder ? (
                      <WorkspaceAssistantPendingTurnPlaceholder />
                    ) : null}
                    {showActiveRunCard ? (
                      <WorkspaceAssistantActiveRunCard operationId={assistantRuntime.pendingOperationId} />
                    ) : null}
                    {showExternalTaskRunCard && activeExternalTaskOperationId ? (
                      <WorkspaceAssistantActiveRunCard operationId={activeExternalTaskOperationId} />
                    ) : null}
                    {serverPendingApproval ? (
                      <ConfirmationActionCard
                        operationId={serverPendingApproval.operationId}
                        title={localizeProjectAgentOperationTitle(serverPendingApproval.operationId, locale)}
                        subtitle={t('cards.confirmationRequired')}
                        onConfirm={async () => handleRespondRunApproval({
                          ...serverPendingApproval,
                          approved: true,
                        })}
                        onCancel={async () => handleRespondRunApproval({
                          ...serverPendingApproval,
                          approved: false,
                        })}
                        confirmPending={confirmationSubmittingKey === `approval:${serverPendingApproval.approvalId}:approve`}
                        cancelPending={confirmationSubmittingKey === `approval:${serverPendingApproval.approvalId}:deny`}
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
                      onSetProjectVideoRatioChoice={handleSetProjectVideoRatioChoice}
                      onConfirmEditStylePreviewChoice={handleConfirmEditStylePreviewChoice}
                    />
                  </div>
                ) : null}
                <div>
                  <WorkspaceAssistantComposer
                    value={composerText}
                    error={assistantRuntime.error ? assistantRuntime.error.message || 'UNKNOWN_ERROR' : null}
                    pending={assistantRuntime.pending || assistantRuntime.storageLoading}
                    assistantPermissionMode={assistantPermissionMode}
                    onChange={setComposerText}
                    onSubmit={handleComposerSubmit}
                    onAssistantPermissionModeChange={setAssistantPermissionMode}
                  />
                </div>
              </div>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        </div>
        <div
          className={`absolute inset-y-0 right-0 transition-opacity duration-200 ${isCollapsed ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          aria-hidden={!isCollapsed}
        >
          <WorkspaceAssistantPanelRail
            expandLabel={t('panel.expand')}
            onExpand={onToggleCollapsed}
          />
        </div>
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </aside>
  )
}
