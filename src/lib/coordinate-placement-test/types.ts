import { z } from 'zod'

export const coordinateReferenceModeSchema = z.enum(['overlay', 'outer_axes'])

export const coordinatePlacementTestRequestSchema = z.object({
  coordinateReferenceImage: z.string().trim().min(1),
  characterImage: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1).max(4000),
  referenceMode: coordinateReferenceModeSchema,
  grid: z.object({
    columns: z.number().int().min(2).max(64),
    rows: z.number().int().min(2).max(64),
  }),
  target: z.object({
    x: z.number().int().min(1).max(64),
    y: z.number().int().min(1).max(64),
  }),
}).superRefine((value, ctx) => {
  if (value.target.x > value.grid.columns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target', 'x'],
      message: 'target x must be inside grid columns',
    })
  }
  if (value.target.y > value.grid.rows) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target', 'y'],
      message: 'target y must be inside grid rows',
    })
  }
})

export type CoordinateReferenceMode = z.infer<typeof coordinateReferenceModeSchema>
export type CoordinatePlacementTestRequest = z.infer<typeof coordinatePlacementTestRequestSchema>

export interface CoordinatePlacementTestResult {
  readonly success: true
  readonly imageUrl: string
  readonly storageKey: string
  readonly modelKey: string
  readonly finalPrompt: string
}
