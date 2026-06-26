import type { Edge, Node } from '@xyflow/react'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { TaskRuntimeStateLike, TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'
import type { StoryboardPanelImageGenerationMode } from '@/lib/storyboard/grid-image-groups'
import type { EditFirstDurationTier } from '@/lib/edit-script/duration-tier'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'

export type WorkspaceCanvasNodeKind =
  | 'analysis'
  | 'shot'
  | 'imageAsset'
  | 'videoClip'
  | 'finalTimeline'
  | 'editScreenplay'
  | 'editStylePreview'
  | 'editStyleBible'
  | 'editDirectorDecoupage'
  | 'editPipelineStep'
  | 'editProcessGroup'
  | 'editScript'
  | 'editCinematographyShotPlan'
  | 'spaceConsistency'
  | 'storyboardPanelGeneration'
  | 'videoPlan'
  | 'bgmScore'
  | 'editRequiredAsset'
  | 'editAssetGroup'

export type WorkspaceCanvasTargetType = 'episode' | 'storyboard' | 'panel' | 'videoGroup' | 'editScreenplay' | 'editStylePreview' | 'editStyleBible' | 'editDirectorDecoupage' | 'editPipelineStep' | 'editScript' | 'editCinematographyShotPlan' | 'storyboardPanelGeneration' | 'editAssetRequirement' | 'projectCharacter' | 'projectLocation'

export type WorkspaceCanvasNodeAction =
  | {
      readonly type: 'generate_edit_screenplay'
      readonly prompt: string
      readonly durationTier: EditFirstDurationTier
      readonly aspectRatio: EditScriptVideoRatio
    }
  | { readonly type: 'generate_edit_director_decoupage'; readonly screenplayId?: string }
  | { readonly type: 'generate_edit_script'; readonly screenplayId?: string }
  | { readonly type: 'generate_edit_cinematography_shot_plan'; readonly editScriptId: string }
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
  | { readonly type: 'insert_panel'; readonly storyboardId: string; readonly panelId: string; readonly userInput: string }
  | {
      readonly type: 'create_panel_variant'
      readonly storyboardId: string
      readonly panelId: string
      readonly variant: {
        readonly title: string
        readonly description: string
        readonly shot_type: string
        readonly camera_move: string
        readonly video_prompt: string
      }
      readonly includeCharacterAssets: boolean
      readonly includeLocationAsset: boolean
    }
  | { readonly type: 'generate_image'; readonly panelId: string }
  | {
      readonly type: 'generate_storyboard_grid_images'
      readonly episodeId: string
      readonly editScriptId: string
      readonly sourceVideoBlockId: string
      readonly panelIds: readonly string[]
      readonly generationMode: StoryboardPanelImageGenerationMode
    }
  | { readonly type: 'select_candidate'; readonly panelId: string; readonly imageUrl: string }
  | { readonly type: 'cancel_candidate'; readonly panelId: string }
  | {
      readonly type: 'modify_image'
      readonly storyboardId: string
      readonly panelIndex: number
      readonly modifyPrompt: string
      readonly extraImageUrls: readonly string[]
    }
  | { readonly type: 'download_images' }
  | {
      readonly type: 'generate_video'
      readonly storyboardId: string
      readonly panelIndex: number
      readonly panelId: string
      readonly generationOptions?: Record<string, string | number | boolean>
      readonly firstLastFrame?: {
        readonly lastFrameStoryboardId: string
        readonly lastFramePanelIndex: number
        readonly customPrompt?: string
      }
    }
  | {
      readonly type: 'update_video_prompt'
      readonly storyboardId: string
      readonly panelIndex: number
      readonly value: string
      readonly field?: 'imagePrompt' | 'videoPrompt' | 'firstLastFramePrompt'
    }
  | {
      readonly type: 'update_video_plan_prompt'
      readonly editScriptId: string
      readonly blockIndex: number
      readonly prompt: string
    }
  | {
      readonly type: 'open_video_block_arrangement'
      readonly editScriptId: string
      readonly blockIndex: number
    }
  | {
      readonly type: 'update_edit_asset_requirement_description'
      readonly editScriptId: string
      readonly requirementId: string
      readonly description: string
    }
  | { readonly type: 'update_panel_video_model'; readonly storyboardId: string; readonly panelIndex: number; readonly model: string }
  | { readonly type: 'toggle_panel_link'; readonly storyboardId: string; readonly panelIndex: number; readonly linked: boolean }
  | {
      readonly type: 'generate_all_videos'
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'generate_video_group'
      readonly gridMode: '2x2' | '3x3'
      readonly shotNumbers: readonly number[]
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'generate_asset_reference_video'
      readonly blockIndex: number
      readonly referenceImageUrls: readonly string[]
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | { readonly type: 'render_final_video' }
  | { readonly type: 'generate_bgm_score' }
  | { readonly type: 'generate_edit_assets'; readonly editScriptId: string }
  | { readonly type: 'generate_edit_asset'; readonly editScriptId: string; readonly requirementId: string }
  | { readonly type: 'regenerate_edit_asset_image'; readonly assetId: string; readonly kind: 'character' | 'location' }
  | { readonly type: 'generate_edit_storyboard'; readonly editScriptId: string }
  | { readonly type: 'generate_edit_storyboard_spatial_blocking'; readonly editScriptId: string }

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
  readonly photographyRules?: string | null
  readonly shotBlocking?: Record<string, unknown> | null
  readonly actingNotes?: string | null
  readonly storyboardTextJson?: string | null
  readonly photographyPlan?: string | null
  readonly errorMessage?: string | null
}

export interface WorkspaceCanvasImageDetails {
  readonly imagePrompt?: string | null
  readonly description?: string | null
  readonly candidateImages: readonly string[]
  readonly imageHistory?: string | null
  readonly sketchImageUrl?: string | null
  readonly previousImageUrl?: string | null
  readonly errorMessage?: string | null
}

export interface WorkspaceCanvasVideoDetails {
  readonly videoPrompt?: string | null
  readonly firstLastFramePrompt?: string | null
  readonly videoGenerationMode?: string | null
  readonly lastVideoGenerationOptions?: readonly WorkspaceCanvasTextLine[]
  readonly videoUrl?: string | null
  readonly videoModel?: string | null
  readonly linkedToNextPanel?: boolean | null
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

export interface WorkspaceCanvasBgmScoreTimedTextSection {
  readonly category?: string | null
  readonly title: string
  readonly purpose?: string | null
  readonly startSec?: number | null
  readonly endSec?: number | null
  readonly content: string
}

export interface WorkspaceCanvasEditScriptDetails {
  readonly screenplayText?: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly shots: readonly {
    readonly shotNumber: number
    readonly durationSec: number
    readonly dramaticPurpose: string
    readonly visibleAction: string
    readonly audienceFocus: string
    readonly viewpoint: string
    readonly revealPlan: string
    readonly performanceBeat: string
    readonly continuityIn: string
    readonly continuityOut: string
    readonly charactersAndScene: string
    readonly imagePrompt?: string | null
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

export interface WorkspaceCanvasEditScreenplayDetails {
  readonly screenplayText: string
  readonly userPrompt: string
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
  readonly blockIndex: number
  readonly kind: 'single' | 'group'
  readonly videoGroupId?: string | null
  readonly shotNumbers: readonly number[]
  readonly durationSec: number
  readonly gridMode?: '2x2' | '3x3'
  readonly reason: string
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
    readonly shotNumbers: readonly number[]
  }[]
  readonly validationMessage?: string | null
}

export interface WorkspaceCanvasEditAssetDetails {
  readonly editScriptId: string
  readonly requirementId: string
  readonly kind: 'character' | 'location'
  readonly description: string
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

export interface WorkspaceCanvasSpaceConsistencyDetails {
  readonly storyboardId: string
  readonly stage?: string | null
  readonly spatialProfileCount: number
  readonly cameraPlanCount: number
  readonly spatialProfiles: readonly {
    readonly requirementId?: string | null
    readonly targetId?: string | null
    readonly name?: string | null
    readonly shotNumbers: readonly number[]
    readonly sceneSummary?: string | null
    readonly anchors: readonly {
      readonly label?: string | null
      readonly screenArea?: string | null
      readonly depthLayer?: string | null
      readonly spatialRelations: readonly string[]
    }[]
    readonly depthLayout?: {
      readonly foreground?: string | null
      readonly midground?: string | null
      readonly background?: string | null
    } | null
    readonly lightingDirection?: string | null
    readonly rawProfile?: unknown | null
  }[]
  readonly cameraPlans: readonly {
    readonly panelIndex?: number | null
    readonly sourceShotNumber?: number | null
    readonly sourceVideoBlockId?: string | null
    readonly shotScale?: string | null
    readonly cameraPosition?: string | null
    readonly cameraHeight?: string | null
    readonly cameraAngle?: string | null
    readonly composition?: string | null
    readonly cameraMovement?: string | null
    readonly lensAndDepth?: string | null
    readonly screenDirection?: string | null
    readonly aestheticIntent?: string | null
    readonly emotionalEffect?: string | null
    readonly continuityNote?: string | null
    readonly shotBlocking?: Record<string, unknown> | null
  }[]
}

export interface WorkspaceCanvasStreamPresentation {
  readonly isStreaming: boolean
  readonly activeItemKey?: string | null
  readonly displayedItemKeys: readonly string[]
  readonly pinnedItemKeys: readonly string[]
  readonly revealedFieldCountByKey: Readonly<Record<string, number>>
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
  readonly statusLabel: string
  readonly isRunning?: boolean
  readonly focusHighlighted?: boolean
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
  readonly secondaryActionLabel?: string
  readonly secondaryAction?: WorkspaceCanvasNodeAction
  readonly tertiaryActionLabel?: string
  readonly tertiaryAction?: WorkspaceCanvasNodeAction
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
  readonly editScreenplayDetails?: WorkspaceCanvasEditScreenplayDetails
  readonly styleBibleDetails?: WorkspaceCanvasStyleBibleDetails
  readonly editPipelineStepDetails?: WorkspaceCanvasEditPipelineStepDetails
  readonly editProcessGroupDetails?: WorkspaceCanvasEditProcessGroupDetails
  readonly editScriptDetails?: WorkspaceCanvasEditScriptDetails
  readonly spaceConsistencyDetails?: WorkspaceCanvasSpaceConsistencyDetails
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
