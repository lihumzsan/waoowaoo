'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { TextAttachmentUploadDialog } from '@/components/project-assistant/TextAttachmentUploadDialog'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import type { ProjectAgentSessionState } from '@/lib/project-agent/session-state'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import type { WorkspaceAssistantSelectionContext } from '../canvas/ProjectWorkspaceCanvas'
import type { WorkspaceAssistantActiveFocusRequest } from '../workspace-assistant-focus'
import {
  AssistantChoiceCardView,
  ConfirmationActionCard,
  useWorkspaceAssistantMessagePartComponents,
  WorkspaceAssistantPendingTurnPlaceholder,
  WorkspaceAssistantThreadMessage,
} from './workspace-assistant/WorkspaceAssistantRenderers'
import { WorkspaceAssistantActiveRunCard } from './workspace-assistant/WorkspaceAssistantActiveRunCard'
import { WorkspaceAssistantComposer } from './workspace-assistant/WorkspaceAssistantComposer'
import {
  buildWorkspaceAssistantPanelLayout,
  WORKSPACE_ASSISTANT_TOP_OFFSET,
} from './workspace-assistant/panel-layout'
import { useWorkspaceAssistantCanvasFocus } from './workspace-assistant/useWorkspaceAssistantCanvasFocus'
import { useWorkspaceAssistantComposer } from './workspace-assistant/useWorkspaceAssistantComposer'
import { useWorkspaceAssistantMessageDispatch } from './workspace-assistant/useWorkspaceAssistantMessageDispatch'
import { useWorkspaceAssistantPanelResize } from './workspace-assistant/useWorkspaceAssistantPanelResize'
import { useWorkspaceAssistantPermissionMode } from './workspace-assistant/useWorkspaceAssistantPermissionMode'
import { useWorkspaceAssistantRuntime } from './workspace-assistant/useWorkspaceAssistantRuntime'
import { EditStylePreviewGenerationDataCard } from './workspace-assistant/EditStylePreviewGenerationDataCard'
import { useWorkspaceStylePreviewGenerationView } from './workspace-assistant/useWorkspaceStylePreviewGenerationView'
import {
  resolveWorkspaceAssistantActiveOperationPresentation,
  resolveWorkspaceAssistantAwaitingExternalTask,
  resolveWorkspaceAssistantAwaitingUserInput,
  resolveWorkspaceAssistantRunFailureDetail,
  shouldShowWorkspaceAssistantExternalTaskRunCard,
  shouldShowWorkspaceAssistantReplyLoading,
  shouldShowWorkspaceAssistantRunFailureNotice,
} from './workspace-assistant/workspace-assistant-panel-state'

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

export const WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
} satisfies CSSProperties

function WorkspaceAssistantRunFailureNotice({
  run,
}: {
  run: Pick<NonNullable<ProjectAgentSessionState['currentRun']>, 'errorCode' | 'errorMessage'> | null
}) {
  const t = useTranslations('assistantAgent')
  const tErrors = useTranslations('errors')
  const errorCode = run?.errorCode?.trim() ?? ''
  const detail = resolveWorkspaceAssistantRunFailureDetail({
    localizedError: errorCode && tErrors.has(errorCode) ? tErrors(errorCode) : null,
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
  const locale = normalizeProjectAgentLocale(useLocale())
  const [assistantPermissionMode, setAssistantPermissionMode] = useWorkspaceAssistantPermissionMode()
  const assistantRuntime = useWorkspaceAssistantRuntime({
    projectId,
    episodeId,
    selectedScopeRef: selection?.selectedScopeRef ?? null,
    selectedPanelId: selection?.selectedPanelId ?? null,
    selectedAssetId: selection?.selectedAssetId ?? null,
    assistantPermissionMode,
  })
  const panelResize = useWorkspaceAssistantPanelResize()
  const panelLayout = buildWorkspaceAssistantPanelLayout(panelResize.width)
  const composer = useWorkspaceAssistantComposer(assistantRuntime.sendMessage)
  const [stylePreviewDockCollapsed, setStylePreviewDockCollapsed] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

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
  const activeOperationPresentation = resolveWorkspaceAssistantActiveOperationPresentation(
    activeExternalTaskOperationId,
  )
  const activeExternalTasks = assistantRuntime.sessionState?.activeTasks ?? []
  const activeExternalTaskOperationIds = Array.from(new Set(
    activeExternalTasks.flatMap((task) => task.operationId ? [task.operationId] : []),
  )).sort()
  const pendingInteraction = assistantRuntime.pendingInteraction
  const serverPendingApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const activeChoiceCard = pendingInteraction?.kind === 'choice'
    ? { key: pendingInteraction.interruptionId, data: pendingInteraction.choiceCard }
    : null
  const stylePreviewChoiceCard = activeChoiceCard?.data.choiceType === 'style'
    ? activeChoiceCard
    : null
  const stylePreviewGenerationView = useWorkspaceStylePreviewGenerationView({
    projectId,
    episodeId,
    enabled: activeOperationPresentation === 'stylePreviewGeneration' || Boolean(stylePreviewChoiceCard),
  })
  const stylePreviewDockCardKey = stylePreviewGenerationView
    ? [
        stylePreviewChoiceCard?.data.cardId ?? 'generation',
        ...stylePreviewGenerationView.allCandidates.map((candidate) => candidate.id),
      ].join(':')
    : null
  useEffect(() => {
    setStylePreviewDockCollapsed(false)
  }, [stylePreviewDockCardKey])

  const displayedActiveChoiceCard = serverPendingApproval || activeChoiceCard?.data.choiceType === 'style'
    ? null
    : activeChoiceCard
  const partComponents = useWorkspaceAssistantMessagePartComponents({
    hideChoiceCards: true,
    onSubmitChoiceResponse: assistantRuntime.submitChoiceResponse,
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
    : assistantRuntime.error ? t('panel.sendErrorGeneric') : null

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
            <ThreadPrimitive.Root className="relative flex h-full min-h-0 flex-col">
              <ThreadPrimitive.Viewport
                autoScroll
                className="flex-1 overflow-y-auto px-5 pb-4 pt-4"
                style={WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE}
              >
                <div>
                  <div className="space-y-3">
                    <ThreadPrimitive.Messages>
                      {() => <WorkspaceAssistantThreadMessage messagePartComponents={partComponents} />}
                    </ThreadPrimitive.Messages>
                    {showAssistantReplyLoading ? <WorkspaceAssistantPendingTurnPlaceholder /> : null}
                    {assistantRuntime.sessionStateError ? (
                      <div role="alert" className="rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-[11px] leading-4 text-[var(--glass-tone-warn-fg)]">
                        {t('panel.sessionStateError')}
                      </div>
                    ) : null}
                    {showRunFailureNotice ? (
                      <WorkspaceAssistantRunFailureNotice run={assistantRuntime.sessionState?.currentRun ?? null} />
                    ) : null}
                    {showExternalTaskRunCard && activeExternalTaskOperationId ? (
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
                    {stylePreviewGenerationView ? (
                      stylePreviewDockCollapsed ? (
                        <button
                          type="button"
                          onClick={() => setStylePreviewDockCollapsed(false)}
                          className="flex w-full items-center gap-2 rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 px-3.5 py-2.5 text-left shadow-[0_2px_10px_rgba(15,23,42,0.04)] transition-colors hover:bg-neutral-50"
                        >
                          <AppIcon name="imageAlt" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--glass-text-primary)]">
                            {t('panel.stylePreviewDockCollapsed', { count: stylePreviewGenerationView.candidates.length })}
                          </span>
                          <span className="shrink-0 text-[12px] font-medium text-[var(--glass-text-tertiary)]">{t('panel.stylePreviewDockExpand')}</span>
                          <AppIcon name="chevronDown" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
                        </button>
                      ) : (
                        <EditStylePreviewGenerationDataCard
                          view={stylePreviewGenerationView}
                          choiceCard={stylePreviewChoiceCard?.data ?? null}
                          onSubmitChoiceResponse={assistantRuntime.submitChoiceResponse}
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
                      onSubmitChoiceResponse={assistantRuntime.submitChoiceResponse}
                    />
                  </div>
                ) : null}
                <div>
                  <WorkspaceAssistantComposer
                    value={composer.text}
                    error={composerError}
                    pending={assistantRuntime.pending || assistantRuntime.storageLoading}
                    canStopReply={assistantRuntime.canStopReply}
                    attachments={composer.attachments}
                    attachDisabled={composer.attachments.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES}
                    assistantPermissionMode={assistantPermissionMode}
                    onChange={composer.setText}
                    onSubmit={async () => {
                      setStylePreviewDockCollapsed(true)
                      await composer.submit()
                    }}
                    onStopReply={assistantRuntime.stopReply}
                    onAttachClick={() => composer.setAttachmentDialogOpen(true)}
                    onRemoveAttachment={composer.removeAttachment}
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
        open={composer.attachmentDialogOpen}
        disabled={
          assistantRuntime.pending
          || assistantRuntime.storageLoading
          || composer.attachments.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES
        }
        onClose={() => composer.setAttachmentDialogOpen(false)}
        onUploaded={composer.addAttachment}
      />
    </aside>
  )
}
