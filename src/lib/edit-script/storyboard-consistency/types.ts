import { z } from 'zod'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import type { EditAssetRequirement, EditScriptPayload, EditScriptShot, EditScriptStyleBible, EditScriptVideoBlock } from '@/lib/edit-script/types'

export const STORYBOARD_BLOCKING_ARTIFACT_KINDS = [
  'grid_floor_plan',
  'grid_coordinate_overlay',
] as const

export type StoryboardBlockingArtifactKind = (typeof STORYBOARD_BLOCKING_ARTIFACT_KINDS)[number]

export const STORYBOARD_BLOCKING_STATUSES = ['pending', 'generating', 'ready', 'failed'] as const
export type StoryboardBlockingStatus = (typeof STORYBOARD_BLOCKING_STATUSES)[number]

export type FixedSpaceClassification = 'fixed_space_strong' | 'fixed_space_weak' | 'no_fixed_space'

export interface StoryboardConsistencyModelConfigSnapshot {
  readonly analysisModel: string
  readonly storyboardModel: string
}

export interface StoryboardConsistencyAssetSnapshot {
  readonly requirementId: string
  readonly kind: EditAssetRequirement['kind']
  readonly name: string
  readonly description: string
  readonly shotNumbers: readonly number[]
  readonly targetId: string
  readonly previewImageUrl: string | null
}

export interface StoryboardConsistencySourceVideoBlock extends EditScriptVideoBlock {
  readonly blockIndex: number
  readonly sourceVideoBlockId: string
}

export interface StoryboardConsistencySourceSnapshot {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly episodeId: string
  readonly sourceEditScriptId: string
  readonly project: {
    readonly videoRatio: string
  }
  readonly editScript: Pick<EditScriptPayload, 'id' | 'title' | 'logline' | 'durationSec' | 'shotCount' | 'userPrompt' | 'screenplayText'>
  readonly styleBible: EditScriptStyleBible
  readonly shots: readonly EditScriptShot[]
  readonly videoBlocks: readonly StoryboardConsistencySourceVideoBlock[]
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
}

export interface StoryboardBlockClassification {
  readonly sourceVideoBlockId: string
  readonly blockIndex: number
  readonly classification: FixedSpaceClassification
  readonly reason: string
  readonly participantNames: readonly string[]
  readonly locationNames: readonly string[]
  readonly excludedByMotionOrAbstraction: boolean
}

export interface StoryboardFloorPlanSceneGroup {
  readonly groupIndex: number
  readonly locationRequirementId: string
  readonly locationTargetId: string
  readonly locationName: string
  readonly locationDescription: string
  readonly sourceVideoBlockIds: readonly string[]
  readonly sourceShotNumbers: readonly number[]
  readonly classification: FixedSpaceClassification
  readonly participants: readonly string[]
  readonly reason: string
}

export interface GridDensity {
  readonly columns: number
  readonly rows: number
  readonly ratio: string
  readonly shortSideUnits: 9
}

export interface StoryboardPanelPromptDraft {
  readonly panelIndex: number
  readonly sourceShotNumber: number
  readonly sourceVideoBlockId: string
  readonly prompt: string
  readonly metadata: Record<string, unknown>
}

const sourceShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  durationSec: z.number().int().positive(),
  visualAction: z.string(),
  charactersAndScene: z.string(),
  camera: z.string(),
  videoPrompt: z.string(),
  sound: z.string(),
})

const sourceVideoBlockSchema = z.object({
  kind: z.enum(['single', 'group']),
  shotNumbers: z.array(z.number().int().positive()).min(1),
  gridMode: z.enum(['2x2', '3x3']).optional(),
  reason: z.string(),
  prompt: z.string(),
  blockIndex: z.number().int().min(0),
  sourceVideoBlockId: z.string().min(1),
})

const sourceAssetSchema = z.object({
  requirementId: z.string().min(1),
  kind: z.enum(['character', 'location']),
  name: z.string(),
  description: z.string(),
  shotNumbers: z.array(z.number().int().positive()),
  targetId: z.string().min(1),
  previewImageUrl: z.string().nullable(),
})

export const storyboardConsistencySourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  sourceEditScriptId: z.string().min(1),
  project: z.object({
    videoRatio: z.string().min(1),
  }),
  editScript: z.object({
    id: z.string().min(1),
    title: z.string(),
    logline: z.string().nullable(),
    durationSec: z.number().int().positive(),
    shotCount: z.number().int().nonnegative(),
    userPrompt: z.string(),
    screenplayText: z.string().nullable().optional(),
  }),
  styleBible: editScriptStyleBibleSchema.shape.styleBible,
  shots: z.array(sourceShotSchema).min(1),
  videoBlocks: z.array(sourceVideoBlockSchema).min(1),
  assets: z.array(sourceAssetSchema),
})

export const gridFloorPlanModelOutputSchema = z.object({
  strategy: z.literal('grid_coordinates'),
  grid: z.object({
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
    ratio: z.string().trim().min(1),
    shortSideUnits: z.literal(9),
  }),
  floorPlans: z.array(z.object({
    sourceVideoBlockIds: z.array(z.string().trim().min(1)).min(1),
    groupIndex: z.number().int().min(0),
    classification: z.enum(['fixed_space_strong', 'fixed_space_weak', 'no_fixed_space']),
    location: z.string().nullable(),
    participants: z.array(z.string()),
    anchors: z.array(z.string()),
    skipped: z.boolean(),
    reason: z.string().trim().min(1),
    prompt: z.string().nullable(),
  })),
})

export type GridFloorPlanModelOutput = z.infer<typeof gridFloorPlanModelOutputSchema>

export const generatedPanelPromptSchema = z.object({
  panelIndex: z.number().int().min(0),
  sourceShotNumber: z.number().int().positive(),
  sourceVideoBlockId: z.string().trim().min(1),
  prompt: z.string().trim().min(20),
})

export const gridCoordinateAnalysisModelOutputSchema = z.object({
  strategyOutput: z.object({
    strategy: z.literal('grid_coordinates'),
  }).passthrough(),
})

export type GridCoordinateAnalysisModelOutput = z.infer<typeof gridCoordinateAnalysisModelOutputSchema>

export const cameraPlanPanelSchema = z.object({
  panelIndex: z.number().int().min(0),
  sourceShotNumber: z.number().int().positive(),
  sourceVideoBlockId: z.string().trim().min(1),
  shotScale: z.string().trim().min(2),
  cameraPosition: z.string().trim().min(2),
  cameraHeight: z.string().trim().min(2),
  cameraAngle: z.string().trim().min(2),
  composition: z.string().trim().min(2),
  cameraMovement: z.string().trim().min(2),
  lensAndDepth: z.string().trim().min(2),
  screenDirection: z.string().trim().min(2),
  aestheticIntent: z.string().trim().min(2),
  emotionalEffect: z.string().trim().min(2),
  continuityNote: z.string().trim().min(2),
  finalPanelPrompt: z.string().trim().min(30),
})

export const cameraPlanModelOutputSchema = z.object({
  cameraPlanOutput: z.object({
    strategy: z.literal('camera_plan'),
    cameraStyleBible: z.unknown().optional(),
    blocks: z.array(z.unknown()).optional(),
    panels: z.array(cameraPlanPanelSchema).min(1),
  }).passthrough(),
})

export const cameraStyleBibleModelOutputSchema = z.object({
  cameraStyleBible: z.object({
    strategy: z.literal('camera_style_bible'),
    imageFilterPrompt: z.string().trim().min(1),
  }).passthrough(),
})

export const cameraPlanBlockModelOutputSchema = z.object({
  cameraPlanBlockOutput: z.object({
    sourceVideoBlockId: z.string().trim().min(1),
    panels: z.array(cameraPlanPanelSchema).min(1),
  }).passthrough(),
})

export type CameraPlanPanel = z.infer<typeof cameraPlanPanelSchema>
export type CameraPlanModelOutput = z.infer<typeof cameraPlanModelOutputSchema>
export type CameraStyleBibleModelOutput = z.infer<typeof cameraStyleBibleModelOutputSchema>
export type CameraPlanBlockModelOutput = z.infer<typeof cameraPlanBlockModelOutputSchema>
