import type { Edge, Node } from '@xyflow/react'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'

export type WorkspaceCanvasNodeKind =
  | 'storyInput'
  | 'analysis'
  | 'scriptClip'
  | 'shot'
  | 'imageAsset'
  | 'videoClip'
  | 'finalTimeline'
  | 'editScreenplay'
  | 'editStyleBible'
  | 'editPipelineStep'
  | 'editScript'
  | 'spaceConsistency'
  | 'videoPlan'
  | 'bgmScore'
  | 'editRequiredAsset'

export type WorkspaceCanvasTargetType = 'episode' | 'clip' | 'storyboard' | 'panel' | 'videoGroup' | 'editScreenplay' | 'editStyleBible' | 'editPipelineStep' | 'editScript' | 'editAssetRequirement' | 'projectCharacter' | 'projectLocation'

export type WorkspaceCanvasNodeAction =
  | { readonly type: 'update_story'; readonly value: string }
  | { readonly type: 'generate_edit_screenplay'; readonly prompt: string }
  | { readonly type: 'generate_edit_script'; readonly screenplayId?: string }
  | { readonly type: 'regenerate_storyboard_text'; readonly storyboardId: string }
  | { readonly type: 'update_clip'; readonly clipId: string; readonly data: Record<string, unknown> }
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
      readonly videoModel?: string
      readonly generationOptions?: Record<string, string | number | boolean>
      readonly firstLastFrame?: {
        readonly lastFrameStoryboardId: string
        readonly lastFramePanelIndex: number
        readonly flModel: string
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
      readonly videoModel?: string
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'generate_video_group'
      readonly videoModel: string
      readonly gridMode: '2x2' | '3x3'
      readonly shotNumbers: readonly number[]
      readonly generationOptions?: Record<string, string | number | boolean>
    }
  | {
      readonly type: 'generate_asset_reference_video'
      readonly videoModel: string
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
  | { readonly type: 'generate_edit_storyboard_coordinates'; readonly editScriptId: string }

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

export interface WorkspaceCanvasScriptScene {
  readonly sceneNumber?: number | null
  readonly heading?: string | null
  readonly description?: string | null
  readonly characters: readonly string[]
  readonly lines: readonly WorkspaceCanvasTextLine[]
}

export interface WorkspaceCanvasScriptDetails {
  readonly originalText: string
  readonly screenplayText?: string | null
  readonly scenes: readonly WorkspaceCanvasScriptScene[]
  readonly characters: readonly WorkspaceCanvasAssetRef[]
  readonly locations: readonly string[]
  readonly props: readonly string[]
  readonly timeRange?: string | null
  readonly duration?: number | null
  readonly shotCount?: number | null
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
  readonly actingNotes?: string | null
  readonly storyboardTextJson?: string | null
  readonly photographyPlan?: string | null
  readonly errorMessage?: string | null
  readonly promptShot?: {
    readonly sequence?: string | null
    readonly locations?: string | null
    readonly characters?: string | null
    readonly plot?: string | null
    readonly pov?: string | null
    readonly imagePrompt?: string | null
    readonly scale?: string | null
    readonly module?: string | null
    readonly focus?: string | null
    readonly zhSummarize?: string | null
  } | null
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
  readonly negativePrompt?: string | null
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
    readonly visualAction: string
    readonly charactersAndScene: string
    readonly camera: string
    readonly videoPrompt: string
    readonly sound: string
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

export interface WorkspaceCanvasEditScreenplayDetails {
  readonly screenplayText: string
  readonly userPrompt: string
}

export interface WorkspaceCanvasStyleBibleVisualPolicy {
  readonly negativePrompt?: string | null
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
  readonly hardBans: readonly string[]
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
}

export interface WorkspaceCanvasSpaceConsistencyDetails {
  readonly storyboardId: string
  readonly stage?: string | null
  readonly floorPlanCount: number
  readonly overlayCount: number
  readonly cameraPlanCount: number
  readonly artifacts: readonly {
    readonly id: string
    readonly kind: string
    readonly sourceVideoBlockId?: string | null
    readonly groupIndex?: number | null
    readonly prompt?: string | null
    readonly imageUrl?: string | null
    readonly status?: string | null
    readonly errorMessage?: string | null
  }[]
  readonly blocks: readonly {
    readonly sourceVideoBlockId?: string | null
    readonly classification?: string | null
    readonly skipped?: boolean | null
    readonly reason?: string | null
    readonly cinematicTranslation?: string | null
    readonly coordinates: readonly {
      readonly name?: string | null
      readonly kind?: string | null
      readonly x?: number | null
      readonly y?: number | null
      readonly facing?: string | null
    }[]
  }[]
  readonly shotCoordinates: readonly {
    readonly shotNumber: number
    readonly sourceVideoBlockId?: string | null
    readonly classification?: string | null
    readonly skipped?: boolean | null
    readonly reason?: string | null
    readonly cinematicTranslation?: string | null
    readonly coordinates: readonly {
      readonly name?: string | null
      readonly kind?: string | null
      readonly x?: number | null
      readonly y?: number | null
      readonly facing?: string | null
    }[]
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
  }[]
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
  readonly scriptDetails?: WorkspaceCanvasScriptDetails
  readonly shotDetails?: WorkspaceCanvasShotDetails
  readonly imageDetails?: WorkspaceCanvasImageDetails
  readonly videoDetails?: WorkspaceCanvasVideoDetails
  readonly finalDetails?: WorkspaceCanvasFinalDetails
  readonly bgmScoreDetails?: WorkspaceCanvasBgmScoreDetails
  readonly editScreenplayDetails?: WorkspaceCanvasEditScreenplayDetails
  readonly styleBibleDetails?: WorkspaceCanvasStyleBibleDetails
  readonly editPipelineStepDetails?: WorkspaceCanvasEditPipelineStepDetails
  readonly editScriptDetails?: WorkspaceCanvasEditScriptDetails
  readonly spaceConsistencyDetails?: WorkspaceCanvasSpaceConsistencyDetails
  readonly videoPlanDetails?: WorkspaceCanvasVideoPlanDetails
  readonly editAssetDetails?: WorkspaceCanvasEditAssetDetails
}

export type WorkspaceCanvasFlowNode = Node<WorkspaceCanvasNodeData, 'workspaceNode'>
export type WorkspaceCanvasFlowEdge = Edge

export interface WorkspaceCanvasProjection {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly edges: readonly WorkspaceCanvasFlowEdge[]
}
