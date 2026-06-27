import { z } from 'zod'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import { locationSpatialProfileSchema, type LocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import type { EditAssetRequirement, EditCinematographyShot, EditDirectorDecoupageShot, EditScriptPayload, EditScriptShot, EditScriptStyleBible, EditScriptVideoBlock } from '@/lib/edit-script/types'

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
  readonly spatialProfile?: LocationSpatialProfile | null
}

export interface StoryboardConsistencySourceVideoBlock extends EditScriptVideoBlock {
  readonly blockIndex: number
  readonly sourceVideoBlockId: string
}

export interface StoryboardConsistencySourceSnapshot {
  readonly projectId: string
  readonly episodeId: string
  readonly project: {
    readonly videoRatio: string
  }
  readonly editScript: Pick<EditScriptPayload, 'id' | 'title' | 'logline' | 'durationSec' | 'shotCount' | 'userPrompt' | 'screenplayText'>
  readonly styleBible: EditScriptStyleBible
  readonly shots: readonly EditScriptShot[]
  readonly directorDecoupage: {
    readonly shots: readonly EditDirectorDecoupageShot[]
  }
  readonly cinematographyShotPlan: {
    readonly shots: readonly EditCinematographyShot[]
  }
  readonly videoBlocks: readonly StoryboardConsistencySourceVideoBlock[]
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
}

export interface StoryboardPanelPromptDraft {
  readonly panelIndex: number
  readonly sourceShotNumber: number
  readonly sourceVideoBlockId: string
  readonly prompt: string
  readonly videoPrompt: string
  readonly shotBlocking: ShotBlocking
  readonly metadata: Record<string, unknown>
}

const sourceShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  durationSec: z.number().int().positive(),
  dramaticPurpose: z.string(),
  visibleAction: z.string(),
  audienceFocus: z.string(),
  viewpoint: z.string(),
  revealPlan: z.string(),
  performanceBeat: z.string(),
  continuityIn: z.string(),
  continuityOut: z.string(),
  charactersAndScene: z.string(),
  sound: z.string(),
})

const directorShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  durationSec: z.number().int().positive(),
  dramaticPurpose: z.string(),
  visibleAction: z.string(),
  audienceFocus: z.string(),
  viewpoint: z.string(),
  revealPlan: z.string(),
  performanceBeat: z.string(),
  continuityIn: z.string(),
  continuityOut: z.string(),
  charactersAndScene: z.string(),
  sound: z.string(),
})

const cinematographyShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  shotScale: z.string(),
  lens: z.string(),
  depthOfField: z.string(),
  cameraPosition: z.string(),
  cameraHeight: z.string(),
  cameraAngle: z.string(),
  movement: z.string(),
  composition: z.string(),
  lighting: z.string(),
  axisAndEyeline: z.string(),
  continuityIn: z.string(),
  continuityOut: z.string(),
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
  spatialProfile: locationSpatialProfileSchema.nullable().optional(),
})

export const storyboardConsistencySourceSnapshotSchema = z.object({
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
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
  directorDecoupage: z.object({
    shots: z.array(directorShotSchema).min(1),
  }),
  cinematographyShotPlan: z.object({
    shots: z.array(cinematographyShotSchema).min(1),
  }),
  videoBlocks: z.array(sourceVideoBlockSchema).min(1),
  assets: z.array(sourceAssetSchema),
})

export const generatedPanelPromptSchema = z.object({
  panelIndex: z.number().int().min(0),
  sourceShotNumber: z.number().int().positive(),
  sourceVideoBlockId: z.string().trim().min(1),
  prompt: z.string().trim().min(20),
})

const characterPlacementSchema = z.object({
  characterName: z.string().trim().min(1),
  absolutePosition: z.string().trim().min(2),
  relativePosition: z.string().trim().min(2),
  screenPosition: z.string().trim().min(2),
  facing: z.string().trim().min(1),
  eyeline: z.string().trim().min(1),
}).strict()

export const shotBlockingSchema = z.object({
  locationName: z.string().trim().min(1),
  absolutePosition: z.string().trim().min(2),
  relativePosition: z.string().trim().min(2),
  screenPosition: z.string().trim().min(2),
  characterPlacements: z.array(characterPlacementSchema),
  cameraPlacement: z.string().trim().min(2),
  cameraMovement: z.string().trim().min(2).optional(),
  composition: z.string().trim().min(2),
  continuityNote: z.string().trim().min(2),
}).strict()

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
  shotBlocking: shotBlockingSchema,
  finalPanelPrompt: z.string().trim().min(30),
  finalVideoPrompt: z.string().trim().min(30),
}).strict()

export const cameraPlanModelOutputSchema = z.object({
  cameraPlanOutput: z.object({
    cameraStyleBible: z.unknown().optional(),
    blocks: z.array(z.unknown()).optional(),
    panels: z.array(cameraPlanPanelSchema).min(1),
  }).strict(),
})

export const cameraStyleBibleModelOutputSchema = z.object({
  cameraStyleBible: z.object({
    imageFilterPrompt: z.string().trim().min(1),
  }).passthrough(),
})

export const panelFinalPromptBlockModelOutputSchema = z.object({
  panelFinalPromptBlockOutput: z.object({
    sourceVideoBlockId: z.string().trim().min(1),
    panels: z.array(z.object({
      panelIndex: z.number().int().min(0),
      sourceShotNumber: z.number().int().positive(),
      sourceVideoBlockId: z.string().trim().min(1),
      shotBlocking: shotBlockingSchema,
      finalPanelPrompt: z.string().trim().min(30),
      finalVideoPrompt: z.string().trim().min(30),
    }).strict()).min(1),
  }).passthrough(),
})

export type CameraPlanPanel = z.infer<typeof cameraPlanPanelSchema>
export type CameraPlanModelOutput = z.infer<typeof cameraPlanModelOutputSchema>
export type CameraStyleBibleModelOutput = z.infer<typeof cameraStyleBibleModelOutputSchema>
export type PanelFinalPromptBlockModelOutput = z.infer<typeof panelFinalPromptBlockModelOutputSchema>
export type ShotBlocking = z.infer<typeof shotBlockingSchema>
