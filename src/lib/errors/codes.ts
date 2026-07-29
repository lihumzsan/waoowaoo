export const ERROR_CATEGORY = {
  AUTH: 'AUTH',
  BILLING: 'BILLING',
  CONTENT: 'CONTENT',
  PROVIDER: 'PROVIDER',
  SYSTEM: 'SYSTEM',
  VALIDATION: 'VALIDATION',
} as const

export type ErrorCategory = (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY]

export const ERROR_FAILURE_CLASS = {
  TRANSIENT_PROVIDER: 'TRANSIENT_PROVIDER',
  PERMANENT_PROVIDER: 'PERMANENT_PROVIDER',
  OUTPUT_VALIDATION: 'OUTPUT_VALIDATION',
} as const

export type ErrorFailureClass = (typeof ERROR_FAILURE_CLASS)[keyof typeof ERROR_FAILURE_CLASS]

export const ERROR_CATALOG = {
  UNAUTHORIZED: {
    httpStatus: 401,
    retryable: false,
    category: ERROR_CATEGORY.AUTH,
    userMessageKey: 'errors.UNAUTHORIZED',
    defaultMessage: 'Unauthorized',
  },
  FORBIDDEN: {
    httpStatus: 403,
    retryable: false,
    category: ERROR_CATEGORY.AUTH,
    userMessageKey: 'errors.FORBIDDEN',
    defaultMessage: 'Forbidden',
  },
  NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.NOT_FOUND',
    defaultMessage: 'Resource not found',
  },
  INVALID_PARAMS: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.INVALID_PARAMS',
    defaultMessage: 'Invalid parameters',
  },
  MISSING_CONFIG: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.MISSING_CONFIG',
    defaultMessage: 'Missing required configuration',
  },
  CONFLICT: {
    httpStatus: 409,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CONFLICT',
    defaultMessage: 'Conflict',
  },
  OPERATION_PLAN_CHANGED: {
    httpStatus: 409,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.OPERATION_PLAN_CHANGED',
    defaultMessage: 'The task plan or price changed. Generate a new quote before continuing.',
  },
  TASK_NOT_READY: {
    httpStatus: 202,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.TASK_NOT_READY',
    defaultMessage: 'Task is not ready',
  },
  NO_RESULT: {
    httpStatus: 404,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.NO_RESULT',
    defaultMessage: 'No task result',
  },
  RATE_LIMIT: {
    httpStatus: 429,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.RATE_LIMIT',
    defaultMessage: 'Rate limit exceeded',
  },
  MODEL_NOT_OPEN: {
    httpStatus: 403,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.MODEL_NOT_OPEN',
    defaultMessage: 'Model is not activated for this account',
  },
  MODEL_NOT_REGISTERED: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.MODEL_NOT_REGISTERED',
    defaultMessage: 'Model is not registered',
  },
  MODEL_NOT_CONFIGURED: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.MODEL_NOT_CONFIGURED',
    defaultMessage: 'Model is not configured. Please add a model in the settings first.',
  },
  QUOTA_EXCEEDED: {
    httpStatus: 429,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.QUOTA_EXCEEDED',
    defaultMessage: 'Quota exceeded',
  },
  EXTERNAL_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.EXTERNAL_ERROR',
    defaultMessage: 'External service failed',
  },
  NETWORK_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.NETWORK_ERROR',
    defaultMessage: 'Network request failed',
  },
  EMPTY_RESPONSE: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.EMPTY_RESPONSE',
    defaultMessage: 'Model returned empty response',
  },
  MODEL_OUTPUT_TRUNCATED: {
    httpStatus: 502,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.MODEL_OUTPUT_TRUNCATED',
    defaultMessage: 'Model output was truncated by the token limit',
  },
  PARSE_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PARSE_ERROR',
    defaultMessage: 'Model output could not be parsed',
  },
  MODEL_OUTPUT_SCHEMA_INVALID: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.MODEL_OUTPUT_SCHEMA_INVALID',
    defaultMessage: 'Model output did not match the required schema',
  },
  PLAN_VALIDATION_FAILED: {
    httpStatus: 502,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PLAN_VALIDATION_FAILED',
    defaultMessage: 'Generated plan did not pass validation',
  },
  PROVIDER_POLL_FAILED: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PROVIDER_POLL_FAILED',
    defaultMessage: 'Provider polling failed',
  },
  PROVIDER_SUBMIT_FAILED: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PROVIDER_SUBMIT_FAILED',
    defaultMessage: 'Provider submission failed',
  },
  PROVIDER_SUBMISSION_REJECTED: {
    httpStatus: 502,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PROVIDER_SUBMISSION_REJECTED',
    defaultMessage: 'Provider rejected the generation request',
  },
  PROVIDER_SUBMISSION_OUTCOME_UNKNOWN: {
    httpStatus: 502,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    defaultMessage: 'Provider submission outcome is unknown',
  },
  INSUFFICIENT_BALANCE: {
    httpStatus: 402,
    retryable: false,
    category: ERROR_CATEGORY.BILLING,
    userMessageKey: 'errors.INSUFFICIENT_BALANCE',
    defaultMessage: 'Insufficient balance',
  },
  SENSITIVE_CONTENT: {
    httpStatus: 422,
    retryable: false,
    category: ERROR_CATEGORY.CONTENT,
    userMessageKey: 'errors.SENSITIVE_CONTENT',
    defaultMessage: 'Sensitive content detected',
  },
  GENERATION_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.GENERATION_TIMEOUT',
    defaultMessage: 'Generation timed out',
  },
  // 外部任务在 provider 队列中排队超预算：与 GENERATION_TIMEOUT（生成阶段超时）分开，
  // 补偿协议为“作废旧 external id + 尽力取消 + 新 attempt 全新提交”（PG-06 扩展）。
  GENERATION_QUEUE_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.GENERATION_QUEUE_TIMEOUT',
    defaultMessage: 'Generation queue wait timed out',
  },
  VIDEO_API_FORMAT_UNSUPPORTED: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.VIDEO_API_FORMAT_UNSUPPORTED',
    defaultMessage: 'Video API format is unsupported',
  },
  GENERATION_FAILED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.GENERATION_FAILED',
    defaultMessage: 'Generation failed',
  },
  WATCHDOG_TIMEOUT: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.WATCHDOG_TIMEOUT',
    defaultMessage: 'Task heartbeat timeout',
  },
  WORKER_EXECUTION_ERROR: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.WORKER_EXECUTION_ERROR',
    defaultMessage: 'Worker execution failed',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.INTERNAL_ERROR',
    defaultMessage: 'Internal server error',
  },
  // Creative Worker 精确错误码:未登记时会被 normalizeAnyError 降级成 INTERNAL_ERROR,
  // 用户只能看到模糊失败(zh/en errors.json 的精确文案早已存在却永远命中不了)。
  // retryable 按语义分:模型行为类(输出/轮数/读取预算)重试可能成功;请求/配置类不会。
  CREATIVE_WORK_REQUEST_INVALID: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CREATIVE_WORK_REQUEST_INVALID',
    defaultMessage: 'Creative work request is invalid',
  },
  CREATIVE_WORK_BUDGET_INVALID: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CREATIVE_WORK_BUDGET_INVALID',
    defaultMessage: 'Creative work budget is invalid',
  },
  CREATIVE_WORK_INPUT_BUDGET_EXCEEDED: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CREATIVE_WORK_INPUT_BUDGET_EXCEEDED',
    defaultMessage: 'Creative work input exceeds the budget',
  },
  CREATIVE_WORK_READ_BUDGET_EXCEEDED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_READ_BUDGET_EXCEEDED',
    defaultMessage: 'Creative work exceeded its skill read budget',
  },
  CREATIVE_WORK_CONTEXT_MISSING: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CREATIVE_WORK_CONTEXT_MISSING',
    defaultMessage: 'Creative work context is missing',
  },
  CREATIVE_WORK_SKILL_EXPLORATION_REQUIRED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_SKILL_EXPLORATION_REQUIRED',
    defaultMessage: 'Creative work must read a specialist skill first',
  },
  CREATIVE_WORK_OUTPUT_MISSING: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_OUTPUT_MISSING',
    defaultMessage: 'Creative work produced no output',
  },
  CREATIVE_WORK_OUTPUT_INVALID: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_OUTPUT_INVALID',
    defaultMessage: 'Creative work output failed validation',
  },
  CREATIVE_WORK_OUTPUT_KIND_MISMATCH: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_OUTPUT_KIND_MISMATCH',
    defaultMessage: 'Creative work output kind mismatched the request',
  },
  CREATIVE_WORK_OUTPUT_BUDGET_EXCEEDED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_OUTPUT_BUDGET_EXCEEDED',
    defaultMessage: 'Creative work output exceeded the budget',
  },
  CREATIVE_WORK_MAX_TURNS_EXCEEDED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_MAX_TURNS_EXCEEDED',
    defaultMessage: 'Creative work exceeded its turn budget',
  },
  CREATIVE_WORK_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_TIMEOUT',
    defaultMessage: 'Creative work timed out',
  },
  CREATIVE_WORK_EVENT_DELIVERY_FAILED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.CREATIVE_WORK_EVENT_DELIVERY_FAILED',
    defaultMessage: 'Creative work lifecycle events could not be delivered',
  },
  CREATIVE_WORK_ABORTED: {
    httpStatus: 499,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.CREATIVE_WORK_ABORTED',
    defaultMessage: 'Creative work was aborted',
  },
  CREATIVE_WORK_RUN_FAILED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.CREATIVE_WORK_RUN_FAILED',
    defaultMessage: 'Creative work run failed',
  },
} as const

export type UnifiedErrorCode = keyof typeof ERROR_CATALOG

export const DEFAULT_ERROR_CODE: UnifiedErrorCode = 'INTERNAL_ERROR'

export const LEGACY_ERROR_CODE_ALIASES: Record<string, UnifiedErrorCode> = {
  OPERATION_FAILED: 'INTERNAL_ERROR',
}

export function isKnownErrorCode(code: unknown): code is UnifiedErrorCode {
  return typeof code === 'string' && code in ERROR_CATALOG
}

export function resolveUnifiedErrorCode(code: unknown): UnifiedErrorCode | null {
  if (isKnownErrorCode(code)) return code
  if (typeof code !== 'string') return null
  const normalized = code.trim().toUpperCase()
  return LEGACY_ERROR_CODE_ALIASES[normalized] || null
}

export function getErrorSpec(code: UnifiedErrorCode) {
  return ERROR_CATALOG[code]
}

export function getErrorFailureClass(code: UnifiedErrorCode): ErrorFailureClass {
  if (
    code === 'EMPTY_RESPONSE'
    || code === 'MODEL_OUTPUT_TRUNCATED'
    || code === 'PARSE_ERROR'
    || code === 'MODEL_OUTPUT_SCHEMA_INVALID'
    || code === 'PLAN_VALIDATION_FAILED'
  ) {
    return ERROR_FAILURE_CLASS.OUTPUT_VALIDATION
  }
  return ERROR_CATALOG[code].retryable
    ? ERROR_FAILURE_CLASS.TRANSIENT_PROVIDER
    : ERROR_FAILURE_CLASS.PERMANENT_PROVIDER
}
