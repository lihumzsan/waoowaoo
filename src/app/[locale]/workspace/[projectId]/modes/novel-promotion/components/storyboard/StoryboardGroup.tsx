'use client'
import { useTranslations } from 'next-intl'

import { useCallback, useMemo } from 'react'
import ScreenplayDisplay from './ScreenplayDisplay'
import { StoryboardPanel } from './hooks/useStoryboardState'
import StoryboardGroupHeader from './StoryboardGroupHeader'
import StoryboardGroupActions from './StoryboardGroupActions'
import StoryboardPanelList from './StoryboardPanelList'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusOverlay from '@/components/task/TaskStatusOverlay'
import { useStoryboardGroupTaskErrors } from './hooks/useStoryboardGroupTaskErrors'
import { useStoryboardInsertVariantRuntime } from './hooks/useStoryboardInsertVariantRuntime'
import StoryboardGroupFailedAlert from './StoryboardGroupFailedAlert'
import StoryboardGroupDialogs from './StoryboardGroupDialogs'
import type { StoryboardGroupProps } from './StoryboardGroup.types'
import { AppIcon } from '@/components/ui/icons'
import {
  DIALOGUE_BEAT_BUDGET_SECONDS,
  estimateDialogueDurationSeconds,
} from '@/lib/novel-promotion/dialogue-beats'

export default function StoryboardGroup({
  storyboard,
  clip,
  sbIndex,
  totalStoryboards,
  textPanels,
  storyboardStartIndex,
  videoRatio,
  isSourceExpanded,
  isPanelListExpanded,
  isSubmittingStoryboardTask,
  isSelectingCandidate,
  isSubmittingStoryboardTextTask,
  hasAnyImage,
  failedError,
  savingPanels,
  deletingPanelIds,
  saveStateByPanel,
  hasUnsavedByPanel,
  modifyingPanels,
  submittingPanelImageIds,
  onToggleSource,
  onTogglePanelList,
  onMoveUp,
  onMoveDown,
  onRegenerateText,
  onAddPanel,
  onDeleteStoryboard,
  onGenerateAllIndividually,
  onPreviewImage,
  onCloseError,
  getPanelEditData,
  storyboardWorkflowOptions,
  defaultStoryboardWorkflow,
  onPanelUpdate,
  onPanelDelete,
  onOpenCharacterPicker,
  onOpenLocationPicker,
  onRemoveCharacter,
  onRemoveLocation,
  onRetryPanelSave,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  getPanelCandidates,
  onSelectPanelCandidateIndex,
  onConfirmPanelCandidate,
  onCancelPanelCandidate,
  formatClipTitle,
  movingClipId,
  onInsertPanel,
  insertingAfterPanelId,
  projectId,
  episodeId,
  onPanelVariant,
  submittingVariantPanelId,
}: StoryboardGroupProps) {
  const t = useTranslations('storyboard')

  const {
    insertModalOpen,
    insertAfterPanel,
    nextPanelForInsert,
    variantModalPanel,
    handleOpenInsertModal,
    handleCloseInsertModal,
    handleInsert,
    handleOpenVariantModal,
    handleCloseVariantModal,
    handleVariant,
  } = useStoryboardInsertVariantRuntime({
    storyboardId: storyboard.id,
    textPanels,
    onInsertPanel,
    onPanelVariant,
  })

  const panelOutputById = useMemo(() => {
    const map = new Map<string, { imageUrl: string | null; updatedAt: string | null }>()
    for (const panel of textPanels) {
      map.set(panel.id, {
        imageUrl: panel.imageUrl ?? null,
        updatedAt: panel.updatedAt ?? null,
      })
    }
    return map
  }, [textPanels])

  const {
    panelTaskErrorMap,
    clearPanelTaskError,
  } = useStoryboardGroupTaskErrors({
    projectId,
    episodeId,
    panelOutputById,
  })

  const isPanelTaskRunning = useCallback(
    (panel: StoryboardPanel) => {
      const taskIntent = (panel as StoryboardPanel & { imageTaskIntent?: string }).imageTaskIntent
      if (taskIntent === 'modify') return false

      const isTaskRunning = Boolean((panel as StoryboardPanel & { imageTaskRunning?: boolean }).imageTaskRunning)
      const isSubmitting = submittingPanelImageIds.has(panel.id)
      if (isTaskRunning || isSubmitting) return true

      const taskError = panelTaskErrorMap.get(panel.id)
      if (taskError) return false

      return false
    },
    [panelTaskErrorMap, submittingPanelImageIds],
  )

  const currentRunningCount = textPanels.filter(isPanelTaskRunning).length
  const pendingCount = textPanels.filter((panel) => !panel.imageUrl && !isPanelTaskRunning(panel)).length

  const dialogueCompliance = useMemo(() => {
    const dialoguePanels = textPanels.filter((panel) => !!panel.dialogueBeatId)
    if (dialoguePanels.length === 0) {
      return {
        label: t('group.dialogueComplianceNone'),
        title: t('group.dialogueComplianceNoneTitle'),
        tone: 'neutral' as const,
      }
    }

    const secondsByPanel = dialoguePanels.map((panel) => {
      if (typeof panel.estimatedDialogueSeconds === 'number' && Number.isFinite(panel.estimatedDialogueSeconds)) {
        return panel.estimatedDialogueSeconds
      }
      if (typeof panel.duration === 'number' && Number.isFinite(panel.duration)) {
        return panel.duration
      }
      return panel.source_text ? estimateDialogueDurationSeconds(panel.source_text) : null
    })
    if (secondsByPanel.some((seconds) => seconds === null)) {
      return {
        label: t('group.dialogueComplianceReview'),
        title: t('group.dialogueComplianceReviewTitle'),
        tone: 'warning' as const,
      }
    }
    if (secondsByPanel.some((seconds) => (seconds ?? 0) > DIALOGUE_BEAT_BUDGET_SECONDS)) {
      return {
        label: t('group.dialogueComplianceResplit'),
        title: t('group.dialogueComplianceResplitTitle', { seconds: DIALOGUE_BEAT_BUDGET_SECONDS }),
        tone: 'warning' as const,
      }
    }
    return {
      label: t('group.dialogueCompliancePassed'),
      title: t('group.dialogueCompliancePassedTitle', { count: dialoguePanels.length }),
      tone: 'pass' as const,
    }
  }, [t, textPanels])

  const groupOverlayState = useMemo(() => {
    if (!isSubmittingStoryboardTask && !isSelectingCandidate) return null
    return resolveTaskPresentationState({
      phase: 'processing',
      intent: isSelectingCandidate ? 'process' : hasAnyImage ? 'regenerate' : 'generate',
      resource: 'image',
      hasOutput: hasAnyImage,
    })
  }, [hasAnyImage, isSelectingCandidate, isSubmittingStoryboardTask])

  const handleRegeneratePanelImage = useCallback(
    (panelId: string, count?: number, force?: boolean, imageModel?: string) => {
      clearPanelTaskError(panelId)
      onRegeneratePanelImage(panelId, count, force, imageModel)
    },
    [clearPanelTaskError, onRegeneratePanelImage],
  )

  return (
    <div className={`glass-surface-elevated p-6 relative ${failedError ? 'border-2 border-[var(--glass-stroke-danger)] bg-[var(--glass-danger-ring)]' : ''}`}>
      {failedError && (
        <StoryboardGroupFailedAlert
          failedError={failedError}
          title={`警告 ${t('group.failed')}`}
          closeTitle={t('common.cancel')}
          onClose={onCloseError}
        />
      )}

      {(isSubmittingStoryboardTask || isSelectingCandidate) && (
        <TaskStatusOverlay
          state={groupOverlayState}
          className="z-10 rounded-lg bg-[var(--glass-bg-surface-modal)]/90"
        />
      )}

      <div className="mb-4 flex flex-col gap-3 pb-2 xl:flex-row xl:items-start xl:justify-between">
        <StoryboardGroupHeader
          clip={clip}
          sbIndex={sbIndex}
          totalStoryboards={totalStoryboards}
          movingClipId={movingClipId}
          storyboardClipId={storyboard.clipId}
          dialogueCompliance={dialogueCompliance}
          formatClipTitle={formatClipTitle}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
        <StoryboardGroupActions
          hasAnyImage={hasAnyImage}
          isSubmittingStoryboardTask={isSubmittingStoryboardTask}
          isSubmittingStoryboardTextTask={isSubmittingStoryboardTextTask}
          currentRunningCount={currentRunningCount}
          pendingCount={pendingCount}
          onRegenerateText={onRegenerateText}
          onGenerateAllIndividually={onGenerateAllIndividually}
          onAddPanel={onAddPanel}
          onDeleteStoryboard={onDeleteStoryboard}
        />
      </div>

      {clip && (
        <div className="mb-4">
          <button
            onClick={onToggleSource}
            className="glass-btn-base glass-btn-soft rounded-xl px-3 py-2 text-sm"
          >
            <AppIcon name="chevronRightMd" className={`h-4 w-4 transition-transform ${isSourceExpanded ? 'rotate-90' : ''}`} />
            <span>{clip.screenplay ? t('panel.stylePrompt') : t('panel.sourceText')}</span>
          </button>
          {isSourceExpanded && (
            <div className="mt-2 glass-surface-soft p-2">
              {clip.screenplay ? (
                <ScreenplayDisplay screenplay={clip.screenplay} originalContent={clip.content} />
              ) : (
                <div className="whitespace-pre-wrap p-3 text-sm text-[var(--glass-text-secondary)]">
                  {clip.content}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-stroke-base)] pt-4">
        <p className="min-w-0 text-sm text-[var(--glass-text-secondary)]">
          {t('group.panelSummary', {
            total: textPanels.length,
            pending: pendingCount,
            running: currentRunningCount,
          })}
        </p>
        <button
          type="button"
          onClick={onTogglePanelList}
          aria-expanded={isPanelListExpanded}
          aria-controls={`storyboard-panel-list-${storyboard.id}`}
          className="glass-btn-base glass-btn-soft shrink-0 rounded-xl px-3 py-2 text-sm"
        >
          <AppIcon
            name="chevronRightMd"
            className={`h-4 w-4 transition-transform ${isPanelListExpanded ? 'rotate-90' : ''}`}
          />
          <span>{t(isPanelListExpanded ? 'group.collapse' : 'group.expand')}</span>
        </button>
      </div>

      {isPanelListExpanded && (
        <div
          id={`storyboard-panel-list-${storyboard.id}`}
          role="region"
          aria-label={t('group.panelListLabel', { index: sbIndex + 1 })}
          className="mt-4"
        >
          <StoryboardPanelList
            storyboardId={storyboard.id}
            textPanels={textPanels}
            storyboardStartIndex={storyboardStartIndex}
            videoRatio={videoRatio}
            isSubmittingStoryboardTextTask={isSubmittingStoryboardTextTask}
            savingPanels={savingPanels}
            deletingPanelIds={deletingPanelIds}
            saveStateByPanel={saveStateByPanel}
            hasUnsavedByPanel={hasUnsavedByPanel}
            modifyingPanels={modifyingPanels}
            panelTaskErrorMap={panelTaskErrorMap}
            isPanelTaskRunning={isPanelTaskRunning}
            getPanelEditData={getPanelEditData}
            storyboardWorkflowOptions={storyboardWorkflowOptions}
            defaultStoryboardWorkflow={defaultStoryboardWorkflow}
            getPanelCandidates={getPanelCandidates}
            onPanelUpdate={onPanelUpdate}
            onPanelDelete={onPanelDelete}
            onOpenCharacterPicker={onOpenCharacterPicker}
            onOpenLocationPicker={onOpenLocationPicker}
            onRemoveCharacter={onRemoveCharacter}
            onRemoveLocation={onRemoveLocation}
            onRetryPanelSave={onRetryPanelSave}
            onRegeneratePanelImage={handleRegeneratePanelImage}
            onOpenEditModal={onOpenEditModal}
            onOpenAIDataModal={onOpenAIDataModal}
            onSelectPanelCandidateIndex={onSelectPanelCandidateIndex}
            onConfirmPanelCandidate={onConfirmPanelCandidate}
            onCancelPanelCandidate={onCancelPanelCandidate}
            onClearPanelTaskError={clearPanelTaskError}
            onPreviewImage={onPreviewImage}
            onInsertAfter={handleOpenInsertModal}
            onVariant={handleOpenVariantModal}
            isInsertDisabled={(panelId) =>
              isSubmittingStoryboardTextTask ||
              insertingAfterPanelId === panelId ||
              submittingVariantPanelId === panelId
            }
          />
        </div>
      )}

      <StoryboardGroupDialogs
        insertAfterPanel={insertAfterPanel}
        nextPanelForInsert={nextPanelForInsert}
        insertModalOpen={insertModalOpen}
        insertingAfterPanelId={insertingAfterPanelId}
        onCloseInsertModal={handleCloseInsertModal}
        onInsert={handleInsert}
        variantModalPanel={variantModalPanel}
        projectId={projectId}
        submittingVariantPanelId={submittingVariantPanelId}
        onCloseVariantModal={handleCloseVariantModal}
        onVariant={handleVariant}
      />
    </div>
  )
}
