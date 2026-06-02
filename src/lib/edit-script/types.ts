import { z } from 'zod'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'

export const EDIT_ASSET_KINDS = ['character', 'location'] as const
export type EditAssetKind = (typeof EDIT_ASSET_KINDS)[number]

export const EDIT_ASSET_STATUSES = ['pending', 'generating', 'completed', 'failed'] as const
export type EditAssetStatus = (typeof EDIT_ASSET_STATUSES)[number]

export const EDIT_SCRIPT_VIDEO_RATIOS = ['9:16', '16:9', '21:9'] as const
export type EditScriptVideoRatio = (typeof EDIT_SCRIPT_VIDEO_RATIOS)[number]

export interface EditScreenplayPayload {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible | null
  readonly screenplayText: string
  readonly status: string
}

export interface EditDirectorDecoupageShot {
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
  readonly sound: string
}

export interface EditDirectorDecoupagePayload {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly screenplayId: string
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible
  readonly screenplayText: string
  readonly status: string
  readonly shots: readonly EditDirectorDecoupageShot[]
  readonly hardBans: readonly string[]
}

export interface EditScriptShot {
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
  readonly sound: string
}

export interface EditScriptVideoBlock {
  readonly kind: 'single' | 'group'
  readonly shotNumbers: readonly number[]
  readonly gridMode?: '2x2' | '3x3'
  readonly reason: string
  readonly prompt: string
}

export interface EditAssetRequirement {
  readonly id?: string
  readonly kind: EditAssetKind
  readonly name: string
  readonly description: string
  readonly voiceTimbreText?: string | null
  readonly shotNumbers: readonly number[]
  readonly status?: EditAssetStatus
  readonly targetId?: string | null
  readonly taskTargetType?: 'CharacterAppearance' | 'LocationImage' | null
  readonly taskTargetId?: string | null
  readonly errorMessage?: string | null
  readonly previewImageUrl?: string | null
  readonly spatialProfileJson?: unknown | null
  readonly spatialProfileStatus?: LocationSpatialProfileStatus | null
  readonly spatialProfileError?: string | null
  readonly spatialProfileAnalyzedAt?: string | Date | null
  readonly spatialProfileModel?: string | null
}

export interface EditScriptPayload {
  readonly id?: string
  readonly projectId?: string
  readonly episodeId?: string
  readonly userPrompt?: string
  readonly styleBible: EditScriptStyleBible | null
  readonly screenplayText?: string | null
  readonly title: string
  readonly logline?: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status?: string
  readonly shots: readonly EditScriptShot[]
  readonly videoBlocks: readonly EditScriptVideoBlock[]
  readonly requirements: readonly EditAssetRequirement[]
}

export interface EditCinematographyShot {
  readonly shotNumber: number
  readonly shotScale: string
  readonly lens: string
  readonly depthOfField: string
  readonly cameraPosition: string
  readonly cameraHeight: string
  readonly cameraAngle: string
  readonly movement: string
  readonly composition: string
  readonly lighting: string
  readonly axisAndEyeline: string
  readonly continuityIn: string
  readonly continuityOut: string
}

export interface EditCinematographyShotPlanPayload {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly status: string
  readonly shots: readonly EditCinematographyShot[]
  readonly hardBans: readonly string[]
}

export const editScriptShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  durationSec: z.number().int().min(1).max(5),
  dramaticPurpose: z.string().trim().min(1),
  visibleAction: z.string().trim().min(1),
  audienceFocus: z.string().trim().min(1),
  viewpoint: z.string().trim().min(1),
  revealPlan: z.string().trim().min(1),
  performanceBeat: z.string().trim().min(1),
  continuityIn: z.string().trim().min(1),
  continuityOut: z.string().trim().min(1),
  charactersAndScene: z.string().trim().min(1),
  sound: z.string().trim().min(1),
})

export const editScriptStructureShotSchema = editScriptShotSchema

export const editScriptCoreSchema = z.object({
  title: z.string().trim().min(1),
  logline: z.string().trim().optional().nullable(),
  durationSec: z.number().int().positive(),
  shots: z.array(editScriptShotSchema).min(1).max(60),
  videoBlocks: z.array(z.object({
    type: z.enum(['single', 'group']).optional(),
    kind: z.enum(['single', 'group']).optional(),
    shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
    gridMode: z.enum(['2x2', '3x3']).optional(),
    reason: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
  })).min(1).max(60),
})

export const editScriptStructureSchema = z.object({
  title: z.string().trim().min(1),
  logline: z.string().trim().optional().nullable(),
  durationSec: z.number().int().positive(),
  shots: z.array(editScriptStructureShotSchema).min(1).max(60),
  videoBlocks: z.array(z.object({
    type: z.enum(['single', 'group']).optional(),
    kind: z.enum(['single', 'group']).optional(),
    shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
    gridMode: z.enum(['2x2', '3x3']).optional(),
    reason: z.string().trim().min(1),
  })).min(1).max(60),
})

export const editScriptVideoPromptSchema = z.object({
  shots: z.array(z.object({
    shotNumber: z.number().int().positive(),
    videoPrompt: z.string().trim().min(1),
  })).min(1).max(60),
  videoBlocks: z.array(z.object({
    shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
    prompt: z.string().trim().min(1),
  })).min(1).max(60),
})

export const editDirectorDecoupageSchema = z.object({
  strategy: z.literal('director_decoupage'),
  schemaVersion: z.literal(1),
  shots: z.array(editScriptShotSchema).min(1).max(60),
  hardBans: z.array(z.string().trim().min(1)).min(1),
})

export const editCinematographyShotPlanSchema = z.object({
  strategy: z.literal('cinematography_shot_plan'),
  schemaVersion: z.literal(1),
  shots: z.array(z.object({
    shotNumber: z.number().int().positive(),
    shotScale: z.string().trim().min(1),
    lens: z.string().trim().min(1),
    depthOfField: z.string().trim().min(1),
    cameraPosition: z.string().trim().min(1),
    cameraHeight: z.string().trim().min(1),
    cameraAngle: z.string().trim().min(1),
    movement: z.string().trim().min(1),
    composition: z.string().trim().min(1),
    lighting: z.string().trim().min(1),
    axisAndEyeline: z.string().trim().min(1),
    continuityIn: z.string().trim().min(1),
    continuityOut: z.string().trim().min(1),
  })).min(1).max(60),
  hardBans: z.array(z.string().trim().min(1)).min(1),
})

export const editScriptStylePolicySchema = z.object({
  directing: z.object({
    pointOfViewPrompt: z.string().trim().min(1),
    performancePrompt: z.string().trim().min(1),
    informationReleasePrompt: z.string().trim().min(1),
    rhythmPrompt: z.string().trim().min(1),
  }),
  visual: z.object({
    negativePrompt: z.string().trim().min(1),
    imageFilterPrompt: z.string().trim().min(1),
    lightingPrompt: z.string().trim().min(1),
    colorPrompt: z.string().trim().min(1),
    texturePrompt: z.string().trim().min(1),
    compositionPrompt: z.string().trim().min(1),
  }),
  camera: z.object({
    movementPrompt: z.string().trim().min(1),
    lensAndDepthPrompt: z.string().trim().min(1),
    videoRhythmPrompt: z.string().trim().min(1),
  }),
  sound: z.object({
    soundFilterPrompt: z.string().trim().min(1),
  }),
  hardBans: z.array(z.string().trim().min(1)).min(1),
})

export const editScriptStyleBibleSchema = z.object({
  styleBible: z.object({
    strategy: z.literal('style_bible'),
    rawUserStyle: z.string().trim().nullable(),
    styleSummary: z.string().trim().min(1),
    stylePolicy: editScriptStylePolicySchema,
  }).passthrough(),
})

export type EditScriptStyleBible = z.infer<typeof editScriptStyleBibleSchema>['styleBible']

export const editScriptVideoPromptBlockSchema = z.object({
  sourceVideoBlockIndex: z.number().int().min(0).max(59),
  shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
  shots: z.array(z.object({
    shotNumber: z.number().int().positive(),
    videoPrompt: z.string().trim().min(1),
  })).min(1).max(9),
  videoBlock: z.object({
    shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
    prompt: z.string().trim().min(1),
  }),
})

export const editScriptVideoBlockMergeSchema = z.object({
  shotNumbers: z.array(z.number().int().positive()).min(2).max(9),
  reason: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
})

export const editScriptVideoBlockArrangementSchema = z.object({
  videoBlocks: z.array(z.object({
    blockIndex: z.number().int().min(0).max(59),
    shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
    reason: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
  })).min(1).max(60),
})

export type EditScriptVideoPromptBlockOutput = z.infer<typeof editScriptVideoPromptBlockSchema>
export type EditScriptVideoBlockMergeOutput = z.infer<typeof editScriptVideoBlockMergeSchema>
export type EditScriptVideoBlockArrangementOutput = z.infer<typeof editScriptVideoBlockArrangementSchema>

export const editAssetRequirementSchema = z.object({
  kind: z.enum(EDIT_ASSET_KINDS),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  voiceTimbreText: z.string().trim().min(1).optional().nullable(),
  shotNumbers: z.array(z.number().int().positive()).min(1),
}).superRefine((asset, context) => {
  const voiceTimbreText = asset.voiceTimbreText?.trim()
  if (asset.kind === 'character' && !voiceTimbreText) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['voiceTimbreText'],
      message: 'Character assets must include fixed voice timbre text.',
    })
  }
  if (asset.kind === 'location' && voiceTimbreText) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['voiceTimbreText'],
      message: 'Location assets must not include voice timbre text.',
    })
  }
})

export const editAssetExtractionSchema = z.object({
  assets: z.array(editAssetRequirementSchema).min(1).max(40),
})

export const createEditScriptRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  prompt: z.never().optional(),
  screenplayId: z.string().trim().min(1).optional(),
  videoRatio: z.enum(EDIT_SCRIPT_VIDEO_RATIOS).optional(),
  artStyle: z.string().trim().min(1).optional(),
})

export const createEditDirectorDecoupageRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  screenplayId: z.string().trim().min(1).optional(),
})

export const getEditDirectorDecoupageRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const createEditCinematographyShotPlanRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1).optional(),
})

export const getEditCinematographyShotPlanRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const createEditScreenplayRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  videoRatio: z.enum(EDIT_SCRIPT_VIDEO_RATIOS).optional(),
  artStyle: z.string().trim().min(1).optional(),
})

export const getEditScreenplayRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const getEditScriptRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const updateEditScriptVideoBlockPromptRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1),
  blockIndex: z.number().int().min(0).max(59),
  prompt: z.string().trim().min(1),
})

export const mergeEditScriptVideoBlocksRequestSchema = z.object({
  operation: z.literal('mergeVideoBlocks'),
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1),
  leftBlockIndex: z.number().int().min(0).max(58),
  rightBlockIndex: z.number().int().min(1).max(59),
})

export const arrangeEditScriptVideoBlocksRequestSchema = z.object({
  operation: z.literal('arrangeVideoBlocks'),
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1),
  blocks: z.array(z.object({
    shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
  })).min(1).max(60),
})

export const updateEditScriptAssetRequirementDescriptionRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1),
  requirementId: z.string().trim().min(1),
  description: z.string().trim().min(1),
})

export const generateEditAssetsRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1).optional(),
  requirementId: z.string().trim().min(1).optional(),
})

export const generateEditStoryboardRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1).optional(),
})
