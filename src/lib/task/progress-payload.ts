import { z } from 'zod'
import { ASYNC_PENDING_PHASES } from '@/lib/ai-providers/async-task-types'

/**
 * The complete Task-owned runtime envelope that may be persisted alongside a
 * frozen Task input. Domain payload parsers reuse this shape so the progress
 * writer and every strict consumer have one contract.
 */
export const taskRuntimePayloadEnvelopeShape = {
  ui: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().trim().min(1).optional(),
  externalPhase: z.enum(ASYNC_PENDING_PHASES).optional(),
  sync: z.number().optional(),
  flowId: z.string().optional(),
  flowStageIndex: z.number().optional(),
  flowStageTotal: z.number().optional(),
  flowStageTitle: z.string().optional(),
  stage: z.string().optional(),
  stageLabel: z.string().optional(),
  displayMode: z.string().optional(),
  message: z.string().optional(),
}

const persistedTaskProgressPayloadSchema = z.object({
  ...taskRuntimePayloadEnvelopeShape,
  lifecycleProjection: z.record(z.string(), z.unknown()).optional(),
}).strip()

/**
 * Progress events may contain provider or stream details for live SSE
 * consumers. Only the declared durable projection is allowed into Task.payload.
 */
export function projectPersistedTaskProgressPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return persistedTaskProgressPayloadSchema.parse(payload)
}
