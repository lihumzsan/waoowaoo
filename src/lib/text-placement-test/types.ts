import { z } from 'zod'

export const textPlacementPlanSchema = z.object({
  sceneBrief: z.string().trim().min(1).max(1200),
  characterBrief: z.string().trim().min(1).max(1200),
  absoluteLocation: z.string().trim().min(1).max(800),
  anchorObject: z.string().trim().min(1).max(300),
  relationToAnchor: z.string().trim().min(1).max(800),
  distanceScale: z.string().trim().min(1).max(500),
  bodyFacing: z.string().trim().min(1).max(500),
  screenPosition: z.string().trim().min(1).max(500),
  foregroundLayer: z.string().trim().min(1).max(500),
  midgroundLayer: z.string().trim().min(1).max(500),
  backgroundLayer: z.string().trim().min(1).max(500),
  cameraView: z.string().trim().min(1).max(800),
  negativeConstraints: z.array(z.string().trim().min(1).max(300)).min(3).max(10),
})

export const textPlacementTestRunRequestSchema = z.object({
  storyPrompt: z.string().trim().min(1).max(4000),
  llmModelKey: z.string().trim().min(1),
  imageModelKey: z.string().trim().min(1),
})

export type TextPlacementPlan = z.infer<typeof textPlacementPlanSchema>
export type TextPlacementTestRunRequest = z.infer<typeof textPlacementTestRunRequestSchema>

export interface TextPlacementTestRunResult {
  readonly success: true
  readonly llmModelKey: string
  readonly imageModelKey: string
  readonly placementPlan: TextPlacementPlan
  readonly placementPrompt: string
  readonly placementRawText: string
  readonly scenePrompt: string
  readonly characterPrompt: string
  readonly finalPrompt: string
  readonly sceneImageUrl: string
  readonly sceneStorageKey: string
  readonly characterImageUrl: string
  readonly characterStorageKey: string
  readonly finalImageUrl: string
  readonly finalStorageKey: string
}
