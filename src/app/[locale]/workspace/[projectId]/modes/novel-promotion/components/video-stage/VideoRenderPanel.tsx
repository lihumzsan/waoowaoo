import { getAspectRatioConfig } from '@/lib/constants'
import type { MutableRefObject } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilitySelections, CapabilityValue } from '@/lib/model-config-contract'
import { VideoPanelCard, type VideoPanel, type VideoModelOption, type MatchedVoiceLine, type FirstLastFrameParams, type VideoDurationBinding, type VideoGenerationOptions } from '../video'
import type { PromptField } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoPromptState'
import type {
  FirstLastFrameDurationStatus,
  FirstLastFramePromptEntry,
} from '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
import { resolvePanelFirstLastFrameGenerationOptions } from '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
import { paginateVideoPanels } from '@/lib/novel-promotion/stages/video-stage-runtime/video-panel-pagination'

interface VideoRenderPanelProps {
  allPanels: VideoPanel[]
  currentPage: number
  onPageChange: (page: number) => void
  linkedPanels: Map<string, boolean>
  highlightedPanelKey: string | null
  panelRefs: MutableRefObject<Map<string, HTMLDivElement>>
  videoRatio: string
  defaultVideoModel: string
  capabilityOverrides: CapabilitySelections
  userVideoModels?: VideoModelOption[]
  lipSyncEnabled?: boolean
  projectId: string
  episodeId: string
  runningVoiceLineIds: Set<string>
  panelVoiceLines: Map<string, MatchedVoiceLine[]>
  panelVideoPreference: Map<string, boolean>
  savingPrompts: Set<string>
  flModel: string
  flModelOptions: VideoModelOption[]
  flGenerationOptions: VideoGenerationOptions
  flGenerationOptionsByPanel: Map<string, VideoGenerationOptions>
  flCapabilityFields: Array<{
    field: string
    label: string
    options: CapabilityValue[]
    disabledOptions?: CapabilityValue[]
    value: CapabilityValue | undefined
  }>
  flMissingCapabilityFields: string[]
  promptEntries: Map<string, FirstLastFramePromptEntry>
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: FirstLastFrameParams,
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
    videoDurationBinding?: VideoDurationBinding,
    customPrompt?: string,
    customPromptEditedByUser?: boolean,
  ) => Promise<void>
  onUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
  onUpdatePanelVideoDurationBinding: (storyboardId: string, panelIndex: number, binding: VideoDurationBinding) => Promise<void>
  onRestorePreviousVideo: (storyboardId: string, panelIndex: number, panelId?: string) => Promise<void>
  onLipSync: (storyboardId: string, panelIndex: number, voiceLineId: string, panelId?: string) => Promise<void>
  onToggleLink: (panelKey: string, storyboardId: string, panelIndex: number) => Promise<void>
  onFlModelChange: (model: string) => void
  onFlCapabilityChange: (panelKey: string, field: string, rawValue: string) => Promise<void>
  onRestoreFlSmartDuration: (panelKey: string) => Promise<void>
  onFlPromptChange: (key: string, value: string) => void
  onSaveFlPrompt: (key: string, value: string) => Promise<void>
  onRegenerateFlPrompt: (key: string) => Promise<void>
  onGenerateFirstLastFrame: (
    firstStoryboardId: string,
    firstPanelIndex: number,
    lastStoryboardId: string,
    lastPanelIndex: number,
    panelKey: string,
    generationOptions?: VideoGenerationOptions,
    firstPanelId?: string,
  ) => Promise<void>
  onPreviewImage: (imageUrl: string | null) => void
  onToggleLipSyncVideo: (key: string, value: boolean) => void
  getNextPanel: (currentIndex: number) => VideoPanel | null
  isLinkedAsLastFrame: (currentIndex: number) => boolean
  getFirstLastFrameDurationStatus: (panelKey: string) => FirstLastFrameDurationStatus | null
  getLocalPrompt: (panelKey: string, externalPrompt?: string, field?: PromptField) => string
  updateLocalPrompt: (panelKey: string, value: string, field?: PromptField) => void
  savePrompt: (
    storyboardId: string,
    panelIndex: number,
    panelKey: string,
    value: string,
    field?: PromptField,
  ) => Promise<void>
}

export default function VideoRenderPanel({
  allPanels,
  currentPage,
  onPageChange,
  linkedPanels,
  highlightedPanelKey,
  panelRefs,
  videoRatio,
  defaultVideoModel,
  capabilityOverrides,
  userVideoModels,
  lipSyncEnabled = false,
  projectId,
  episodeId,
  runningVoiceLineIds,
  panelVoiceLines,
  panelVideoPreference,
  savingPrompts,
  flModel,
  flModelOptions,
  flGenerationOptions,
  flGenerationOptionsByPanel,
  flCapabilityFields,
  flMissingCapabilityFields,
  promptEntries,
  onGenerateVideo,
  onUpdatePanelVideoModel,
  onUpdatePanelVideoDurationBinding,
  onRestorePreviousVideo,
  onLipSync,
  onToggleLink,
  onFlModelChange,
  onFlCapabilityChange,
  onRestoreFlSmartDuration,
  onFlPromptChange,
  onSaveFlPrompt,
  onRegenerateFlPrompt,
  onGenerateFirstLastFrame,
  onPreviewImage,
  onToggleLipSyncVideo,
  getNextPanel,
  isLinkedAsLastFrame,
  getFirstLastFrameDurationStatus,
  getLocalPrompt,
  updateLocalPrompt,
  savePrompt,
}: VideoRenderPanelProps) {
  const t = useTranslations('video')
  const panelPage = paginateVideoPanels(allPanels, currentPage)

  return (
    <>
      <div className={`grid gap-4 ${getAspectRatioConfig(videoRatio).isVertical
        ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
        : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
      }`}>
        {panelPage.items.map((panel, pageIndex) => {
          const globalIndex = panelPage.startIndex + pageIndex
          const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
          const isLinked = linkedPanels.get(panelKey) || false
          const isLastFrame = isLinkedAsLastFrame(globalIndex)
          const nextPanel = getNextPanel(globalIndex)
          const prevPanel = globalIndex > 0 ? allPanels[globalIndex - 1] : null
          const hasNext = globalIndex < allPanels.length - 1
          const promptField: PromptField = isLinked ? 'firstLastFramePrompt' : 'videoPrompt'
          const flPromptEntry = isLinked ? promptEntries.get(panelKey) : undefined
          const panelFlGenerationOptions = resolvePanelFirstLastFrameGenerationOptions(
            panelKey,
            flGenerationOptions,
            flGenerationOptionsByPanel,
            panel.videoDurationBinding?.targetDurationSeconds,
          )
          const panelFlCapabilityFields = flCapabilityFields.map((field) => field.field === 'duration'
            ? { ...field, value: panelFlGenerationOptions.duration ?? field.value }
            : field)
          const flDurationStatus = isLinked
            ? getFirstLastFrameDurationStatus(panelKey)
            : null
          const localPrompt = isLinked
            ? (flPromptEntry?.value || '')
            : getLocalPrompt(panelKey, panel.textPanel?.video_prompt, promptField)
          const isSavingPrompt = isLinked
            ? flPromptEntry?.status === 'saving'
            : savingPrompts.has(`${promptField}:${panelKey}`)

          return (
            <div
              key={panelKey}
              ref={(element) => {
                if (element) panelRefs.current.set(panelKey, element)
                else panelRefs.current.delete(panelKey)
              }}
              className={`transition-all duration-500 ${highlightedPanelKey === panelKey
                ? 'ring-4 ring-[var(--glass-stroke-focus)] ring-offset-2 ring-offset-[var(--glass-bg-canvas)] rounded-2xl scale-[1.02]'
                : ''
              }`}
              style={{
                contentVisibility: 'auto',
                containIntrinsicSize: '0 720px',
              }}
            >
              <VideoPanelCard
                panel={{
                  ...panel,
                  lipSyncTaskRunning: panel.lipSyncTaskRunning || false,
                }}
                panelIndex={globalIndex}
                defaultVideoModel={defaultVideoModel}
                capabilityOverrides={capabilityOverrides}
                videoRatio={videoRatio}
                userVideoModels={userVideoModels}
                lipSyncEnabled={lipSyncEnabled}
                projectId={projectId}
                episodeId={episodeId}
                runningVoiceLineIds={runningVoiceLineIds}
                matchedVoiceLines={panelVoiceLines.get(panelKey) || []}
                onLipSync={onLipSync}
                showLipSyncVideo={panelVideoPreference.get(panelKey) ?? true}
                onToggleLipSyncVideo={onToggleLipSyncVideo}
                isLinked={isLinked}
                isLastFrame={isLastFrame}
                nextPanel={nextPanel}
                prevPanel={prevPanel}
                hasNext={hasNext}
                flModel={flModel}
                flModelOptions={flModelOptions}
                flGenerationOptions={panelFlGenerationOptions}
                flCapabilityFields={panelFlCapabilityFields}
                flMissingCapabilityFields={flMissingCapabilityFields}
                flPromptEntry={flPromptEntry}
                flDurationStatus={flDurationStatus}
                localPrompt={localPrompt}
                isSavingPrompt={isSavingPrompt}
                onUpdateLocalPrompt={(value) => {
                  if (isLinked) onFlPromptChange(panelKey, value)
                  else updateLocalPrompt(panelKey, value, promptField)
                }}
                onSavePrompt={(value) => isLinked
                  ? onSaveFlPrompt(panelKey, value)
                  : savePrompt(panel.storyboardId, panel.panelIndex, panelKey, value, promptField)}
                onGenerateVideo={onGenerateVideo}
                onUpdatePanelVideoModel={onUpdatePanelVideoModel}
                onUpdatePanelVideoDurationBinding={onUpdatePanelVideoDurationBinding}
                onRestorePreviousVideo={onRestorePreviousVideo}
                onToggleLink={onToggleLink}
                onFlModelChange={onFlModelChange}
                onFlCapabilityChange={(field, rawValue) => onFlCapabilityChange(panelKey, field, rawValue)}
                onRestoreFlSmartDuration={onRestoreFlSmartDuration}
                onFlPromptChange={onFlPromptChange}
                onRegenerateFlPrompt={onRegenerateFlPrompt}
                onGenerateFirstLastFrame={onGenerateFirstLastFrame}
                onPreviewImage={onPreviewImage}
              />
            </div>
          )
        })}
      </div>

      {panelPage.totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onPageChange(panelPage.page - 1)}
            disabled={panelPage.page <= 1}
            className="glass-btn-base glass-btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('pagination.previous')}
          </button>
          <span className="text-sm text-[var(--glass-text-tertiary)]">
            {t('pagination.status', { page: panelPage.page, totalPages: panelPage.totalPages })}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(panelPage.page + 1)}
            disabled={panelPage.page >= panelPage.totalPages}
            className="glass-btn-base glass-btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('pagination.next')}
          </button>
        </div>
      ) : null}
    </>
  )
}
