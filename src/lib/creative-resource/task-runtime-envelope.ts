import { z } from 'zod'

/**
 * Runtime-owned fields that Task submission and progress reporting may add to
 * a persisted Creative Resource payload. Domain parsers stay strict while all
 * Creative Resource Task kinds share this single exhaustive envelope.
 */
export const creativeResourceTaskRuntimeEnvelopeShape = {
  ui: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().trim().min(1).optional(),
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
