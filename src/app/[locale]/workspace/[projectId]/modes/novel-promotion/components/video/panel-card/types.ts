import type { VideoPanel, MatchedVoiceLine, VideoModelOption, FirstLastFrameParams, VideoDurationBinding, VideoGenerationOptions } from '../types'
import type { CapabilitySelections, CapabilityValue } from '@/lib/model-config-contract'
import type {
  FirstLastFrameDurationStatus,
  FirstLastFramePromptEntry,
} from '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'

export interface VideoPanelCardShellProps {
  panel: VideoPanel
  panelIndex: number
  defaultVideoModel: string
  capabilityOverrides: CapabilitySelections
  videoRatio?: string
  userVideoModels?: VideoModelOption[]
  lipSyncEnabled?: boolean
  projectId: string
  episodeId?: string
  runningVoiceLineIds?: Set<string>
  matchedVoiceLines?: MatchedVoiceLine[]
  onLipSync?: (storyboardId: string, panelIndex: number, voiceLineId: string, panelId?: string) => Promise<void>
  showLipSyncVideo: boolean
  onToggleLipSyncVideo: (panelKey: string, value: boolean) => void
  isLinked: boolean
  isLastFrame: boolean
  nextPanel: VideoPanel | null
  prevPanel: VideoPanel | null
  hasNext: boolean
  flModel: string
  flModelOptions: VideoModelOption[]
  flGenerationOptions: VideoGenerationOptions
  flCapabilityFields: Array<{
    field: string
    label: string
    options: CapabilityValue[]
    disabledOptions?: CapabilityValue[]
    value: CapabilityValue | undefined
  }>
  flMissingCapabilityFields: string[]
  flPromptEntry?: FirstLastFramePromptEntry
  flDurationStatus?: FirstLastFrameDurationStatus | null
  localPrompt: string
  isSavingPrompt: boolean
  onUpdateLocalPrompt: (value: string) => void
  onSavePrompt: (value: string) => Promise<void>
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
  ) => void
  onUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => void
  onUpdatePanelVideoDurationBinding: (storyboardId: string, panelIndex: number, binding: VideoDurationBinding) => void
  onRestorePreviousVideo: (storyboardId: string, panelIndex: number, panelId?: string) => void
  onToggleLink: (panelKey: string, storyboardId: string, panelIndex: number) => void
  onFlModelChange: (model: string) => void
  onFlCapabilityChange: (field: string, rawValue: string) => void
  onRestoreFlSmartDuration: (panelKey: string) => Promise<void>
  onFlPromptChange: (panelKey: string, value: string) => void
  onRegenerateFlPrompt: (panelKey: string) => Promise<void>
  onGenerateFirstLastFrame: (
    firstStoryboardId: string,
    firstPanelIndex: number,
    lastStoryboardId: string,
    lastPanelIndex: number,
    panelKey: string,
    generationOptions?: VideoGenerationOptions,
    firstPanelId?: string,
  ) => void
  onPreviewImage?: (imageUrl: string) => void
}
