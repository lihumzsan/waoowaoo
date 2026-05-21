import { z } from 'zod'

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
  readonly screenplayText: string
  readonly status: string
}

export interface EditScriptShot {
  readonly shotNumber: number
  readonly durationSec: number
  readonly visualAction: string
  readonly charactersAndScene: string
  readonly camera: string
  readonly videoPrompt: string
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
  readonly errorMessage?: string | null
  readonly previewImageUrl?: string | null
}

export interface EditScriptPayload {
  readonly id?: string
  readonly projectId?: string
  readonly episodeId?: string
  readonly userPrompt?: string
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

export const editScriptShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  durationSec: z.number().int().min(1).max(5),
  visualAction: z.string().trim().min(1),
  charactersAndScene: z.string().trim().min(1),
  camera: z.string().trim().min(1),
  videoPrompt: z.string().trim().min(1),
  sound: z.string().trim().min(1),
})

export const editScriptStructureShotSchema = editScriptShotSchema.omit({ videoPrompt: true })

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

export const editScriptVideoPromptBibleSchema = z.object({
  videoPromptBible: z.object({
    strategy: z.literal('video_prompt_bible'),
    storyPremise: z.string().trim().min(1),
    userDirectedStyle: z.string().trim().nullable(),
    inferredSystemStyle: z.string().trim().min(1),
    styleReferenceInterpretation: z.object({
      rawUserStyle: z.string().trim().nullable(),
      visualTone: z.string().trim().min(1),
      cameraRhythm: z.string().trim().min(1),
      composition: z.string().trim().min(1),
      lighting: z.string().trim().min(1),
      colorPalette: z.string().trim().min(1),
      imageFilterPrompt: z.string().trim().min(1),
      soundFilterPrompt: z.string().trim().min(1),
      motionStyle: z.string().trim().min(1),
      editingPacing: z.string().trim().min(1),
      soundStyle: z.string().trim().min(1),
      hardBans: z.array(z.string().trim().min(1)).min(1),
    }),
    visualPromptPolicy: z.object({
      positivePrompt: z.string().trim().min(1),
      negativePrompt: z.string().trim().min(1),
      imageFilterPrompt: z.string().trim().min(1),
      lightingPrompt: z.string().trim().min(1),
      colorPrompt: z.string().trim().min(1),
      texturePrompt: z.string().trim().min(1),
      compositionPrompt: z.string().trim().min(1),
    }),
    characterContinuityRules: z.array(z.string().trim().min(1)),
    locationContinuityRules: z.array(z.string().trim().min(1)),
    soundRules: z.array(z.string().trim().min(1)),
    videoModelRules: z.array(z.string().trim().min(1)),
    blockContinuityRules: z.array(z.string().trim().min(1)),
  }).passthrough(),
})

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

export type EditScriptVideoPromptBibleOutput = z.infer<typeof editScriptVideoPromptBibleSchema>
export type EditScriptVideoPromptBlockOutput = z.infer<typeof editScriptVideoPromptBlockSchema>
export type EditScriptVideoBlockMergeOutput = z.infer<typeof editScriptVideoBlockMergeSchema>

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
