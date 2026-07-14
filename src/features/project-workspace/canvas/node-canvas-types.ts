import type { Edge, Node } from '@xyflow/react'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type { WorkspaceCanvasLifecycle } from './lifecycle/workspace-canvas-lifecycle'

export type WorkspaceCanvasNodeKind =
  | 'finalTimeline'
  | 'editSourceScript'
  | 'editBible'
  | 'editStyleBible'
  | 'editPipelineStep'
  | 'editProcessGroup'
  | 'editScript'
  | 'editShotExecutionPlan'
  | 'videoPlan'
  | 'bgmScore'
  | 'ambientSound'
  | 'editRequiredAsset'
  | 'editAssetGroup'

export type WorkspaceCanvasMediaNodeKind = Extract<WorkspaceCanvasNodeKind,
  | 'finalTimeline'
  | 'editStyleBible'
  | 'videoPlan'
  | 'bgmScore'
  | 'ambientSound'
  | 'editRequiredAsset'
  | 'editAssetGroup'
>

export interface MediaLoadingContext {
  readonly styleImageUrl: string | null
}

export type WorkspaceCanvasTargetType = 'episode' | 'videoSegment' | 'editSourceScript' | 'editBible' | 'editStyleBible' | 'editPipelineStep' | 'editScript' | 'editShotExecutionPlan' | 'editAssetRequirement' | 'projectCharacter' | 'projectLocation'

export type WorkspaceCanvasNodeAction =
  | {
      readonly type: 'ingest_script'
      readonly prompt: string
    }
  | { readonly type: 'generate_edit_script' }
  | { readonly type: 'generate_edit_shot_execution_plan'; readonly editScriptId: string }
  | { readonly type: 'open_asset_library'; readonly characterId?: string | null }
  | {
      readonly type: 'update_edit_asset_requirement_description'
      readonly editScriptId: string
      readonly requirementId: string
      readonly description: string
    }
  | { readonly type: 'generate_video_segments' }
  | { readonly type: 'render_final_video' }
  | { readonly type: 'plan_bgm_score' }
  | { readonly type: 'generate_bgm_score' }
  | { readonly type: 'plan_ambient_sound' }
  | { readonly type: 'generate_ambient_sound' }
  | { readonly type: 'generate_edit_assets'; readonly editScriptId: string }
  | { readonly type: 'generate_edit_asset'; readonly editScriptId: string; readonly requirementId: string }
  | { readonly type: 'regenerate_edit_asset_image'; readonly assetId: string; readonly kind: 'character' | 'location' }

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

export interface WorkspaceCanvasAmbientSoundDetails {
  readonly status?: string | null
  readonly decision?: 'ambient_sound' | 'none_needed' | null
  readonly soundEffectModel?: string | null
  readonly sourceCount: number
  readonly sectionCount: number
  readonly sources: readonly {
    readonly key: string
    readonly sourceIndex: number
    readonly prompt: string
    readonly loopDurationSeconds: number
    readonly promptInfluence: number
  }[]
  readonly sections: readonly {
    readonly key: string
    readonly sourceIndex: number
    readonly rangeKind: 'clip' | 'shot'
    readonly rangeStart: number
    readonly rangeEnd: number
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
    readonly dialogue: readonly string[]
    readonly synchronousSound: string
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

export interface WorkspaceCanvasStyleBibleDetails {
  readonly rawUserStyle?: string | null
  readonly styleSummary?: string | null
  readonly visualStyle?: string | null
  readonly assetImageStyle?: {
    readonly lighting: string
    readonly texture: string
    readonly composition: string
  } | null
}

export interface WorkspaceCanvasVideoPlanDetails {
  readonly editScriptId: string
  readonly chapterId: string
  readonly segmentId: string
  readonly segmentIndex: number
  readonly videoSegmentId?: string | null
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly durationSec: number
  readonly continuity: string
  readonly outputUrl?: string | null
  readonly outputAspectRatio?: number | null
  readonly errorMessage?: string | null
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
}

export interface WorkspaceCanvasEditAssetGroupItem {
  readonly requirementId: string
  readonly kind: 'character' | 'location'
  readonly name: string
  readonly eyebrow: string
  readonly description: string
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly lifecycle: WorkspaceCanvasLifecycle
  readonly previewImageUrl?: string | null
  readonly runtimeTarget?: TaskRuntimeTarget | null
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
  readonly isStreamPresentationExpanded: boolean
  readonly collapseWhenStreamCompletes: boolean
}

export interface WorkspaceCanvasNodeData {
  readonly nodeId?: string
  readonly projectId?: string
  readonly episodeName?: string
  readonly kind: WorkspaceCanvasNodeKind
  readonly layoutNodeType: CanvasLayoutNodeType
  readonly targetType: WorkspaceCanvasTargetType
  readonly targetId: string
  readonly title: string
  readonly eyebrow: string
  readonly body: string
  readonly meta: string
  readonly lifecycle: WorkspaceCanvasLifecycle
  readonly terminalHandoffTaskId?: string | null
  readonly focusHighlighted?: boolean
  readonly disclosure?: WorkspaceCanvasNodeDisclosureState
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
  readonly readOnly?: boolean
  readonly onAction?: WorkspaceCanvasNodeActionHandler
  readonly expanded?: boolean
  readonly expandedLayout?: 'stack' | 'wide'
  readonly defaultExpanded?: boolean
  readonly onToggleExpanded?: (nodeId: string) => void
  readonly indexLabel?: string
  readonly previewImageUrl?: string | null
  readonly previewAspectRatio?: number | null
  readonly previewDisplayHeight?: number | null
  readonly mediaLoadingContext: MediaLoadingContext | null
  readonly finalDetails?: WorkspaceCanvasFinalDetails
  readonly bgmScoreDetails?: WorkspaceCanvasBgmScoreDetails
  readonly ambientSoundDetails?: WorkspaceCanvasAmbientSoundDetails
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

export type WorkspaceCanvasMediaNodeData = WorkspaceCanvasNodeData & {
  readonly kind: WorkspaceCanvasMediaNodeKind
  readonly mediaLoadingContext: MediaLoadingContext
}

export type WorkspaceCanvasNonMediaNodeData = WorkspaceCanvasNodeData & {
  readonly kind: Exclude<WorkspaceCanvasNodeKind, WorkspaceCanvasMediaNodeKind>
  readonly mediaLoadingContext: null
}

export type WorkspaceCanvasDiscriminatedNodeData = WorkspaceCanvasMediaNodeData | WorkspaceCanvasNonMediaNodeData

export type WorkspaceCanvasNodeRecord = WorkspaceCanvasNodeData & Record<string, unknown>
export type WorkspaceCanvasFlowNode = Node<WorkspaceCanvasNodeRecord, 'workspaceNode'>
export type WorkspaceCanvasFlowEdge = Edge

export interface WorkspaceCanvasProjection {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly edges: readonly WorkspaceCanvasFlowEdge[]
}
