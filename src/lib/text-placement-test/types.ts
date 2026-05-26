import { z } from 'zod'

export const textPlacementCharacterPlacementSchema = z.object({
  absoluteLocation: z.string().trim().min(1).max(800),
  anchorObject: z.string().trim().min(1).max(300),
  relationToAnchor: z.string().trim().min(1).max(800),
  distanceScale: z.string().trim().min(1).max(500),
  bodyFacing: z.string().trim().min(1).max(500),
  screenPosition: z.string().trim().min(1).max(500),
})

export const textPlacementShotSchema = z.object({
  shotNumber: z.number().int().min(1).max(10),
  shotLabel: z.string().trim().min(1).max(120),
  characterAPlacement: textPlacementCharacterPlacementSchema,
  characterBPlacement: textPlacementCharacterPlacementSchema,
  relationshipBetweenCharacters: z.string().trim().min(1).max(800),
  foregroundLayer: z.string().trim().min(1).max(500),
  midgroundLayer: z.string().trim().min(1).max(500),
  backgroundLayer: z.string().trim().min(1).max(500),
  cameraView: z.string().trim().min(1).max(800),
  negativeConstraints: z.array(z.string().trim().min(1).max(300)).min(3).max(10),
})

export const textPlacementPlanSchema = z.object({
  sceneBrief: z.string().trim().min(1).max(1200),
  characterABrief: z.string().trim().min(1).max(1200),
  characterBBrief: z.string().trim().min(1).max(1200),
  shots: z.array(textPlacementShotSchema).min(5).max(10),
}).superRefine((value, ctx) => {
  value.shots.forEach((shot, index) => {
    const expectedShotNumber = index + 1
    if (shot.shotNumber !== expectedShotNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'shotNumber'],
        message: `shotNumber must be ${expectedShotNumber}`,
      })
    }
  })
})

export const textPlacementTestRunRequestSchema = z.object({
  storyPrompt: z.string().trim().min(1).max(4000),
  llmModelKey: z.string().trim().min(1),
  imageModelKey: z.string().trim().min(1),
})

export type TextPlacementCharacterPlacement = z.infer<typeof textPlacementCharacterPlacementSchema>
export type TextPlacementShot = z.infer<typeof textPlacementShotSchema>
export type TextPlacementPlan = z.infer<typeof textPlacementPlanSchema>
export type TextPlacementTestRunRequest = z.infer<typeof textPlacementTestRunRequestSchema>

export interface TextPlacementFinalImageResult {
  readonly shotNumber: number
  readonly shotLabel: string
  readonly prompt: string
  readonly imageUrl: string
  readonly storageKey: string
}

export interface TextPlacementTestRunResult {
  readonly success: true
  readonly llmModelKey: string
  readonly imageModelKey: string
  readonly placementPlan: TextPlacementPlan
  readonly placementPrompt: string
  readonly placementRawText: string
  readonly scenePrompt: string
  readonly characterAPrompt: string
  readonly characterBPrompt: string
  readonly sceneImageUrl: string
  readonly sceneStorageKey: string
  readonly characterAImageUrl: string
  readonly characterAStorageKey: string
  readonly characterBImageUrl: string
  readonly characterBStorageKey: string
  readonly finalImages: readonly TextPlacementFinalImageResult[]
}
