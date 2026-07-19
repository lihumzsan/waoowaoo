export const CREATIVE_WORKER_ERROR_CODES = [
  'CREATIVE_WORK_REQUEST_INVALID',
  'CREATIVE_WORK_BUDGET_INVALID',
  'CREATIVE_WORK_INPUT_BUDGET_EXCEEDED',
  'CREATIVE_WORK_DISCOVERY_BUDGET_EXCEEDED',
  'CREATIVE_WORK_READ_BUDGET_EXCEEDED',
  'CREATIVE_WORK_RESOURCE_BUDGET_EXCEEDED',
  'CREATIVE_WORK_CONTENT_BUDGET_EXCEEDED',
  'CREATIVE_WORK_REQUIRED_SKILL_NOT_FOUND',
  'CREATIVE_WORK_CONTEXT_MISSING',
  'CREATIVE_WORK_SKILL_EXPLORATION_REQUIRED',
  'CREATIVE_WORK_OUTPUT_MISSING',
  'CREATIVE_WORK_OUTPUT_INVALID',
  'CREATIVE_WORK_OUTPUT_KIND_MISMATCH',
  'CREATIVE_WORK_OUTPUT_BUDGET_EXCEEDED',
  'CREATIVE_WORK_MAX_TURNS_EXCEEDED',
  'CREATIVE_WORK_TIMEOUT',
  'CREATIVE_WORK_EVENT_DELIVERY_FAILED',
  'CREATIVE_WORK_ABORTED',
  'CREATIVE_WORK_RUN_FAILED',
] as const

export type CreativeWorkerErrorCode = (typeof CREATIVE_WORKER_ERROR_CODES)[number]

export class CreativeWorkerError extends Error {
  readonly code: CreativeWorkerErrorCode
  readonly details: Readonly<Record<string, string | number | boolean | null>>

  constructor(
    code: CreativeWorkerErrorCode,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
    options?: ErrorOptions,
  ) {
    super(code, options)
    this.name = 'CreativeWorkerError'
    this.code = code
    this.details = details
  }
}

export function isCreativeWorkerError(error: unknown): error is CreativeWorkerError {
  return error instanceof CreativeWorkerError
}
