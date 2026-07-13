import { z } from 'zod'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'
export const EDIT_ASSET_KINDS = ['character', 'location'] as const
export type EditAssetKind = (typeof EDIT_ASSET_KINDS)[number]

export const EDIT_ASSET_STATUSES = ['pending', 'generating', 'completed', 'failed'] as const
export type EditAssetStatus = (typeof EDIT_ASSET_STATUSES)[number]

export const EDIT_SCRIPT_ASSET_REVIEW_STATUSES = ['pending', 'approved'] as const
export type EditScriptAssetReviewStatus = (typeof EDIT_SCRIPT_ASSET_REVIEW_STATUSES)[number]

export const EDIT_SCRIPT_VIDEO_RATIOS = ['9:16', '16:9', '21:9'] as const
export type EditScriptVideoRatio = (typeof EDIT_SCRIPT_VIDEO_RATIOS)[number]

export const EDIT_STYLE_PREVIEW_KEYS = ['style_a', 'style_b', 'style_c'] as const
export const EDIT_STYLE_PREVIEW_MAX_COUNT = EDIT_STYLE_PREVIEW_KEYS.length
export type EditStylePreviewCanonicalKey = (typeof EDIT_STYLE_PREVIEW_KEYS)[number]
export type EditStylePreviewKey = EditStylePreviewCanonicalKey | `${EditStylePreviewCanonicalKey}_${number}`

export type EditStylePreviewStatus = 'pending' | 'generating' | 'completed' | 'confirmed' | 'failed'

export const editScriptAssetRequirementIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes('*'), {
    message: 'requirementId must be an exact editScript.requirements[].id; omit it to process all requirements.',
  })

export interface EditStylePreviewPayload {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly bibleId: string
  readonly styleKey: EditStylePreviewKey
  readonly aspectRatio: EditScriptVideoRatio
  readonly title: string
  readonly summary: string
  readonly styleBible: EditScriptStyleBible
  readonly gridImagePrompt: string
  readonly imageKey: string | null
  readonly imageUrl: string | null
  readonly status: EditStylePreviewStatus
  readonly taskId: string | null
  readonly errorMessage: string | null
  readonly updatedAt: Date
}

export interface EditStylePreviewGenerationItem {
  readonly id: string
  readonly styleKey: EditStylePreviewKey
  readonly aspectRatio: EditScriptVideoRatio
  readonly title: string
  readonly summary: string
  readonly status: EditStylePreviewStatus
  readonly taskId: string
}

export interface EditStylePreviewGenerationPayload {
  readonly success: true
  readonly async: true
  readonly projectId: string
  readonly episodeId: string
  readonly bibleId: string
  readonly status: 'queued'
  readonly total: number
  readonly taskIds: ReadonlyArray<string>
  readonly results: ReadonlyArray<{
    readonly refId: string
    readonly taskId: string
  }>
  readonly stylePreviews: readonly EditStylePreviewGenerationItem[]
}

export const EDIT_CHARACTER_VISIBILITIES = ['visible', 'partial', 'hidden', 'occluded', 'offscreen'] as const
export type EditCharacterVisibility = (typeof EDIT_CHARACTER_VISIBILITIES)[number]

export const EDIT_CHARACTER_ROLES = ['focus', 'supporting', 'listener', 'hidden_subject', 'background'] as const
export type EditCharacterRole = (typeof EDIT_CHARACTER_ROLES)[number]

export const EDIT_SHOT_PURPOSES = ['establishing', 'action', 'reaction', 'insert', 'atmosphere', 'transition'] as const
export type EditShotPurpose = (typeof EDIT_SHOT_PURPOSES)[number]

export const editScriptPerformanceSchema = z.string().trim()

export interface EditScriptCharacter {
  readonly characterId: string
  readonly name: string
  readonly visibility: EditCharacterVisibility
  readonly role: EditCharacterRole
  readonly performance: string
}

export interface EditScriptKeyObject {
  readonly name: string
  readonly role: string
}

export interface EditScriptDialogueLine {
  readonly characterId: string
  readonly line: string
}

export interface EditScriptShot {
  readonly shotId: string
  readonly shotNumber: number
  readonly shotPurpose: EditShotPurpose
  readonly durationSec: number
  readonly scene: {
    readonly locationId: string
    readonly name: string
    readonly subScene: string
  }
  readonly action: string
  readonly characters: readonly EditScriptCharacter[]
  readonly keyObjects: readonly EditScriptKeyObject[]
  readonly dialogue: readonly EditScriptDialogueLine[]
  readonly sound: string
}

export interface EditGenerationSegment {
  readonly shotIds: readonly string[]
  readonly continuity: string
}

export interface EditGenerationSegmentExecution {
  readonly shotIds: readonly string[]
  readonly continuousVideoPrompt: string
}

export interface EditAssetRequirement {
  readonly id?: string
  readonly kind: EditAssetKind
  readonly name: string
  readonly description: string
  readonly shotIds: readonly string[]
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

export interface EditScriptAssetGenerationTask {
  readonly requirementId: string
  readonly kind: EditAssetKind
  readonly name: string
  readonly taskId: string
  readonly status: string
  readonly runId: string | null
  readonly deduped: boolean
  readonly taskType: 'image_character' | 'image_location'
  readonly targetType: 'CharacterAppearance' | 'LocationImage'
  readonly targetId: string
}

export interface EditScriptAssetRevisionTask {
  readonly requirementId: string
  readonly kind: EditAssetKind
  readonly name: string
  readonly taskId: string
  readonly status: string
  readonly runId: string | null
  readonly deduped: boolean
  readonly taskType: 'modify_asset_image'
  readonly targetType: 'CharacterAppearance' | 'LocationImage'
  readonly targetId: string
}

export interface EditScriptPayload {
  readonly id?: string
  readonly projectId?: string
  readonly episodeId?: string
  readonly chapterId?: string
  readonly bibleId?: string
  readonly sourceDocumentId?: string
  readonly sourceStart?: number
  readonly sourceEnd?: number
  readonly styleBible: EditScriptStyleBible | null
  readonly sourceText?: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status?: string
  readonly assetReviewStatus: EditScriptAssetReviewStatus
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly EditGenerationSegment[]
  readonly requirements: readonly EditAssetRequirement[]
}

export interface EditScriptAssetGenerationPayload {
  readonly success: true
  readonly async: boolean
  readonly total: number
  readonly processedRequirementCount: number
  readonly remainingRequirementCount: number
  readonly taskIds: readonly string[]
  readonly results: ReadonlyArray<{
    readonly refId: string
    readonly taskId: string
    readonly taskType: 'image_character' | 'image_location'
    readonly targetType: 'CharacterAppearance' | 'LocationImage'
    readonly targetId: string
  }>
  readonly submittedTasks: readonly EditScriptAssetGenerationTask[]
  readonly editScript?: EditScriptPayload
}

export interface EditScriptAssetRevisionPayload {
  readonly success: true
  readonly async: boolean
  readonly total: number
  readonly revisionNotes: string
  readonly taskIds: readonly string[]
  readonly results: ReadonlyArray<{
    readonly refId: string
    readonly taskId: string
    readonly taskType: 'modify_asset_image'
    readonly targetType: 'CharacterAppearance' | 'LocationImage'
    readonly targetId: string
  }>
  readonly submittedTasks: readonly EditScriptAssetRevisionTask[]
  readonly editScript: EditScriptPayload
}

export interface EditShotExecutionCamera {
  readonly shotScale: string
  readonly lens: string
  readonly focus: string
  readonly height: string
  readonly angle: string
  readonly movement: string
  readonly composition: string
  readonly lighting: string
}

export interface EditShotExecutionAxis {
  readonly type: string
  readonly subjects: readonly string[]
  readonly screenDirection: string
}

export interface EditShotExecutionCharacter {
  readonly characterId: string
  readonly visibility: EditCharacterVisibility
  readonly position: string
  readonly screenPosition: string
  readonly facing: string
  readonly eyeline: string
}

export interface EditShotExecutionObject {
  readonly name: string
  readonly position: string
  readonly screenPosition: string
}

export interface EditShotExecutionBlocking {
  readonly axis: EditShotExecutionAxis
  readonly characters: readonly EditShotExecutionCharacter[]
  readonly objects: readonly EditShotExecutionObject[]
  readonly spatialNote: string
}

export interface EditShotExecution {
  readonly shotId: string
  readonly shotNumber: number
  readonly camera: EditShotExecutionCamera
  readonly blocking: EditShotExecutionBlocking
  readonly videoPrompt: string
}

export interface EditShotExecutionPlanPayload {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly editScriptId: string
  readonly status: string
  readonly shots: readonly EditShotExecution[]
  readonly generationSegmentExecutions: readonly EditGenerationSegmentExecution[]
}

export const editScriptCharacterSchema = z
  .object({
    characterId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    visibility: z.enum(EDIT_CHARACTER_VISIBILITIES),
    role: z.enum(EDIT_CHARACTER_ROLES),
    performance: editScriptPerformanceSchema,
  })
  .strict()

export const editScriptKeyObjectSchema = z
  .object({
    name: z.string().trim().min(1),
    role: z.string().trim().min(1),
  })
  .strict()

export const editScriptDialogueLineSchema = z
  .object({
    characterId: z.string().trim().min(1),
    line: z.string().trim().min(1),
  })
  .strict()

export const editScriptShotSchema = z
  .object({
    shotId: z.string().trim().min(1),
    shotNumber: z.number().int().positive(),
    shotPurpose: z.enum(EDIT_SHOT_PURPOSES),
    durationSec: z.number().int().min(1).max(5),
    scene: z
      .object({
        locationId: z.string().trim().min(1),
        name: z.string().trim().min(1),
        subScene: z.string().trim().min(1),
      })
      .strict(),
    action: z.string().trim().min(1),
    characters: z.array(editScriptCharacterSchema).min(0).max(20),
    keyObjects: z.array(editScriptKeyObjectSchema).min(0).max(20),
    dialogue: z.array(editScriptDialogueLineSchema).min(0).max(20),
    sound: z.string().trim().min(1),
  })
  .strict()

export const editGenerationSegmentSchema = z
  .object({
    shotIds: z.array(z.string().trim().min(1)).min(1).max(9),
    continuity: z.string().trim().min(1),
  })
  .strict()

export const editScriptCoreSchema = z
  .object({
    shots: z.array(editScriptShotSchema).min(1).max(60),
    generationSegments: z.array(editGenerationSegmentSchema).min(1).max(60),
  })
  .strict()

export const editScriptStructureSchema = editScriptCoreSchema

export const editShotExecutionPlanSchema = z
  .object({
    shots: z
      .array(
        z
          .object({
            shotId: z.string().trim().min(1),
            shotNumber: z.number().int().positive(),
            camera: z
              .object({
                shotScale: z.string().trim().min(1),
                lens: z.string().trim().min(1),
                focus: z.string().trim().min(1),
                height: z.string().trim().min(1),
                angle: z.string().trim().min(1),
                movement: z.string().trim().min(1),
                composition: z.string().trim().min(1),
                lighting: z.string().trim().min(1),
              })
              .strict(),
            blocking: z
              .object({
                axis: z
                  .object({
                    type: z.string().trim().min(1),
                    subjects: z.array(z.string().trim().min(1)).min(1).max(10),
                    screenDirection: z.string().trim().min(1),
                  })
                  .strict(),
                characters: z
                  .array(
                    z
                      .object({
                        characterId: z.string().trim().min(1),
                        visibility: z.enum(EDIT_CHARACTER_VISIBILITIES),
                        position: z.string().trim().min(1),
                        screenPosition: z.string().trim().min(1),
                        facing: z.string().trim().min(1),
                        eyeline: z.string().trim().min(1),
                      })
                      .strict(),
                  )
                  .min(0)
                  .max(20),
                objects: z
                  .array(
                    z
                      .object({
                        name: z.string().trim().min(1),
                        position: z.string().trim().min(1),
                        screenPosition: z.string().trim().min(1),
                      })
                      .strict(),
                  )
                  .min(0)
                  .max(20),
                spatialNote: z.string().trim().min(1),
              })
              .strict(),
            videoPrompt: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(60),
    generationSegmentExecutions: z
      .array(
        z
          .object({
            shotIds: z.array(z.string().trim().min(1)).min(1).max(9),
            continuousVideoPrompt: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict()

export const rawEditShotExecutionPlanShotSchema = z.object({
  shotRef: z.string().trim().min(1),
  camera: editShotExecutionPlanSchema.shape.shots.element.shape.camera,
  blocking: z.object({
    axis: editShotExecutionPlanSchema.shape.shots.element.shape.blocking.shape.axis,
    characters: z.array(z.object({
      characterName: z.string().trim().min(1),
      visibility: z.enum(EDIT_CHARACTER_VISIBILITIES),
      position: z.string().trim().min(1),
      screenPosition: z.string().trim().min(1),
      facing: z.string().trim().min(1),
      eyeline: z.string().trim().min(1),
    }).strict()).min(0).max(20),
    objects: editShotExecutionPlanSchema.shape.shots.element.shape.blocking.shape.objects,
    spatialNote: z.string().trim().min(1),
  }).strict(),
  videoPrompt: z.string().trim().min(1),
}).strict()

export const rawEditShotExecutionPlanSchema = z.object({
  shots: z.array(rawEditShotExecutionPlanShotSchema).min(1).max(60),
  generationSegmentExecutions: z.array(z.object({
    segmentRef: z.string().trim().min(1),
    continuousVideoPrompt: z.string().trim().min(1),
  }).strict()).min(1).max(60),
}).strict()

export type RawEditShotExecutionPlanShot = z.infer<typeof rawEditShotExecutionPlanShotSchema>

export const editScriptStylePolicySchema = z.object({
  directing: z.object({
    pointOfViewPrompt: z.string().trim().min(1),
    performancePrompt: z.string().trim().min(1),
    informationReleasePrompt: z.string().trim().min(1),
    rhythmPrompt: z.string().trim().min(1),
  }),
  visual: z.object({
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
})

export const editScriptStyleBibleSchema = z.object({
  styleBible: z
    .object({
      rawUserStyle: z.string().trim().nullable(),
      styleSummary: z.string().trim().min(1),
      stylePolicy: editScriptStylePolicySchema,
    })
    .passthrough(),
})

export const editStylePreviewOptionSchema = z.object({
  styleKey: z.enum(EDIT_STYLE_PREVIEW_KEYS),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  styleBible: editScriptStyleBibleSchema.shape.styleBible,
  gridImagePrompt: z.string().trim().min(1),
})

export const editStylePreviewKeySchema = z
  .string()
  .trim()
  .regex(/^style_[abc](?:_[2-9]\d*)?$/)

export const editStylePreviewOptionsSchema = z
  .object({
    stylePreviews: z.array(editStylePreviewOptionSchema).min(1).max(EDIT_STYLE_PREVIEW_MAX_COUNT),
  })
  .superRefine((value, context) => {
    const actualKeys = new Set(value.stylePreviews.map((preview) => preview.styleKey))
    if (actualKeys.size !== value.stylePreviews.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stylePreviews'],
        message: 'Style preview keys must be unique.',
      })
    }
    for (const [index, preview] of value.stylePreviews.entries()) {
      if (preview.styleKey !== EDIT_STYLE_PREVIEW_KEYS[index]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stylePreviews', index, 'styleKey'],
          message: `Style preview key at index ${String(index)} must be ${EDIT_STYLE_PREVIEW_KEYS[index]}.`,
        })
      }
    }
  })

export type EditStylePreviewOption = z.infer<typeof editStylePreviewOptionSchema>

export type EditScriptStyleBible = z.infer<typeof editScriptStyleBibleSchema>['styleBible']

export const editAssetRequirementSchema = z.object({
  kind: z.enum(EDIT_ASSET_KINDS),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  shotIds: z.array(z.string().trim().min(1)).min(1),
})

export const editAssetExtractionSchema = z.object({
  assets: z.array(editAssetRequirementSchema).min(1).max(40),
})

export const createEditScriptRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1).optional(),
  prompt: z.never().optional(),
  videoRatio: z.enum(EDIT_SCRIPT_VIDEO_RATIOS).optional(),
})

export const createEditShotExecutionPlanRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1).optional(),
  editScriptId: z.string().trim().min(1).optional(),
})

export const getEditShotExecutionPlanRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1).optional(),
})

export const getEditScriptRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1).optional(),
})

export const updateEditScriptAssetRequirementDescriptionRequestSchema = z.object({
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1).optional(),
  editScriptId: z.string().trim().min(1),
  requirementId: z.string().trim().min(1),
  description: z.string().trim().min(1),
})

export const generateEditAssetsRequestSchema = z.object({
  approvalGrantId: z.string().trim().min(1),
  operationRequestId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1).optional(),
  editScriptId: z.string().trim().min(1).optional(),
  requirementId: editScriptAssetRequirementIdSchema.optional(),
})
