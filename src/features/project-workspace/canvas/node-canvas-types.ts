import type { Edge, Node } from '@xyflow/react'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { TaskRuntimeStateLike, TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'
import type { BillingActionQuotePreview } from '@/lib/billing/action-quote-preview'
import type { WorkspaceCanvasArtifactPhase } from './artifact-phase'

export type WorkspaceCanvasNodeKind =
  | 'shot'
  | 'imageAsset'
  | 'videoClip'
  | 'finalTimeline'
  | 'editSourceScript'
  | 'editBible'
  | 'editStylePreview'
  | 'editStyleBible'
  | 'editPipelineStep'
  | 'editProcessGroup'
  | 'editScript'
  | 'editShotExecutionPlan'
  | 'videoPlan'
  | 'bgmScore'
  | 'soundscape'
  | 'editRequiredAsset'
  | 'editAssetGroup'

export type WorkspaceCanvasTargetType = 'episode' | 'storyboard' | 'panel' | 'videoGroup' | 'editSourceScript' | 'editBible' | 'editStylePreview' | 'editStyleBible' | 'editPipelineStep' | 'editScript' | 'editShotExecutionPlan' | 'editAssetRequirement' | 'projectCharacter' | 'projectLocation'

export type WorkspaceCanvasNodeAction =
  | {
      readonly type: 'ingest_script'
      readonly prompt: string
    }
  | { readonly type: 'generate_edit_script' }
  | { readonly type: 'generate_edit_shot_execution_plan'; readonly editScriptId: string }
  | { readonly type: 'open_asset_library'; readonly characterId?: string | null }
  | {
      readonly type: 'update_panel'
      readonly storyboardId: string
      readonly panelIndex: number
      readonly panelId: string
      readonly data: Record<string, unknown>
    }
  | { readonly type: 'delete_panel'; readonly storyboardId: string; readonly panelId: string }
  | { readonly type: 'copy_panel'; readonly panelId: string }
  | { readonly type: 'generate_image'; readonly panelId: string }
  | { readonly type: 'select_candidate'; readonly panelId: string; readonly imageUrl: string }
  | { readonly type: 'cancel_candidate'; readonly panelId: string }
  | {
      readonly type: 'generate_video'
      readonly storyboardId: string
      readonly panelIndex: number
      readonly panelId: string
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'update_video_prompt'
      readonly storyboardId: string
      readonly panelIndex: number
      readonly value: string
      readonly field?: 'imagePrompt' | 'videoPrompt'
    }
  | {
      readonly type: 'update_edit_asset_requirement_description'
      readonly editScriptId: string
      readonly requirementId: string
      readonly description: string
    }
  | { readonly type: 'update_panel_video_model'; readonly storyboardId: string; readonly panelIndex: number; readonly model: string }
  | {
      readonly type: 'generate_all_videos'
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'generate_video_group'
      readonly gridMode: '2x2' | '3x3'
      readonly shotIds: readonly string[]
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'generate_asset_reference_video'
      readonly segmentIndex: number
      readonly referenceImageUrls: readonly string[]
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | { readonly type: 'render_final_video' }
  | { readonly type: 'generate_bgm_score' }
  | { readonly type: 'generate_soundscape' }
  | { readonly type: 'generate_edit_assets'; readonly editScriptId: string }
  | { readonly type: 'generate_edit_asset'; readonly editScriptId: string; readonly requirementId: string }
  | { readonly type: 'regenerate_edit_asset_image'; readonly assetId: string; readonly kind: 'character' | 'location' }
  | { readonly type: 'generate_edit_storyboard'; readonly editScriptId: string }

export type WorkspaceCanvasNodeActionHandler = (
  action: WorkspaceCanvasNodeAction,
  nodeId?: string,
) => Promise<void> | void

export interface WorkspaceCanvasAssetRef {
  readonly name: string
  readonly appearance?: string | null
}

export interface WorkspaceCanvasTextLine {
  readonly kind: 'action' | 'dialogue' | 'voiceover' | 'text'
  readonly speaker?: string | null
  readonly text: string
}

export interface WorkspaceCanvasShotDetails {
  readonly shotType?: string | null
  readonly cameraMove?: string | null
  readonly characters: readonly WorkspaceCanvasAssetRef[]
  readonly location?: string | null
  readonly props: readonly string[]
  readonly srtSegment?: string | null
  readonly timeRange?: string | null
  readonly duration?: number | null
  readonly imagePrompt?: string | null
  readonly videoPrompt?: string | null
  readonly executionSnapshot?: Record<string, unknown> | null
  readonly renderFacts?: Record<string, unknown> | null
  readonly actingNotes?: string | null
  readonly storyboardTextJson?: string | null
  readonly errorMessage?: string | null
}

export interface WorkspaceCanvasImageDetails {
  readonly imagePrompt?: string | null
  readonly description?: string | null
  readonly candidateImages: readonly string[]
  readonly errorMessage?: string | null
}

export interface WorkspaceCanvasVideoDetails {
  readonly videoPrompt?: string | null
  readonly lastVideoGenerationOptions?: readonly WorkspaceCanvasTextLine[]
  readonly videoUrl?: string | null
  readonly videoModel?: string | null
  readonly errorMessage?: string | null
}

export interface WorkspaceCanvasFinalDetails {
  readonly totalShots: number
  readonly totalImages: number
  readonly totalVideos: number
  readonly totalDuration?: number | null
  readonly orderedVideoLabels: readonly string[]
  readonly outputUrl?: string | null
  readonly renderStatus?: string | null
}

export interface WorkspaceCanvasBgmScoreDetails {
  readonly status?: string | null
  readonly durationSeconds?: number | null
  readonly musicModel?: string | null
  readonly hasPromptDesign: boolean
  readonly promptDesignMissing: boolean
  readonly designSectionCount: number
  readonly promptSectionCount: number
  readonly virtualLayerCount: number
  readonly mixUrl?: string | null
  readonly errorMessage?: string | null
  readonly scoreOverview?: string | null
  readonly designSections: readonly WorkspaceCanvasBgmScoreTimedTextSection[]
  readonly promptSections: readonly WorkspaceCanvasBgmScoreTimedTextSection[]
  readonly virtualLayers: readonly {
    readonly name: string
    readonly purpose: string
    readonly content: string
  }[]
  readonly finalPrompt?: string | null
}

export interface WorkspaceCanvasSoundscapeDetails {
  readonly status?: string | null
  readonly decision?: 'soundscape' | 'none_needed' | null
  readonly soundEffectModel?: string | null
  readonly sourceCount: number
  readonly sectionCount: number
  readonly sources: readonly {
    readonly sourceId: string
    readonly environmentFingerprint: string
    readonly prompt: string
    readonly loopDurationSeconds: number
    readonly promptInfluence: number
  }[]
  readonly sections: readonly {
    readonly sourceId: string
    readonly fromShotId: string
    readonly toShotId: string
    readonly perspective: string
    readonly intensity: string
    readonly transitionIn: string
    readonly transitionOut: string
  }[]
  readonly mixUrl?: string | null
  readonly errorMessage?: string | null
}

export interface WorkspaceCanvasBgmScoreTimedTextSection {
  readonly category?: string | null
  readonly title: string
  readonly purpose?: string | null
  readonly startSec?: number | null
  readonly endSec?: number | null
  readonly content: string
}

export interface WorkspaceCanvasEditScriptDetails {
  readonly bibleText?: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly shots: readonly {
    readonly shotId: string
    readonly shotNumber: number
    readonly durationSec: number
    readonly sceneName: string
    readonly action: string
    readonly characters: readonly string[]
    readonly keyObjects: readonly string[]
    readonly imagePrompt?: string | null
    readonly dialogue: readonly string[]
    readonly sound: string
    readonly imageUrl?: string | null
    readonly videoUrl?: string | null
  }[]
}

export interface WorkspaceCanvasEditPipelineStepItem {
  readonly title: string
  readonly fields: readonly {
    readonly label: string
    readonly value: string
  }[]
  readonly body?: string | null
  readonly chips?: readonly string[]
}

export interface WorkspaceCanvasEditPipelineStepDetails {
  readonly items: readonly WorkspaceCanvasEditPipelineStepItem[]
}

export interface WorkspaceCanvasEditProcessStep {
  readonly key: string
  readonly badge: string
  readonly title: string
  readonly statusLabel: string
  readonly items: readonly WorkspaceCanvasEditPipelineStepItem[]
}

export interface WorkspaceCanvasEditProcessGroupDetails {
  readonly steps: readonly WorkspaceCanvasEditProcessStep[]
}

export interface WorkspaceCanvasEditBibleDetails {
  readonly bibleText: string
  readonly bible?: unknown | null
  readonly beatSheet?: unknown | null
  readonly ledger?: unknown | null
  readonly emotionalCurve?: unknown | null
  readonly chapters: readonly {
    readonly id: string
    readonly chapterIndex: number
    readonly title: string
    readonly summary: string
    readonly targetDurationSec: number
    readonly status: string
    readonly renderStatus?: string | null
    readonly outputMediaId?: string | null
  }[]
}

export interface WorkspaceCanvasSourceScriptDetails {
  readonly sourceDocumentId?: string | null
  readonly sourceText: string
  readonly scriptStructure?: unknown | null
}

export interface WorkspaceCanvasStyleBibleVisualPolicy {
  readonly imageFilterPrompt?: string | null
  readonly lightingPrompt?: string | null
  readonly colorPrompt?: string | null
  readonly texturePrompt?: string | null
  readonly compositionPrompt?: string | null
}

export interface WorkspaceCanvasStyleBibleCameraPolicy {
  readonly movementPrompt?: string | null
  readonly lensAndDepthPrompt?: string | null
  readonly videoRhythmPrompt?: string | null
}

export interface WorkspaceCanvasStyleBibleSoundPolicy {
  readonly soundFilterPrompt?: string | null
}

export interface WorkspaceCanvasStyleBibleDetails {
  readonly rawUserStyle?: string | null
  readonly styleSummary?: string | null
  readonly visual: WorkspaceCanvasStyleBibleVisualPolicy
  readonly camera: WorkspaceCanvasStyleBibleCameraPolicy
  readonly sound: WorkspaceCanvasStyleBibleSoundPolicy
}

export interface WorkspaceCanvasVideoPlanDetails {
  readonly editScriptId: string
  readonly segmentIndex: number
  readonly kind: 'group'
  readonly videoGroupId?: string | null
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly durationSec: number
  readonly gridMode?: '2x2' | '3x3'
  readonly continuity: string
  readonly prompt?: string | null
  readonly assetReferenceVideoModel?: string | null
  readonly outputUrl?: string | null
  readonly outputAspectRatio?: number | null
  readonly errorMessage?: string | null
  readonly sourceImages: readonly {
    readonly panelId?: string | null
    readonly storyboardId?: string | null
    readonly panelIndex?: number | null
    readonly shotNumber: number
    readonly imageUrl?: string | null
    readonly aspectRatio?: number | null
  }[]
  readonly assetReferences?: readonly {
    readonly id: string
    readonly name: string
    readonly kind: 'character' | 'location'
    readonly imageUrl?: string | null
    readonly shotIds: readonly string[]
    readonly shotNumbers: readonly number[]
  }[]
  readonly validationMessage?: string | null
}

export interface WorkspaceCanvasEditAssetDetails {
  readonly editScriptId: string
  readonly requirementId: string
  readonly kind: 'character' | 'location'
  readonly description: string
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly targetId?: string | null
  readonly taskTargetType?: 'CharacterAppearance' | 'LocationImage' | null
  readonly taskTargetId?: string | null
  readonly errorMessage?: string | null
  readonly spatialProfileJson?: unknown | null
  readonly spatialProfileStatus?: LocationSpatialProfileStatus | null
  readonly spatialProfileError?: string | null
  readonly spatialProfileAnalyzedAt?: string | Date | null
  readonly spatialProfileModel?: string | null
}

export interface WorkspaceCanvasEditAssetGroupItem {
  readonly requirementId: string
  readonly kind: 'character' | 'location'
  readonly name: string
  readonly eyebrow: string
  readonly description: string
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly statusLabel: string
  readonly isRunning: boolean
  readonly previewImageUrl?: string | null
  readonly runtimeTarget?: TaskRuntimeTarget | null
  readonly taskProgress?: TaskRuntimeStateLike | null
  readonly action?: WorkspaceCanvasNodeAction
  readonly actionLabel?: string
}

export interface WorkspaceCanvasEditAssetGroupDetails {
  readonly editScriptId: string
  readonly assets: readonly WorkspaceCanvasEditAssetGroupItem[]
}

export interface WorkspaceCanvasStreamPresentation {
  readonly isStreaming: boolean
  readonly activeItemKey?: string | null
  readonly displayedItemKeys: readonly string[]
  readonly pinnedItemKeys: readonly string[]
  readonly revealedFieldCountByKey: Readonly<Record<string, number>>
}

export type WorkspaceCanvasNodeDisclosureMode = 'collapsed' | 'expanded' | 'streaming'

export interface WorkspaceCanvasNodeDisclosureState {
  readonly canToggle: boolean
  readonly effectiveExpanded: boolean
  readonly mode: WorkspaceCanvasNodeDisclosureMode
  readonly isStreamingExpanded: boolean
  readonly collapseWhenStreamCompletes: boolean
}

export interface WorkspaceCanvasNodeData extends Record<string, unknown> {
  readonly nodeId?: string
  readonly projectId?: string
  readonly episodeName?: string
  readonly kind: WorkspaceCanvasNodeKind
  readonly layoutNodeType: CanvasLayoutNodeType
  readonly targetType: WorkspaceCanvasTargetType
  readonly targetId: string
  readonly storyboardId?: string
  readonly panelIndex?: number
  readonly title: string
  readonly eyebrow: string
  readonly body: string
  readonly meta: string
  readonly artifactPhase?: WorkspaceCanvasArtifactPhase
  readonly statusLabel: string
  readonly isRunning?: boolean
  readonly focusHighlighted?: boolean
  readonly disclosure?: WorkspaceCanvasNodeDisclosureState
  readonly streamPresentation?: WorkspaceCanvasStreamPresentation
  readonly taskProgress?: TaskRuntimeStateLike | null
  readonly runtimeTargets?: readonly TaskRuntimeTarget[]
  readonly width: number
  readonly height: number
  readonly layoutBasePosition?: {
    readonly x: number
    readonly y: number
  }
  readonly actionLabel?: string
  readonly action?: WorkspaceCanvasNodeAction
  readonly actionBillingQuote?: BillingActionQuotePreview
  readonly secondaryActionLabel?: string
  readonly secondaryAction?: WorkspaceCanvasNodeAction
  readonly secondaryActionBillingQuote?: BillingActionQuotePreview
  readonly tertiaryActionLabel?: string
  readonly tertiaryAction?: WorkspaceCanvasNodeAction
  readonly tertiaryActionBillingQuote?: BillingActionQuotePreview
  readonly actionDisabled?: boolean
  readonly onAction?: WorkspaceCanvasNodeActionHandler
  readonly expanded?: boolean
  readonly expandedLayout?: 'stack' | 'wide'
  readonly defaultExpanded?: boolean
  readonly onToggleExpanded?: (nodeId: string) => void
  readonly onMeasureNodeSize?: (nodeId: string, size: { readonly width: number; readonly height: number }) => void
  readonly indexLabel?: string
  readonly previewImageUrl?: string | null
  readonly previewAspectRatio?: number | null
  readonly previewDisplayHeight?: number | null
  /** 待生成媒体的加载背景图(用户选中的视觉风格图);无则退回模糊磨砂底 */
  readonly loadingStyleImageUrl?: string | null
  readonly shotDetails?: WorkspaceCanvasShotDetails
  readonly imageDetails?: WorkspaceCanvasImageDetails
  readonly videoDetails?: WorkspaceCanvasVideoDetails
  readonly finalDetails?: WorkspaceCanvasFinalDetails
  readonly bgmScoreDetails?: WorkspaceCanvasBgmScoreDetails
  readonly soundscapeDetails?: WorkspaceCanvasSoundscapeDetails
  readonly sourceScriptDetails?: WorkspaceCanvasSourceScriptDetails
  readonly editBibleDetails?: WorkspaceCanvasEditBibleDetails
  readonly styleBibleDetails?: WorkspaceCanvasStyleBibleDetails
  readonly editPipelineStepDetails?: WorkspaceCanvasEditPipelineStepDetails
  readonly editProcessGroupDetails?: WorkspaceCanvasEditProcessGroupDetails
  readonly editScriptDetails?: WorkspaceCanvasEditScriptDetails
  readonly videoPlanDetails?: WorkspaceCanvasVideoPlanDetails
  readonly editAssetDetails?: WorkspaceCanvasEditAssetDetails
  readonly editAssetGroupDetails?: WorkspaceCanvasEditAssetGroupDetails
}

export type WorkspaceCanvasFlowNode = Node<WorkspaceCanvasNodeData, 'workspaceNode'>
export type WorkspaceCanvasFlowEdge = Edge

export interface WorkspaceCanvasProjection {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly edges: readonly WorkspaceCanvasFlowEdge[]
}
