import { z } from 'zod'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import {
  editGenerationSegmentSchema,
  editScriptShotSchema,
  editShotExecutionPlanSchema,
} from '@/lib/edit-script/types'
import { locationSpatialProfileSchema, type LocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import type {
  EditAssetRequirement,
  EditGenerationSegment,
  EditGenerationSegmentExecution,
  EditScriptPayload,
  EditScriptShot,
  EditScriptStyleBible,
  EditShotExecution,
} from '@/lib/edit-script/types'
import type { StoryboardStillPromptFacts } from '@/lib/edit-script/prompt-builders'

export interface StoryboardConsistencyModelConfigSnapshot {
  readonly analysisModel: string
  readonly storyboardModel: string
}

export interface StoryboardConsistencyAssetSnapshot {
  readonly requirementId: string
  readonly kind: EditAssetRequirement['kind']
  readonly name: string
  readonly description: string
  readonly shotIds: readonly string[]
  readonly targetId: string
  readonly previewImageUrl: string | null
  readonly spatialProfile?: LocationSpatialProfile | null
}

export interface StoryboardConsistencyGenerationSegment extends EditGenerationSegment {
  readonly segmentIndex: number
  readonly sourceGenerationSegmentId: string
}

export interface StoryboardConsistencySourceSnapshot {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly project: {
    readonly videoRatio: string
  }
  readonly editScript: Pick<EditScriptPayload, 'id' | 'chapterId' | 'durationSec' | 'shotCount' | 'sourceDocumentId' | 'sourceStart' | 'sourceEnd' | 'sourceText'>
  readonly styleBible: EditScriptStyleBible
  readonly shots: readonly EditScriptShot[]
  readonly shotExecutionPlan: {
    readonly shots: readonly EditShotExecution[]
    readonly generationSegmentExecutions: readonly EditGenerationSegmentExecution[]
  }
  readonly generationSegments: readonly StoryboardConsistencyGenerationSegment[]
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
}

export interface StoryboardPanelPromptDraft {
  readonly panelIndex: number
  readonly sourceShotId: string
  readonly sourceGenerationSegmentId: string
  readonly prompt: string | null
  readonly videoPrompt: string
  readonly executionSnapshot: EditShotExecution
  readonly renderFacts: StoryboardStillPromptFacts
}

const sourceAssetSchema = z.object({
  requirementId: z.string().min(1),
  kind: z.enum(['character', 'location']),
  name: z.string(),
  description: z.string(),
  shotIds: z.array(z.string().min(1)),
  targetId: z.string().min(1),
  previewImageUrl: z.string().nullable(),
  spatialProfile: locationSpatialProfileSchema.nullable().optional(),
})

export const storyboardConsistencyGenerationSegmentSchema = editGenerationSegmentSchema.extend({
  segmentIndex: z.number().int().min(0),
  sourceGenerationSegmentId: z.string().min(1),
}).strict()

export const storyboardConsistencySourceSnapshotSchema = z.object({
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  chapterId: z.string().min(1),
  project: z.object({
    videoRatio: z.string().min(1),
  }),
  editScript: z.object({
    id: z.string().min(1),
    chapterId: z.string().min(1),
    durationSec: z.number().int().nonnegative(),
    shotCount: z.number().int().nonnegative(),
    sourceDocumentId: z.string().min(1).optional(),
    sourceStart: z.number().int().nonnegative().optional(),
    sourceEnd: z.number().int().nonnegative().optional(),
    sourceText: z.string().nullable().optional(),
  }),
  styleBible: editScriptStyleBibleSchema.shape.styleBible,
  shots: z.array(editScriptShotSchema).min(1),
  shotExecutionPlan: editShotExecutionPlanSchema,
  generationSegments: z.array(storyboardConsistencyGenerationSegmentSchema).min(1),
  assets: z.array(sourceAssetSchema),
}).strict()
