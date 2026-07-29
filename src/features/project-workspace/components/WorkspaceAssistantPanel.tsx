'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import { useAttachmentFilePicker } from '@/components/project-assistant/useAttachmentFilePicker'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import type { ProjectAgentSessionState } from '@/lib/project-agent/session-state'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import { uploadProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments/client'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import {
  isProjectAssistantMediaFile,
  uploadProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments/client'
import type { WorkspaceAssistantSelectionContext } from '../canvas/ProjectWorkspaceCanvas'
import type { WorkspaceAssistantActiveFocusRequest } from '../workspace-assistant-focus'
import {
  ConfirmationActionCard,
  useWorkspaceAssistantMessagePartComponents,
  WorkspaceAssistantPendingTurnPlaceholder,
  WorkspaceAssistantThreadMessage,
} from './workspace-assistant/WorkspaceAssistantRenderers'
import { AssistantChoiceCardView } from './workspace-assistant/WorkspaceAssistantChoiceCard'
import { WorkspaceAssistantActiveRunCard } from './workspace-assistant/WorkspaceAssistantActiveRunCard'
import { WorkspaceAssistantPlanCard } from './workspace-assistant/WorkspaceAssistantPlanCard'
import { WorkspaceAssistantSettings } from './workspace-assistant/WorkspaceAssistantSettings'
import { WorkspaceAssistantComposer } from './workspace-assistant/WorkspaceAssistantComposer'
import {
  WorkspaceAssistantRunningSurfaceProvider,
} from './workspace-assistant/WorkspaceAssistantReasoning'
import {
  WorkspaceAssistantRunningSubagentDock,
  WorkspaceAssistantSubagentTabs,
} from './workspace-assistant/WorkspaceAssistantSubagents'
import { WorkspaceAssistantSubagentView } from './workspace-assistant/WorkspaceAssistantSubagentDetail'
import {
  buildWorkspaceAssistantPanelLayout,
  WORKSPACE_ASSISTANT_TOP_OFFSET,
} from './workspace-assistant/panel-layout'
import { useWorkspaceAssistantCanvasFocus } from './workspace-assistant/useWorkspaceAssistantCanvasFocus'
import { useWorkspaceAssistantComposer } from './workspace-assistant/useWorkspaceAssistantComposer'
import { useWorkspaceAssistantMessageDispatch } from './workspace-assistant/useWorkspaceAssistantMessageDispatch'
import { useWorkspaceAssistantPanelResize } from './workspace-assistant/useWorkspaceAssistantPanelResize'
import { useWorkspaceAssistantRuntime } from './workspace-assistant/useWorkspaceAssistantRuntime'
import {
  parseWorkspaceAssistantFailureText,
  resolveWorkspaceAssistantFailureView,
  shouldShowWorkspaceAssistantExternalTaskRunCard,
  shouldShowWorkspaceAssistantReplyLoading,
  shouldShowWorkspaceAssistantRunFailureNotice,
  type WorkspaceAssistantFailureView,
} from './workspace-assistant/workspace-assistant-panel-state'

interface WorkspaceAssistantPanelProps {
  projectId: string
  episodeId?: string
  selection?: WorkspaceAssistantSelectionContext
  autoStartDraft?: {
    readonly message: string
    readonly attachments: readonly ProjectAssistantTextAttachment[]
    readonly mediaAttachments: readonly ProjectAssistantMediaAttachment[]
  } | null
  autoStartKey?: string | null
  onAutoStartConsumed?: () => void
  onActiveOperationChange?: (focusRequest: WorkspaceAssistantActiveFocusRequest | null) => void
}

export const WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
} satisfies CSSProperties

function WorkspaceAssistantRunFailureNotice({
  failure,
}: {
  failure: WorkspaceAssistantFailureView
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warn-fg)]"
    >
      <AppIcon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{t('panel.runFailedTitle')}</div>
        <div className="break-words text-xs leading-4 opacity-80">{failure.headline}</div>
        {failure.technical ? (
          <div className="mt-0.5 break-all text-[11px] leading-4 opacity-60">{failure.technical}</div>
        ) : null}
      </div>
    </div>
  )
}

export default function WorkspaceAssistantPanel({
  projectId,
  episodeId,
  selection,
  autoStartDraft,
  autoStartKey,
  onAutoStartConsumed,
  onActiveOperationChange,
}: WorkspaceAssistantPanelProps) {
  const t = useTranslations('assistantAgent')
  const tErrors = useTranslations('errors')
  const locale = normalizeProjectAgentLocale(useLocale())
  const assistantRuntime = useWorkspaceAssistantRuntime({
    projectId,
    episodeId,
    selectedScopeRef: selection?.selectedScopeRef ?? null,
    selectedAssetId: selection?.selectedAssetId ?? null,
  })
  const panelResize = useWorkspaceAssistantPanelResize()
  const panelLayout = buildWorkspaceAssistantPanelLayout(panelResize.width)
  const composer = useWorkspaceAssistantComposer(assistantRuntime.sendMessage)
  const [mediaUploadPending, setMediaUploadPending] = useState(false)
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null)
  const uploadAttachmentFiles = async (files: readonly File[]): Promise<void> => {
    if (mediaUploadPending) return
    setMediaUploadError(null)
    setMediaUploadPending(true)
    try {
      const mediaFiles = files.filter(isProjectAssistantMediaFile)
      const textFiles = files.filter((file) => !isProjectAssistantMediaFile(file))
      const mediaRoom = PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES - composer.mediaAttachments.length
      for (const file of mediaFiles.slice(0, Math.max(mediaRoom, 0))) {
        const attachment = await uploadProjectAssistantMediaAttachment({ projectId, file })
        composer.addMediaAttachment(attachment)
      }
      const textRoom = PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES - composer.attachments.length
      for (const file of textFiles.slice(0, Math.max(textRoom, 0))) {
        const attachment = await uploadProjectAssistantTextAttachment({ file })
        composer.addAttachment(attachment)
      }
    } catch (error) {
      setMediaUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setMediaUploadPending(false)
    }
  }
  const attachmentPicker = useAttachmentFilePicker({
    accept: `${PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT},${PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT}`,
    disabled: assistantRuntime.pending || assistantRuntime.storageLoading,
    onFiles: (files) => { void uploadAttachmentFiles(files) },
  })
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null)
  const [dismissedSubagentIds, setDismissedSubagentIds] = useState<ReadonlySet<string>>(() => new Set())
  const visibleSubagents = useMemo(() => assistantRuntime.subagents.filter(
    (subagent) => !dismissedSubagentIds.has(subagent.subagentId),
  ), [assistantRuntime.subagents, dismissedSubagentIds])

  useEffect(() => {
    if (!selectedSubagentId) return
    if (visibleSubagents.some((item) => item.subagentId === selectedSubagentId)) return
    setSelectedSubagentId(null)
  }, [selectedSubagentId, visibleSubagents])

  const dismissSubagent = (subagentId: string): void => {
    setDismissedSubagentIds((current) => new Set([...current, subagentId]))
    if (selectedSubagentId === subagentId) setSelectedSubagentId(null)
  }

  useWorkspaceAssistantMessageDispatch({
    autoStartDraft,
    autoStartKey,
    storageLoading: assistantRuntime.storageLoading,
    pending: assistantRuntime.pending,
    onAutoStartConsumed,
    sendMessage: assistantRuntime.sendMessage,
    sendHiddenMessage: assistantRuntime.sendHiddenMessage,
  })
  const activeExternalTaskOperationId = useWorkspaceAssistantCanvasFocus({
    sessionState: assistantRuntime.sessionState,
    pendingOperationId: assistantRuntime.pendingOperationId,
    runtimeFocusRequest: assistantRuntime.activeFocusRequest,
    storageLoading: assistantRuntime.storageLoading,
    onActiveOperationChange,
  })
  const activeExternalTasks = assistantRuntime.sessionState?.activeTasks ?? []
  const activeExternalTaskOperationIds = Array.from(new Set(
    activeExternalTasks.flatMap((task) => task.operationId ? [task.operationId] : []),
  )).sort()
  const pendingInteraction = assistantRuntime.pendingInteraction
  const serverPendingApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const activeChoiceCard = pendingInteraction?.kind === 'choice'
    ? { key: pendingInteraction.interruptionId, data: pendingInteraction.choiceCard }
    : null
  const displayedActiveChoiceCard = serverPendingApproval ? null : activeChoiceCard
  const partComponents = useWorkspaceAssistantMessagePartComponents({
    hideChoiceCards: true,
    onSubmitChoiceResponse: assistantRuntime.submitChoiceResponse,
  })
  const showExternalTaskRunCard = shouldShowWorkspaceAssistantExternalTaskRunCard({
    storageLoading: assistantRuntime.storageLoading,
    operationId: activeExternalTaskOperationId,
  })
  const showAssistantReplyLoading = shouldShowWorkspaceAssistantReplyLoading({
    storageLoading: assistantRuntime.storageLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    hasPendingInteraction: Boolean(pendingInteraction),
  })
  const showRunFailureNotice = shouldShowWorkspaceAssistantRunFailureNotice({
    storageLoading: assistantRuntime.storageLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    currentRunStatus: assistantRuntime.sessionState?.currentRun?.status ?? null,
  })
  // Both failure surfaces resolve through the same view resolver, so a run
  // failure and a send failure explain themselves with the same canonical
  // error catalogue instead of panel-local sentences.
  const localizeErrorCode = useCallback(
    (code: string) => (tErrors.has(code) ? tErrors(code) : null),
    [tErrors],
  )
  const unknownFailureFallback = tErrors('INTERNAL_ERROR')
  const currentRun = assistantRuntime.sessionState?.currentRun ?? null
  const runFailureView = resolveWorkspaceAssistantFailureView({
    facts: {
      code: currentRun?.errorCode?.trim() || null,
      message: currentRun?.errorMessage?.trim() || null,
      requestId: null,
    },
    localizeCode: localizeErrorCode,
    unknownFallback: unknownFailureFallback,
  })
  const composerFailureView = showRunFailureNotice || !assistantRuntime.error
    ? null
    : resolveWorkspaceAssistantFailureView({
      facts: parseWorkspaceAssistantFailureText(assistantRuntime.error.message),
      localizeCode: localizeErrorCode,
      unknownFallback: unknownFailureFallback,
    })

  return (
    <aside
      className="pointer-events-none fixed inset-y-0 right-0 z-20 w-0"
      style={{ width: `${panelLayout.occupiedWidthPx}px` }}
      data-state={panelLayout.state}
    >
      <div
        className={`pointer-events-auto fixed right-4 z-20 overflow-hidden rounded-[34px] border border-white/80 bg-white/82 ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl ${panelResize.isResizing ? '' : 'transition-[width] duration-300 ease-out'}`}
        style={{
          top: WORKSPACE_ASSISTANT_TOP_OFFSET,
          width: `${panelLayout.panelWidthPx}px`,
          height: `calc(100vh - ${WORKSPACE_ASSISTANT_TOP_OFFSET} - 1.5rem)`,
        }}
        data-state={panelLayout.state}
      >
        <button
          type="button"
          aria-label={t('panel.resize')}
          title={t('panel.resize')}
          className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-transparent"
          onPointerDown={panelResize.onResizePointerDown}
        />
        <div className="h-full opacity-100 transition-opacity duration-200">
          <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
              <ThreadPrimitive.Root key={`${projectId}:${episodeId ?? ''}`} className="relative flex h-full min-h-0 flex-col">
              <WorkspaceAssistantSettings />
              <WorkspaceAssistantSubagentTabs
                subagents={visibleSubagents}
                selectedSubagentId={selectedSubagentId}
                onSelect={setSelectedSubagentId}
                onDismiss={dismissSubagent}
                primaryNeedsAttention={Boolean(displayedActiveChoiceCard || serverPendingApproval)}
              />
              <ThreadPrimitive.Viewport
                autoScroll
                className={`min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-4 ${visibleSubagents.length > 0 ? 'pt-4' : 'pt-12'}`}
                style={WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE}
              >
                {selectedSubagentId ? (
                  <WorkspaceAssistantSubagentView
                    projectId={projectId}
                    subagent={visibleSubagents.find((item) => item.subagentId === selectedSubagentId) ?? null}
                    structuredOutputText={assistantRuntime.subagentStructuredOutputs.get(selectedSubagentId) ?? null}
                  />
                ) : (
                  <WorkspaceAssistantRunningSurfaceProvider activeTurn={assistantRuntime.replyInFlight}>
                    <div className="min-w-0">
                      <div className="space-y-3">
                        <ThreadPrimitive.Messages>
                          {() => (
                            <WorkspaceAssistantThreadMessage
                              messagePartComponents={partComponents}
                              subagents={visibleSubagents}
                              onSelectSubagent={setSelectedSubagentId}
                            />
                          )}
                        </ThreadPrimitive.Messages>
                        {showAssistantReplyLoading ? (
                          <WorkspaceAssistantPendingTurnPlaceholder
                            label={assistantRuntime.backgroundFollowUpActive
                              ? t('panel.backgroundFollowUpRunning')
                              : undefined}
                          />
                        ) : null}
                        {assistantRuntime.sessionStateError ? (
                          <div role="alert" className="rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warn-fg)]">
                            {t('panel.sessionStateError')}
                          </div>
                        ) : null}
                        {showRunFailureNotice ? (
                          <WorkspaceAssistantRunFailureNotice failure={runFailureView} />
                        ) : null}
                        {showExternalTaskRunCard && activeExternalTaskOperationId && activeExternalTasks.length > 0 ? (
                          <WorkspaceAssistantActiveRunCard
                            operationIds={activeExternalTaskOperationIds.length > 0
                              ? activeExternalTaskOperationIds
                              : [activeExternalTaskOperationId]}
                            taskCount={activeExternalTasks.length}
                          />
                        ) : null}
                        {serverPendingApproval ? (
                          <ConfirmationActionCard
                            operationId={serverPendingApproval.operationId}
                            title={localizeProjectAgentOperationTitle(serverPendingApproval.operationId, locale)}
                            subtitle={t('cards.confirmationRequired')}
                            operationPlan={serverPendingApproval.operationPlan}
                            onConfirm={() => assistantRuntime.addRunApprovalResponse({
                              ...serverPendingApproval,
                              approved: true,
                            })}
                            onCancel={() => assistantRuntime.addRunApprovalResponse({
                              ...serverPendingApproval,
                              approved: false,
                            })}
                          />
                        ) : null}
                      </div>
                    </div>
                  </WorkspaceAssistantRunningSurfaceProvider>
                )}
              </ThreadPrimitive.Viewport>

              {selectedSubagentId === null ? (
                <div className="mx-4 mb-2 shrink-0">
                  <WorkspaceAssistantRunningSubagentDock
                    subagents={visibleSubagents}
                    onSelect={setSelectedSubagentId}
                  />
                  {displayedActiveChoiceCard ? (
                    <div className="mb-2">
                      <AssistantChoiceCardView
                        data={displayedActiveChoiceCard.data}
                        onSubmitChoiceResponse={assistantRuntime.submitChoiceResponse}
                      />
                    </div>
                  ) : null}
                  <div className="relative">
                    {assistantRuntime.sessionState?.plan ? (
                      <WorkspaceAssistantPlanCard
                        plan={assistantRuntime.sessionState.plan}
                        isRunActive={assistantRuntime.sessionState.currentRun?.status === 'running'}
                      />
                    ) : null}
                    <WorkspaceAssistantComposer
                      value={composer.text}
                      error={composerFailureView}
                      pending={assistantRuntime.pending || assistantRuntime.storageLoading}
                      canStopReply={assistantRuntime.canStopReply}
                      attachments={composer.attachments}
                      mediaAttachments={composer.mediaAttachments}
                      attachDisabled={
                        composer.attachments.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES
                        && composer.mediaAttachments.length >= PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES
                      }
                      mediaUploadPending={mediaUploadPending}
                      mediaUploadError={mediaUploadError}
                      onChange={composer.setText}
                      onSubmit={async () => {
                        setMediaUploadError(null)
                        // Send failures surface through chat.error/controlError
                        // (rendered under the composer); never as an unhandled
                        // rejection reaching the React overlay.
                        await composer.submit().catch(() => undefined)
                      }}
                      onStopReply={assistantRuntime.stopReply}
                      onAttachClick={attachmentPicker.open}
                      onRemoveAttachment={composer.removeAttachment}
                      onRemoveMediaAttachment={composer.removeMediaAttachment}
                      onPasteMediaFiles={(files) => { void uploadAttachmentFiles(files) }}
                    />
                  </div>
                </div>
              ) : null}
              </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        </div>
      </div>
      {attachmentPicker.input}
    </aside>
  )
}
