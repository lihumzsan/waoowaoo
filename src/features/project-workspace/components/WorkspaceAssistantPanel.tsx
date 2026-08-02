'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import { useAttachmentFilePicker } from '@/components/project-assistant/useAttachmentFilePicker'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  uploadProjectAssistantTextAttachment,
  validateProjectAssistantTextAttachmentFile,
} from '@/lib/project-agent/text-attachments/client'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import {
  isProjectAssistantMediaFile,
  mintProjectAssistantResourceAttachment,
  uploadProjectAssistantMediaAttachment,
  validateProjectAssistantMediaAttachmentFile,
} from '@/lib/project-agent/media-attachments/client'
import type {
  WorkspaceAssistantDraftRequest,
  WorkspaceCanvasSelection,
} from '../canvas/contracts/workspace-canvas-interactions'
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
import { WorkspaceAssistantRepeatedToolCallGroupProvider } from './workspace-assistant/WorkspaceAssistantToolCall'
import { WorkspaceAssistantRunningSurfaceProvider } from './workspace-assistant/WorkspaceAssistantReasoning'
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
  resolveWorkspaceAssistantResendDraft,
  resolveWorkspaceAssistantUndeliveredUserMessage,
  shouldShowWorkspaceAssistantReplyLoading,
  shouldShowWorkspaceAssistantRunFailureNotice,
  type WorkspaceAssistantFailureView,
} from './workspace-assistant/workspace-assistant-panel-state'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

interface WorkspaceAssistantPanelProps {
  projectId: string
  episodeId?: string
  selection: WorkspaceCanvasSelection | null
  draftRequest: WorkspaceAssistantDraftRequest | null
  onDraftRequestConsumed: (requestId: string) => void
  onClearSelection: () => void
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
  title,
  resend,
}: {
  failure: WorkspaceAssistantFailureView
  title?: string
  resend: { readonly pending: boolean; readonly onResend: () => void } | null
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warn-fg)]"
    >
      <AppIcon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{title ?? t('panel.runFailedTitle')}</div>
        <div className="break-words text-xs leading-4 opacity-80">{failure.headline}</div>
        {failure.technical ? (
          <div className="mt-0.5 break-all text-[11px] leading-4 opacity-60">
            {failure.technical}
          </div>
        ) : null}
        {resend ? (
          <button
            type="button"
            disabled={resend.pending}
            onClick={resend.onResend}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[var(--glass-tone-warn-fg)]/30 bg-white/70 px-2 py-1 text-xs font-medium text-[var(--glass-tone-warn-fg)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="refresh" className="h-3 w-3 shrink-0" />
            {resend.pending ? t('panel.sending') : t('panel.resend')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function WorkspaceAssistantPanel({
  projectId,
  episodeId,
  selection,
  draftRequest,
  onDraftRequestConsumed,
  onClearSelection,
  autoStartDraft,
  autoStartKey,
  onAutoStartConsumed,
  onActiveOperationChange,
}: WorkspaceAssistantPanelProps) {
  const t = useTranslations('assistantAgent')
  const tErrors = useTranslations('errors')
  const resolveClientError = useClientErrorMessage()
  const locale = normalizeProjectAgentLocale(useLocale())
  const assistantRuntime = useWorkspaceAssistantRuntime({
    projectId,
    episodeId,
    selectedScopeRef: selection?.selectedScopeRef ?? null,
    selectedAssetId: selection?.selectedAssetId ?? null,
  })
  const panelScopeKey = `${projectId}:${episodeId ?? ''}`
  const panelScopeKeyRef = useRef(panelScopeKey)
  panelScopeKeyRef.current = panelScopeKey
  const panelResize = useWorkspaceAssistantPanelResize()
  const panelLayout = buildWorkspaceAssistantPanelLayout(panelResize.width)
  const composer = useWorkspaceAssistantComposer(assistantRuntime.sendMessage, panelScopeKey)
  const { applyDraftRequest } = composer
  useEffect(() => {
    if (!draftRequest) return
    applyDraftRequest(draftRequest)
    onDraftRequestConsumed(draftRequest.requestId)
  }, [applyDraftRequest, draftRequest, onDraftRequestConsumed])
  const [mediaUploadPending, setMediaUploadPending] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const uploadAttachmentFiles = async (files: readonly File[]): Promise<void> => {
    if (mediaUploadPending) return
    const uploadScopeKey = panelScopeKey
    setAttachmentError(null)
    const mediaFiles = files.filter(isProjectAssistantMediaFile)
    const textFiles = files.filter((file) => !isProjectAssistantMediaFile(file))
    const validationCode = mediaFiles
      .map(validateProjectAssistantMediaAttachmentFile)
      .find((code) => code !== null)
      ?? textFiles.map(validateProjectAssistantTextAttachmentFile).find((code) => code !== null)
    if (validationCode) {
      setAttachmentError(resolveClientError(new Error(validationCode), t('attachments.mediaUploadFailed')))
      return
    }
    if (mediaFiles.length + composer.mediaAttachments.length > PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) {
      setAttachmentError(resolveClientError(new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY'), t('attachments.mediaUploadFailed')))
      return
    }
    if (textFiles.length + composer.attachments.length > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) {
      setAttachmentError(resolveClientError(new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY'), t('attachments.mediaUploadFailed')))
      return
    }
    setMediaUploadPending(true)
    try {
      const mediaRoom =
        PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES - composer.mediaAttachments.length
      for (const file of mediaFiles.slice(0, Math.max(mediaRoom, 0))) {
        const attachment = await uploadProjectAssistantMediaAttachment({
          projectId,
          file,
        })
        if (panelScopeKeyRef.current !== uploadScopeKey) return
        composer.addMediaAttachment(attachment)
      }
      const textRoom = PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES - composer.attachments.length
      for (const file of textFiles.slice(0, Math.max(textRoom, 0))) {
        const attachment = await uploadProjectAssistantTextAttachment({ file })
        if (panelScopeKeyRef.current !== uploadScopeKey) return
        composer.addAttachment(attachment)
      }
    } catch (error) {
      if (panelScopeKeyRef.current === uploadScopeKey) {
        setAttachmentError(resolveClientError(error, t('attachments.mediaUploadFailed')))
      }
    } finally {
      if (panelScopeKeyRef.current === uploadScopeKey) {
        setMediaUploadPending(false)
      }
    }
  }
  const attachmentPicker = useAttachmentFilePicker({
    accept: `${PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT},${PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT}`,
    disabled: assistantRuntime.pending || assistantRuntime.viewLoading,
    onFiles: (files) => {
      void uploadAttachmentFiles(files)
    },
  })
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null)
  const [dismissedSubagentIds, setDismissedSubagentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const visibleSubagents = useMemo(
    () =>
      assistantRuntime.subagents.filter(
        (subagent) => !dismissedSubagentIds.has(subagent.subagentId),
      ),
    [assistantRuntime.subagents, dismissedSubagentIds],
  )

  useEffect(() => {
    panelScopeKeyRef.current = panelScopeKey
    setMediaUploadPending(false)
    setAttachmentError(null)
    setSelectedSubagentId(null)
    setDismissedSubagentIds(new Set())
  }, [panelScopeKey])

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
    storageLoading: assistantRuntime.viewLoading,
    pending: assistantRuntime.pending,
    onAutoStartConsumed,
    sendMessage: assistantRuntime.sendMessage,
    sendHiddenMessage: assistantRuntime.sendHiddenMessage,
  })
  useWorkspaceAssistantCanvasFocus({
    view: assistantRuntime.view,
    storageLoading: assistantRuntime.viewLoading,
    onActiveOperationChange,
  })
  const taskBatches = useMemo(
    () => assistantRuntime.view?.followUpBatches ?? [],
    [assistantRuntime.view?.followUpBatches],
  )
  const pendingInteraction = assistantRuntime.pendingInteraction
  const serverPendingApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const activeChoiceCard =
    pendingInteraction?.kind === 'choice'
      ? { key: pendingInteraction.interactionId, data: pendingInteraction.card }
      : null
  const displayedActiveChoiceCard = serverPendingApproval ? null : activeChoiceCard
  const partComponents = useWorkspaceAssistantMessagePartComponents()
  const showAssistantReplyLoading = shouldShowWorkspaceAssistantReplyLoading({
    storageLoading: assistantRuntime.viewLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    hasPendingInteraction: Boolean(pendingInteraction),
  })
  const showRunFailureNotice = shouldShowWorkspaceAssistantRunFailureNotice({
    storageLoading: assistantRuntime.viewLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    currentTurnStatus: assistantRuntime.view?.currentTurn?.status ?? null,
  })
  const showInterruptedNotice =
    !assistantRuntime.viewLoading &&
    !assistantRuntime.replyInFlight &&
    assistantRuntime.view?.currentTurn?.status === 'interrupted'
  // Run, send, and Task failures all resolve through the same view resolver,
  // so every failure surface uses the canonical error catalogue instead of
  // panel-local sentences or model-written guesses.
  const localizeErrorCode = useCallback(
    (code: string) => (tErrors.has(code) ? tErrors(code) : null),
    [tErrors],
  )
  const unknownFailureFallback = tErrors('INTERNAL_ERROR')
  const formatFailureReference = useCallback(
    (id: string) => tErrors('referenceId', { id }),
    [tErrors],
  )
  const currentTurn = assistantRuntime.view?.currentTurn ?? null
  const runFailureView = resolveWorkspaceAssistantFailureView({
    facts: {
      code: currentTurn?.errorCode?.trim() || null,
      requestId: currentTurn?.requestId?.trim() || null,
    },
    localizeCode: localizeErrorCode,
    formatReference: formatFailureReference,
    unknownFallback: unknownFailureFallback,
  })
  const composerFailureView =
    showRunFailureNotice || !assistantRuntime.error
      ? null
      : resolveWorkspaceAssistantFailureView({
          facts: parseWorkspaceAssistantFailureText(assistantRuntime.error.message),
          localizeCode: localizeErrorCode,
          formatReference: formatFailureReference,
          unknownFallback: unknownFailureFallback,
        })
  // Undelivered marker + resend draft are derived from persisted facts only
  // (failed `user_turn` current run + rendered message order); see the
  // resolver's doc comment for the attribution boundary. No second copy of
  // the message or its attachments is stored anywhere.
  const undeliveredUserMessage = useMemo(
    () =>
      resolveWorkspaceAssistantUndeliveredUserMessage({
        messages: assistantRuntime.messages,
        showDeliveryFailureNotice: showRunFailureNotice || showInterruptedNotice,
        currentTurnSourceKind: currentTurn?.sourceKind ?? null,
        currentTurnSourceId: currentTurn?.sourceId ?? null,
      }),
    [
      assistantRuntime.messages,
      currentTurn?.sourceId,
      currentTurn?.sourceKind,
      showInterruptedNotice,
      showRunFailureNotice,
    ],
  )
  const resendDraft = useMemo(
    () => resolveWorkspaceAssistantResendDraft(undeliveredUserMessage),
    [undeliveredUserMessage],
  )
  const sendMessage = assistantRuntime.sendMessage
  const resendUndeliveredMessage = useCallback(() => {
    if (!resendDraft) return
    // A resend is a brand-new user_turn through the single send authority.
    // Its failures surface through chat.error/controlError exactly like
    // composer sends; nothing may escape to the React overlay.
    void sendMessage({
      text: resendDraft.text,
      attachments: resendDraft.attachments,
      mediaAttachments: resendDraft.mediaAttachments,
    }).catch(() => undefined)
  }, [resendDraft, sendMessage])
  const taskBatchViews = useMemo(
    () =>
      taskBatches.map((batch) => {
        const operationIds = Array.from(
          new Set(batch.tasks.flatMap((task) => (task.operationId ? [task.operationId] : []))),
        ).sort()
        const failures = Array.from(
          new Map(
            batch.tasks.flatMap((task) => {
              if (!task.errorCode) return []
              const failure = resolveWorkspaceAssistantFailureView({
                facts: {
                  code: task.errorCode?.trim() || null,
                  requestId: task.taskId,
                },
                localizeCode: localizeErrorCode,
                formatReference: formatFailureReference,
                unknownFallback: unknownFailureFallback,
              })
              return [[`${failure.headline}\u0000${failure.technical ?? ''}`, failure] as const]
            }),
          ).values(),
        )
        return { batch, operationIds, failures }
      }),
    [formatFailureReference, localizeErrorCode, taskBatches, unknownFailureFallback],
  )

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
          <WorkspaceAssistantRepeatedToolCallGroupProvider messages={assistantRuntime.messages}>
            <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
              <ThreadPrimitive.Root
                key={`${projectId}:${episodeId ?? ''}`}
                className="relative flex h-full min-h-0 flex-col"
              >
                <WorkspaceAssistantSettings />
                <WorkspaceAssistantSubagentTabs
                  subagents={visibleSubagents}
                  selectedSubagentId={selectedSubagentId}
                  onSelect={setSelectedSubagentId}
                  onDismiss={dismissSubagent}
                  primaryNeedsAttention={Boolean(
                    displayedActiveChoiceCard || serverPendingApproval,
                  )}
                />
                <ThreadPrimitive.Viewport
                  autoScroll
                  className={`min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-4 ${visibleSubagents.length > 0 ? 'pt-4' : 'pt-12'}`}
                  style={WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE}
                >
                  {selectedSubagentId ? (
                    <WorkspaceAssistantSubagentView
                      projectId={projectId}
                      subagent={
                        visibleSubagents.find((item) => item.subagentId === selectedSubagentId) ??
                        null
                      }
                      structuredOutputText={
                        assistantRuntime.subagentStructuredOutputs.get(selectedSubagentId) ?? null
                      }
                    />
                  ) : (
                    <WorkspaceAssistantRunningSurfaceProvider
                      activeTurn={assistantRuntime.replyInFlight}
                    >
                      <div className="min-w-0">
                        <div className="space-y-3">
                          <ThreadPrimitive.Messages>
                            {() => (
                              <WorkspaceAssistantThreadMessage
                                messagePartComponents={partComponents}
                                subagents={visibleSubagents}
                                onSelectSubagent={setSelectedSubagentId}
                                undeliveredUserMessageId={undeliveredUserMessage?.id ?? null}
                              />
                            )}
                          </ThreadPrimitive.Messages>
                          {showAssistantReplyLoading ? (
                            <WorkspaceAssistantPendingTurnPlaceholder
                              label={
                                assistantRuntime.backgroundFollowUpActive
                                  ? t('panel.backgroundFollowUpRunning')
                                  : undefined
                              }
                            />
                          ) : null}
                          {assistantRuntime.viewError ? (
                            <div
                              role="alert"
                              className="rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warn-fg)]"
                            >
                              {t('panel.sessionStateError')}
                            </div>
                          ) : null}
                          {showRunFailureNotice ? (
                            <WorkspaceAssistantRunFailureNotice
                              failure={runFailureView}
                              resend={
                                resendDraft
                                  ? {
                                      pending:
                                        assistantRuntime.pending || assistantRuntime.viewLoading,
                                      onResend: resendUndeliveredMessage,
                                    }
                                  : null
                              }
                            />
                          ) : null}
                          {showInterruptedNotice ? (
                            <WorkspaceAssistantRunFailureNotice
                              title={t('panel.turnInterruptedTitle')}
                              failure={{
                                tone: 'info',
                                headline: t('panel.turnInterruptedDescription'),
                                technical: currentTurn?.requestId
                                  ? formatFailureReference(currentTurn.requestId)
                                  : null,
                              }}
                              resend={
                                resendDraft
                                  ? {
                                      pending:
                                        assistantRuntime.pending || assistantRuntime.viewLoading,
                                      onResend: resendUndeliveredMessage,
                                    }
                                  : null
                              }
                            />
                          ) : null}
                          {!assistantRuntime.viewLoading
                            ? taskBatchViews.map((view) => (
                                <WorkspaceAssistantActiveRunCard
                                  key={view.batch.batchId}
                                  operationIds={view.operationIds}
                                  progress={view.batch.progress}
                                  failures={view.failures}
                                />
                              ))
                            : null}
                          {serverPendingApproval ? (
                            <ConfirmationActionCard
                              members={serverPendingApproval.members.map((member) => ({
                                operationId: member.operationId,
                                title: localizeProjectAgentOperationTitle(
                                  member.operationId,
                                  locale,
                                ),
                                operationPlan: member.operationPlan,
                              }))}
                              subtitle={t('cards.confirmationRequired')}
                              onConfirm={() =>
                                assistantRuntime.resolveApproval({
                                  decision: 'approve',
                                })
                              }
                              onCancel={() =>
                                assistantRuntime.resolveApproval({
                                  decision: 'reject',
                                })
                              }
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
                      {assistantRuntime.view?.thread?.plan ? (
                        <WorkspaceAssistantPlanCard
                          plan={assistantRuntime.view.thread.plan}
                          isRunActive={assistantRuntime.view.currentTurn?.status === 'running'}
                        />
                      ) : null}
                      <WorkspaceAssistantComposer
                        value={composer.text}
                        textareaRef={composer.textareaRef}
                        selection={selection}
                        error={composerFailureView}
                        pending={assistantRuntime.pending || assistantRuntime.viewLoading}
                        canStopReply={assistantRuntime.canStopReply}
                        attachments={composer.attachments}
                        mediaAttachments={composer.mediaAttachments}
                        attachDisabled={
                          composer.attachments.length >=
                            PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES &&
                          composer.mediaAttachments.length >=
                            PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES
                        }
                        mediaUploadPending={mediaUploadPending}
                        attachmentError={attachmentError}
                        onChange={composer.setText}
                        onSubmit={async () => {
                          setAttachmentError(null)
                          // The selected canvas image is delivered as a real
                          // media attachment (signed receipt from the single
                          // token authority), so the model actually sees it.
                          // A mint failure blocks the send with a visible
                          // error instead of silently sending a blind message.
                          let extraMediaAttachments: readonly ProjectAssistantMediaAttachment[] = []
                          if (selection?.mediaType === 'image') {
                            try {
                              extraMediaAttachments = [await mintProjectAssistantResourceAttachment({
                                projectId,
                                resourceId: selection.targetId,
                                previewUrl: selection.previewUrl,
                              })]
                            } catch (error) {
                              setAttachmentError(resolveClientError(error, t('attachments.mediaUploadFailed')))
                              return
                            }
                          }
                          // Send failures surface through chat.error/controlError
                          // (rendered under the composer); never as an unhandled
                          // rejection reaching the React overlay.
                          try {
                            await composer.submit({ extraMediaAttachments })
                          } catch {
                            return
                          }
                          // The selection is consumed by the delivered message;
                          // a lingering chip after send reads as "still pending".
                          if (selection) onClearSelection()
                        }}
                        onStopReply={assistantRuntime.stopReply}
                        onAttachClick={attachmentPicker.open}
                        onRemoveAttachment={composer.removeAttachment}
                        onRemoveMediaAttachment={composer.removeMediaAttachment}
                        onPasteMediaFiles={(files) => {
                          void uploadAttachmentFiles(files)
                        }}
                        onClearSelection={onClearSelection}
                      />
                    </div>
                  </div>
                ) : null}
              </ThreadPrimitive.Root>
            </AssistantRuntimeProvider>
          </WorkspaceAssistantRepeatedToolCallGroupProvider>
        </div>
      </div>
      {attachmentPicker.input}
    </aside>
  )
}
