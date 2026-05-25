import { z } from 'zod'

export const coordinateReferenceModeSchema = z.enum(['overlay', 'outer_axes'])

export const coordinateCameraFacingSchema = z.enum([
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
])

export const coordinateFinalPromptVariantSchema = z.enum([
  'camera_ray_cast',
  'reconstruct_3d',
  'director_blocking',
  'strict_not_map',
])

export const coordinateGridSchema = z.object({
  columns: z.number().int().min(2).max(64),
  rows: z.number().int().min(2).max(64),
})

export const coordinatePointSchema = z.object({
  x: z.number().int().min(1).max(64),
  y: z.number().int().min(1).max(64),
})

export const coordinatePlacementAnalysisSchema = z.object({
  person: coordinatePointSchema,
  camera: coordinatePointSchema,
  cameraFacing: coordinateCameraFacingSchema,
  shotIntent: z.string().trim().min(1).max(1000),
})

export const coordinatePlacementAnalyzeRequestSchema = z.object({
  coordinateReferenceImage: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1).max(4000),
  referenceMode: coordinateReferenceModeSchema,
  llmModelKey: z.string().trim().min(1),
  grid: coordinateGridSchema,
})

export const coordinatePlacementReferenceViewsRequestSchema = z.object({
  sceneImage: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1).max(4000),
  imageModelKey: z.string().trim().min(1),
})

export const coordinatePlacementGenerateRequestSchema = z.object({
  cameraReferenceImage: z.string().trim().min(1),
  threeViewReferenceImage: z.string().trim().min(1),
  characterImage: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1).max(4000),
  imageModelKey: z.string().trim().min(1),
  promptVariant: coordinateFinalPromptVariantSchema.default('camera_ray_cast'),
  grid: coordinateGridSchema,
  analysis: coordinatePlacementAnalysisSchema,
}).superRefine((value, ctx) => {
  if (value.analysis.person.x > value.grid.columns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysis', 'person', 'x'],
      message: 'person x must be inside grid columns',
    })
  }
  if (value.analysis.person.y > value.grid.rows) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysis', 'person', 'y'],
      message: 'person y must be inside grid rows',
    })
  }
  if (value.analysis.camera.x > value.grid.columns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysis', 'camera', 'x'],
      message: 'camera x must be inside grid columns',
    })
  }
  if (value.analysis.camera.y > value.grid.rows) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysis', 'camera', 'y'],
      message: 'camera y must be inside grid rows',
    })
  }
})

export type CoordinateReferenceMode = z.infer<typeof coordinateReferenceModeSchema>
export type CoordinateCameraFacing = z.infer<typeof coordinateCameraFacingSchema>
export type CoordinateFinalPromptVariant = z.infer<typeof coordinateFinalPromptVariantSchema>
export type CoordinateGrid = z.infer<typeof coordinateGridSchema>
export type CoordinatePlacementAnalysis = z.infer<typeof coordinatePlacementAnalysisSchema>
export type CoordinatePlacementAnalyzeRequest = z.infer<typeof coordinatePlacementAnalyzeRequestSchema>
export type CoordinatePlacementReferenceViewsRequest = z.infer<typeof coordinatePlacementReferenceViewsRequestSchema>
export type CoordinatePlacementGenerateRequest = z.infer<typeof coordinatePlacementGenerateRequestSchema>

export interface CoordinatePlacementAnalyzeResult {
  readonly success: true
  readonly modelKey: string
  readonly finalPrompt: string
  readonly analysis: CoordinatePlacementAnalysis
  readonly rawText: string
}

export interface CoordinatePlacementReferenceViewsResult {
  readonly success: true
  readonly modelKey: string
  readonly floorPlanImageUrl: string
  readonly floorPlanImageDataUrl: string
  readonly floorPlanStorageKey: string
  readonly threeViewImageUrl: string
  readonly threeViewImageDataUrl: string
  readonly threeViewStorageKey: string
  readonly floorPlanPrompt: string
  readonly threeViewPrompt: string
}

export interface CoordinatePlacementTestResult {
  readonly success: true
  readonly imageUrl: string
  readonly storageKey: string
  readonly modelKey: string
  readonly promptVariant: CoordinateFinalPromptVariant
  readonly finalPrompt: string
}
