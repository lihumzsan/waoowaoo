import React from 'react'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import { AppIcon } from '@/components/ui/icons'
import type { VideoPanelRuntime } from './hooks/useVideoPanelActions'
import type { VideoDurationBinding } from '../types'
import { normalizeVideoDurationBinding } from '@/lib/video-duration/audio-binding'

interface VideoPanelCardBodyProps {
  runtime: VideoPanelRuntime
}

export default function VideoPanelCardBody({ runtime }: VideoPanelCardBodyProps) {
  const {
    t,
    tCommon,
    panel,
    panelIndex,
    panelKey,
    layout,
    actions,
    taskStatus,
    videoModel,
    durationBinding,
    promptEditor,
    voiceManager,
    lipSync,
    computed,
  } = runtime
  const safeTranslate = (key: string | undefined, fallback = ''): string => {
    if (!key) return fallback
    try {
      return t(key as never)
    } catch {
      return fallback
    }
  }

  const renderCapabilityLabel = (field: {
    field: string
    label: string
    labelKey?: string
    unitKey?: string
  }): string => {
    const labelText = safeTranslate(field.labelKey, safeTranslate(`capability.${field.field}`, field.label))
    const unitText = safeTranslate(field.unitKey)
    return unitText ? `${labelText} (${unitText})` : labelText
  }

  const isFirstLastFrameGenerated = panel.videoGenerationMode === 'firstlastframe' && !!panel.videoUrl
  const showsIncomingLinkBadge = layout.isLastFrame && !!layout.prevPanel
  const showsOutgoingLinkBadge = layout.isLinked && !!layout.nextPanel
  const showsFirstLastFrameActions = layout.isLinked && !!layout.nextPanel
  const flPromptActive = layout.flPromptEntry?.status === 'queued'
    || layout.flPromptEntry?.status === 'processing'
    || layout.flPromptEntry?.status === 'saving'
  const blocksVideoGenerationForMissingAudioTiming = durationBinding.isAudioDriven
    && !durationBinding.hasValidAudioSelection

  const persistDurationBinding = (nextBinding: VideoDurationBinding) => {
    durationBinding.setLocalBinding(nextBinding)
    void actions.onUpdatePanelVideoDurationBinding(
      panel.storyboardId,
      panel.panelIndex,
      nextBinding,
    )
  }
  const readSelectedVideoDurationSeconds = (override?: unknown): number | null => {
    const raw = override ?? videoModel.generationOptions.duration
    const value = typeof raw === 'string' ? Number(raw) : raw
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Number(value.toFixed(2))
      : null
  }
  const applySelectedVideoDurationTarget = (nextBinding: VideoDurationBinding, override?: unknown): VideoDurationBinding => {
    const targetDurationSeconds = readSelectedVideoDurationSeconds(override)
    if (targetDurationSeconds !== null) {
      nextBinding.targetDurationSeconds = targetDurationSeconds
    }
    return nextBinding
  }

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="px-2 py-0.5 bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] rounded font-medium">{panel.textPanel?.shot_type || t('panelCard.unknownShotType')}</span>
        {panel.textPanel?.duration && <span className="text-[var(--glass-text-tertiary)]">{panel.textPanel.duration}{t('promptModal.duration')}</span>}
      </div>

      <p className="text-sm text-[var(--glass-text-secondary)] line-clamp-2">{panel.textPanel?.description}</p>

      <div className="mt-3 pt-3 border-t border-[var(--glass-stroke-base)]">
        {(showsIncomingLinkBadge || showsOutgoingLinkBadge) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {showsIncomingLinkBadge && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${showsOutgoingLinkBadge
                    ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
                    : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)] border border-[var(--glass-stroke-base)]'
                  }`}
              >
                <AppIcon name={showsOutgoingLinkBadge ? 'link' : 'unplug'} className="w-3 h-3" />
                {t('firstLastFrame.asLastFrameFor', { number: panelIndex })}
              </span>
            )}
            {showsOutgoingLinkBadge && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                <AppIcon name="link" className="w-3 h-3" />
                {t('firstLastFrame.asFirstFrameFor', { number: panelIndex + 2 })}
              </span>
            )}
          </div>
        )}

        <>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('promptModal.promptLabel')}</span>
              {!promptEditor.isEditing && (
                <button disabled={flPromptActive} onClick={promptEditor.handleStartEdit} className="text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-info-fg)] transition-colors p-0.5 disabled:opacity-50">
                  <AppIcon name="edit" className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {promptEditor.isEditing ? (
              <div className="relative mb-3">
                <textarea
                  value={layout.isLinked ? (layout.flPromptEntry?.value || '') : promptEditor.editingPrompt}
                  disabled={flPromptActive}
                  onChange={(event) => {
                    if (layout.isLinked) actions.onFlPromptChange(panelKey, event.target.value)
                    else promptEditor.setEditingPrompt(event.target.value)
                  }}
                  autoFocus
                  className="w-full text-xs p-2 pr-16 border border-[var(--glass-stroke-focus)] rounded-lg bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--glass-tone-info-fg)] resize-none"
                  rows={3}
                  placeholder={t('promptModal.placeholder')}
                />
                <div className="absolute right-1 top-1 flex flex-col gap-1">
                  <button onClick={promptEditor.handleSave} disabled={promptEditor.isSavingPrompt || flPromptActive} className="px-2 py-1 text-[10px] bg-[var(--glass-accent-from)] text-white rounded">{promptEditor.isSavingPrompt ? '...' : t('panelCard.save')}</button>
                  {!layout.isLinked && (
                    <button onClick={promptEditor.handleCancelEdit} disabled={promptEditor.isSavingPrompt} className="px-2 py-1 text-[10px] bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] rounded">{t('panelCard.cancel')}</button>
                  )}
                </div>
              </div>
            ) : (
              <div onClick={flPromptActive ? undefined : promptEditor.handleStartEdit} className={`text-xs p-2 border border-[var(--glass-stroke-base)] rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] ${flPromptActive ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                {promptEditor.localPrompt || <span className="text-[var(--glass-text-tertiary)] italic">{t('panelCard.clickToEditPrompt')}</span>}
              </div>
            )}

            {layout.isLinked && layout.flPromptEntry?.status !== 'idle' && (
              <div className={`mt-2 rounded-lg px-2 py-1.5 text-[11px] ${layout.flPromptEntry?.status === 'error'
                ? 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
                : 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
              }`}>
                {layout.flPromptEntry?.status === 'queued' && t('firstLastFrame.promptQueued')}
                {layout.flPromptEntry?.status === 'processing' && t('firstLastFrame.promptProcessing')}
                {layout.flPromptEntry?.status === 'saving' && t('firstLastFrame.promptSaving')}
                {layout.flPromptEntry?.status === 'error' && (layout.flPromptEntry.errorMessage || t('firstLastFrame.promptError'))}
              </div>
            )}
            {layout.isLinked && layout.flPromptEntry?.fallbackUsed && (
              <div className="mt-2 rounded-lg bg-[var(--glass-tone-warning-bg)] px-2 py-1.5 text-[11px] text-[var(--glass-tone-warning-fg)]">
                {t('firstLastFrame.promptFallbackWarning')}
              </div>
            )}
            {layout.isLinked && (
              <button
                type="button"
                onClick={() => { void actions.onRegenerateFlPrompt(panelKey) }}
                disabled={flPromptActive}
                className="mt-2 text-xs text-[var(--glass-tone-info-fg)] underline"
              >
                {layout.flPromptEntry?.status === 'error' || layout.flPromptEntry?.fallbackUsed
                  ? t('firstLastFrame.retryPrompt')
                  : t('firstLastFrame.regeneratePrompt')}
              </button>
            )}

            {showsFirstLastFrameActions ? (() => {
              const linkedNextPanel = layout.nextPanel!
              return (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => actions.onGenerateFirstLastFrame(
                        panel.storyboardId,
                        panel.panelIndex,
                        linkedNextPanel.storyboardId,
                        linkedNextPanel.panelIndex,
                        panelKey,
                        layout.flGenerationOptions,
                        panel.panelId,
                      )}
                      disabled={
                        taskStatus.isVideoTaskRunning
                        || flPromptActive
                        || layout.flPromptEntry?.ready === false
                        || !panel.imageUrl
                        || !linkedNextPanel.imageUrl
                        || !layout.flModel
                        || layout.flMissingCapabilityFields.length > 0
                      }
                      className="flex-shrink-0 min-w-[120px] py-2 px-3 text-sm font-medium rounded-lg shadow-sm transition-all disabled:opacity-50 bg-[var(--glass-accent-from)] text-white"
                    >
                      {isFirstLastFrameGenerated ? t('firstLastFrame.regenerateVideo') : taskStatus.isVideoTaskRunning ? taskStatus.taskRunningVideoLabel : t('firstLastFrame.generate')}
                    </button>
                    <div
                      className={`flex-1 min-w-0 ${flPromptActive ? 'pointer-events-none opacity-60' : ''}`}
                      data-prompt-config-disabled={flPromptActive ? 'true' : 'false'}
                      aria-disabled={flPromptActive}
                    >
                      <ModelCapabilityDropdown
                        compact
                        models={layout.flModelOptions}
                        value={layout.flModel || undefined}
                        onModelChange={actions.onFlModelChange}
                        capabilityFields={layout.flCapabilityFields.map((field) => ({
                          field: field.field,
                          label: field.label,
                          options: field.options,
                          disabledOptions: field.disabledOptions,
                        }))}
                        capabilityOverrides={layout.flGenerationOptions}
                        onCapabilityChange={(field, rawValue) => actions.onFlCapabilityChange(field, rawValue)}
                        placeholder={t('panelCard.selectModel')}
                      />
                    </div>
                  </div>
                  {layout.flDurationStatus ? (
                    <div className="mt-1 rounded-lg bg-[var(--glass-bg-muted)] px-2 py-1.5 text-[10px] text-[var(--glass-text-tertiary)]">
                      <span>
                        {layout.flDurationStatus.source === 'smart' && `时长来源：智能推荐 ${layout.flDurationStatus.durationSeconds}s`}
                        {layout.flDurationStatus.source === 'manual' && `时长来源：手动 ${layout.flDurationStatus.durationSeconds}s`}
                        {layout.flDurationStatus.source === 'default' && `时长来源：默认 ${layout.flDurationStatus.durationSeconds}s`}
                        {layout.flDurationStatus.source === 'analyzing' && `时长来源：智能分析中，当前 ${layout.flDurationStatus.durationSeconds}s`}
                        {layout.flDurationStatus.reason ? `，${layout.flDurationStatus.reason}` : ''}
                      </span>
                      {layout.flDurationStatus.canRestoreSmart && (
                        <button
                          type="button"
                          onClick={() => { void actions.onRestoreFlSmartDuration(panelKey) }}
                          disabled={flPromptActive}
                          className="ml-2 text-[var(--glass-tone-info-fg)] underline disabled:opacity-50"
                        >
                          恢复智能推荐
                        </button>
                      )}
                    </div>
                  ) : null}
                </>
              )
            })() : (
              <>
                <div className="mb-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">时长来源</span>
                    {durationBinding.timing ? (
                      <span className="text-[10px] text-[var(--glass-text-tertiary)]">{durationBinding.selectedCount} 条音频</span>
                    ) : null}
                  </div>
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => persistDurationBinding({ mode: 'manual', voiceLineIds: [] })}
                      className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                        !durationBinding.isAudioDriven
                          ? 'bg-[var(--glass-accent-from)] text-white'
                          : 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)]'
                      }`}
                    >
                      手动
                    </button>
                    <button
                      type="button"
                      disabled={!durationBinding.hasAvailableVoiceLines}
                      onClick={() => {
                        const nextBinding = normalizeVideoDurationBinding(durationBinding.localBinding)
                        nextBinding.mode = 'match_audio'
                        if ((nextBinding.voiceLineIds?.length ?? 0) === 0 && durationBinding.availableVoiceLines[0]?.id) {
                          nextBinding.voiceLineIds = [durationBinding.availableVoiceLines[0].id]
                        }
                        persistDurationBinding(applySelectedVideoDurationTarget(nextBinding))
                      }}
                      className={`rounded-full px-3 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                        durationBinding.isAudioDriven
                          ? 'bg-[var(--glass-accent-from)] text-white'
                          : 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)]'
                      }`}
                    >
                      关联音频
                    </button>
                  </div>

                  {durationBinding.isAudioDriven && (
                    <div className="space-y-2">
                      {durationBinding.availableVoiceLines.length > 0 ? (
                        <div className="space-y-1.5">
                          {durationBinding.availableVoiceLines.map((voiceLine) => {
                            const checked = durationBinding.selectedVoiceLineIds.includes(voiceLine.id)
                            const durationSeconds = typeof voiceLine.audioDuration === 'number'
                              ? (voiceLine.audioDuration / 1000).toFixed(1)
                              : null

                            return (
                              <label
                                key={voiceLine.id}
                                className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1.5"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const nextBinding = normalizeVideoDurationBinding(durationBinding.localBinding)
                                    nextBinding.mode = 'match_audio'
                                    const nextIds = new Set(nextBinding.voiceLineIds ?? [])
                                    if (nextIds.has(voiceLine.id)) nextIds.delete(voiceLine.id)
                                    else nextIds.add(voiceLine.id)
                                    nextBinding.voiceLineIds = Array.from(nextIds)
                                    persistDurationBinding(applySelectedVideoDurationTarget(nextBinding))
                                  }}
                                  className="mt-0.5 h-3.5 w-3.5"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-medium text-[var(--glass-text-primary)]">
                                    {voiceLine.speaker}
                                    {durationSeconds ? <span className="ml-1 text-[var(--glass-text-tertiary)]">{durationSeconds}s</span> : null}
                                  </div>
                                  <div className="line-clamp-2 text-[10px] text-[var(--glass-text-secondary)]">{voiceLine.content}</div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--glass-text-tertiary)]">
                          当前镜头还没有可用音频，先生成配音后才能按音频时长驱动视频。
                        </div>
                      )}

                      {durationBinding.timing ? (
                        <div className="space-y-1.5">
                          {durationBinding.timing.canGenerate ? (
                            <>
                              <div className="flex items-center gap-2">
                                <label className="shrink-0 text-[11px] font-medium text-[var(--glass-text-tertiary)]">视频时长</label>
                                <select
                                  value={durationBinding.timing.targetDurationSeconds.toFixed(2)}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value)
                                    if (!Number.isFinite(nextValue) || nextValue <= 0) return
                                    const nextBinding = normalizeVideoDurationBinding(durationBinding.localBinding)
                                    nextBinding.mode = 'match_audio'
                                    nextBinding.targetDurationSeconds = nextValue
                                    persistDurationBinding(nextBinding)
                                  }}
                                  className="min-w-0 flex-1 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1 text-[11px] text-[var(--glass-text-primary)] outline-none"
                                >
                                  {durationBinding.targetDurationOptions.map((option) => (
                                    <option key={option.toFixed(2)} value={option.toFixed(2)}>
                                      {option.toFixed(1)}s {Math.abs(option - durationBinding.timing!.audioDurationSeconds) < 0.01 ? '配音时长' : '含前奏/余韵'}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="rounded-lg bg-[var(--glass-tone-info-bg)] px-2 py-1.5 text-[10px] text-[var(--glass-tone-info-fg)]">
                                配音 {durationBinding.timing.audioDurationSeconds.toFixed(1)}s，视频 {durationBinding.timing.targetDurationSeconds.toFixed(1)}s / {durationBinding.timing.targetFrameCount} 帧，前奏 {durationBinding.timing.preRollSeconds.toFixed(1)}s，余韵 {durationBinding.timing.postRollSeconds.toFixed(1)}s
                              </div>
                            </>
                          ) : (
                            <div className="rounded-lg bg-[var(--glass-tone-warning-bg)] px-2 py-1.5 text-[10px] text-[var(--glass-tone-warning-fg)]">
                              当前音频 {durationBinding.timing.audioDurationSeconds.toFixed(1)}s，当前工作流上限 {durationBinding.timing.maxDurationSeconds?.toFixed(1) ?? '未知'}s，请切换长视频工作流或拆分音频/镜头后生成。
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg bg-[var(--glass-tone-warning-bg)] px-2 py-1.5 text-[10px] text-[var(--glass-tone-warning-fg)]">
                          请选择至少一条带时长的音频。
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      actions.onGenerateVideo(
                        panel.storyboardId,
                        panel.panelIndex,
                        videoModel.selectedModel,
                        undefined,
                        videoModel.generationOptions,
                        panel.panelId,
                        durationBinding.localBinding,
                        promptEditor.localPrompt,
                        panel.videoPromptEditedByUser === true,
                      )}
                    disabled={
                      taskStatus.isVideoTaskRunning
                      || !panel.imageUrl
                      || !videoModel.selectedModel
                      || videoModel.missingCapabilityFields.length > 0
                      || blocksVideoGenerationForMissingAudioTiming
                    }
                    className="flex-shrink-0 min-w-[90px] py-2 px-3 text-sm font-medium rounded-lg shadow-sm transition-all disabled:opacity-50 bg-[var(--glass-accent-from)] text-white"
                  >
                    {panel.videoUrl ? t('stage.hasSynced') : taskStatus.isVideoTaskRunning ? taskStatus.taskRunningVideoLabel : t('panelCard.generateVideo')}
                  </button>
                  <div className="flex-1 min-w-0">
                    <ModelCapabilityDropdown
                      compact
                      models={videoModel.videoModelOptions}
                      value={videoModel.selectedModel || undefined}
                      onModelChange={(modelKey) => {
                        videoModel.setSelectedModel(modelKey)
                        void actions.onUpdatePanelVideoModel(panel.storyboardId, panel.panelIndex, modelKey)
                      }}
                      capabilityFields={videoModel.capabilityFields.map((field) => ({
                        field: field.field,
                        label: renderCapabilityLabel(field),
                        options: field.options,
                        disabledOptions: field.disabledOptions,
                        recommendedValue: field.recommendedValue,
                      }))}
                      capabilityOverrides={videoModel.generationOptions}
                      onCapabilityChange={(field, rawValue) => {
                        videoModel.setCapabilityValue(field, rawValue)
                        if (field !== 'duration' || !durationBinding.isAudioDriven) return
                        const nextTargetDuration = readSelectedVideoDurationSeconds(rawValue)
                        if (nextTargetDuration === null) return
                        const nextBinding = normalizeVideoDurationBinding(durationBinding.localBinding)
                        nextBinding.mode = 'match_audio'
                        nextBinding.targetDurationSeconds = nextTargetDuration
                        persistDurationBinding(nextBinding)
                      }}
                      placeholder={t('panelCard.selectModel')}
                    />
                  </div>
                </div>

                {computed.showLipSyncSection && (
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <button
                        onClick={computed.canLipSync ? lipSync.handleStartLipSync : undefined}
                        disabled={!computed.canLipSync || taskStatus.isLipSyncTaskRunning || lipSync.executingLipSync}
                        className="flex-1 py-1.5 text-xs rounded-lg transition-all flex items-center justify-center gap-1 bg-[var(--glass-accent-from)] text-white disabled:opacity-50"
                      >
                        {taskStatus.isLipSyncTaskRunning || lipSync.executingLipSync ? (
                          <TaskStatusInline state={taskStatus.lipSyncInlineState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : (
                          <>{t('panelCard.lipSync')}</>
                        )}
                      </button>

                      {(taskStatus.isLipSyncTaskRunning || panel.lipSyncVideoUrl) && voiceManager.hasMatchedAudio && (
                        <button onClick={lipSync.handleStartLipSync} disabled={lipSync.executingLipSync} className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg bg-[var(--glass-tone-warning-fg)] text-white">
                          {t('panelCard.redo')}
                        </button>
                      )}
                    </div>

                    {voiceManager.audioGenerateError && (
                      <div className="mt-1 p-1.5 bg-[var(--glass-tone-danger-bg)] border border-[var(--glass-stroke-danger)] rounded text-[10px] text-[var(--glass-tone-danger-fg)]">
                        {voiceManager.audioGenerateError}
                      </div>
                    )}

                    {voiceManager.localVoiceLines.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {voiceManager.localVoiceLines.map((voiceLine) => {
                          const isVoiceTaskRunning = voiceManager.isVoiceLineTaskRunning(voiceLine.id)
                          const voiceAudioRunningState = isVoiceTaskRunning
                            ? resolveTaskPresentationState({ phase: 'processing', intent: 'generate', resource: 'audio', hasOutput: !!voiceLine.audioUrl })
                            : null

                          return (
                            <div key={voiceLine.id} className="flex items-start gap-1.5 p-1.5 bg-[var(--glass-bg-muted)] rounded text-[10px]">
                              {voiceLine.audioUrl ? (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    voiceManager.handlePlayVoiceLine(voiceLine)
                                  }}
                                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors bg-[var(--glass-bg-muted)]"
                                  title={voiceManager.playingVoiceLineId === voiceLine.id ? t('panelCard.stopVoice') : t('panelCard.play')}
                                >
                                  <AppIcon name="play" className="w-3 h-3" />
                                </button>
                              ) : (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void voiceManager.handleGenerateAudio(voiceLine)
                                  }}
                                  disabled={isVoiceTaskRunning}
                                  className="flex-shrink-0 px-1.5 py-0.5 bg-[var(--glass-accent-from)] text-white rounded disabled:opacity-50"
                                  title={t('panelCard.generateAudio')}
                                >
                                  {isVoiceTaskRunning ? (
                                    <TaskStatusInline state={voiceAudioRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                                  ) : (
                                    tCommon('generate')
                                  )}
                                </button>
                              )}
                              <div className="flex-1 min-w-0">
                                <span className="text-[var(--glass-text-tertiary)]">{voiceLine.speaker}: </span>
                                <span className="text-[var(--glass-text-secondary)]">&ldquo;{voiceLine.content}&rdquo;</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
        </>
      </div>
    </div>
  )
}
