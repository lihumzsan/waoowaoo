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

function defineErrorSpec<const Code extends string>(
  code: Code,
  httpStatus: number,
  retryable: boolean,
  category: ErrorCategory,
  defaultMessage: string,
) {
  return {
    httpStatus,
    retryable,
    category,
    userMessageKey: `errors.${code}` as const,
    defaultMessage,
  }
}

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
  PAYLOAD_TOO_LARGE: defineErrorSpec('PAYLOAD_TOO_LARGE', 413, false, ERROR_CATEGORY.VALIDATION, 'Payload is too large'),
  UPLOAD_FILE_EMPTY: defineErrorSpec('UPLOAD_FILE_EMPTY', 400, false, ERROR_CATEGORY.VALIDATION, 'Uploaded file is empty'),
  UPLOAD_MEDIA_TYPE_UNSUPPORTED: defineErrorSpec('UPLOAD_MEDIA_TYPE_UNSUPPORTED', 415, false, ERROR_CATEGORY.VALIDATION, 'Uploaded media type is unsupported'),
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_FILE_NAME_EMPTY: defineErrorSpec('PROJECT_ASSISTANT_TEXT_ATTACHMENT_FILE_NAME_EMPTY', 400, false, ERROR_CATEGORY.VALIDATION, 'Text attachment file name is empty'),
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_UNSUPPORTED_TYPE: defineErrorSpec('PROJECT_ASSISTANT_TEXT_ATTACHMENT_UNSUPPORTED_TYPE', 415, false, ERROR_CATEGORY.VALIDATION, 'Text attachment type is unsupported'),
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_EMPTY: defineErrorSpec('PROJECT_ASSISTANT_TEXT_ATTACHMENT_EMPTY', 400, false, ERROR_CATEGORY.VALIDATION, 'Text attachment is empty'),
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_SIZE_LIMIT_EXCEEDED: defineErrorSpec('PROJECT_ASSISTANT_TEXT_ATTACHMENT_SIZE_LIMIT_EXCEEDED', 413, false, ERROR_CATEGORY.VALIDATION, 'Text attachment exceeds the size limit'),
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_CHAR_LIMIT_EXCEEDED: defineErrorSpec('PROJECT_ASSISTANT_TEXT_ATTACHMENT_CHAR_LIMIT_EXCEEDED', 413, false, ERROR_CATEGORY.VALIDATION, 'Text attachment exceeds the character limit'),
  PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY: defineErrorSpec('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY', 400, false, ERROR_CATEGORY.VALIDATION, 'Too many text attachments'),
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_UNSUPPORTED_TYPE: defineErrorSpec('PROJECT_ASSISTANT_MEDIA_ATTACHMENT_UNSUPPORTED_TYPE', 415, false, ERROR_CATEGORY.VALIDATION, 'Media attachment type is unsupported'),
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_SIZE_LIMIT_EXCEEDED: defineErrorSpec('PROJECT_ASSISTANT_MEDIA_ATTACHMENT_SIZE_LIMIT_EXCEEDED', 413, false, ERROR_CATEGORY.VALIDATION, 'Media attachment exceeds the size limit'),
  PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY: defineErrorSpec('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY', 400, false, ERROR_CATEGORY.VALIDATION, 'Too many media attachments'),
  OPERATION_IDEMPOTENCY_KEY_REQUIRED: defineErrorSpec('OPERATION_IDEMPOTENCY_KEY_REQUIRED', 400, false, ERROR_CATEGORY.VALIDATION, 'This operation requires a stable request identity'),
  OPERATION_IDEMPOTENCY_KEY_INVALID: defineErrorSpec('OPERATION_IDEMPOTENCY_KEY_INVALID', 400, false, ERROR_CATEGORY.VALIDATION, 'The stable request identity is invalid'),
  OPERATION_PLAN_REQUEST_REPLAY_DIVERGED: defineErrorSpec('OPERATION_PLAN_REQUEST_REPLAY_DIVERGED', 409, false, ERROR_CATEGORY.VALIDATION, 'This request identity was already used for a different operation plan'),
  CREATIVE_RESOURCE_ARCHIVE_ACTIVE: defineErrorSpec('CREATIVE_RESOURCE_ARCHIVE_ACTIVE', 409, false, ERROR_CATEGORY.VALIDATION, 'A Resource with active generation cannot be archived'),
  CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND: defineErrorSpec('CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND', 404, false, ERROR_CATEGORY.VALIDATION, 'The failed Resource to retry was not found'),
  CREATIVE_RESOURCE_RETRY_TARGET_DUPLICATE: defineErrorSpec('CREATIVE_RESOURCE_RETRY_TARGET_DUPLICATE', 400, false, ERROR_CATEGORY.VALIDATION, 'The same Resource was selected more than once'),
  CREATIVE_RESOURCE_RETRY_TARGET_INVALID: defineErrorSpec('CREATIVE_RESOURCE_RETRY_TARGET_INVALID', 409, false, ERROR_CATEGORY.VALIDATION, 'This Resource is not currently retryable'),
  CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISSING: defineErrorSpec('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISSING', 409, false, ERROR_CATEGORY.VALIDATION, 'The original generation input is unavailable'),
  CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_AMBIGUOUS: defineErrorSpec('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_AMBIGUOUS', 409, false, ERROR_CATEGORY.SYSTEM, 'The original generation input is ambiguous'),
  CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID: defineErrorSpec('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID', 409, false, ERROR_CATEGORY.SYSTEM, 'The original generation input is no longer valid'),
  CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISMATCH: defineErrorSpec('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISMATCH', 409, false, ERROR_CATEGORY.SYSTEM, 'The original generation input no longer matches this Resource'),
  CREATIVE_RESOURCE_RETRY_TARGET_CHANGED: defineErrorSpec('CREATIVE_RESOURCE_RETRY_TARGET_CHANGED', 409, false, ERROR_CATEGORY.VALIDATION, 'The Resource changed before the retry could be submitted'),
  VOICE_RESOURCE_ALTERNATIVE_GROUP_MEMBER: defineErrorSpec('VOICE_RESOURCE_ALTERNATIVE_GROUP_MEMBER', 409, false, ERROR_CATEGORY.VALIDATION, 'This voice is part of an alternatives group and cannot be physically deleted'),
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
  PROVIDER_AUTH_INVALID: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PROVIDER_AUTH_INVALID',
    defaultMessage: 'Provider credentials are missing or invalid',
  },
  PROVIDER_BILLING_REQUIRED: {
    httpStatus: 402,
    retryable: false,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.PROVIDER_BILLING_REQUIRED',
    defaultMessage: 'Provider account billing requires attention',
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
  CONTEXT_BUDGET_EXCEEDED: {
    httpStatus: 413,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CONTEXT_BUDGET_EXCEEDED',
    defaultMessage: 'The assistant context is too large to process',
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
  MUSIC_PROMPT_TOO_LONG: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.MUSIC_PROMPT_TOO_LONG',
    defaultMessage: 'Music prompt exceeds the model limit',
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
  AGENT_TEMPORAL_UNAVAILABLE: defineErrorSpec('AGENT_TEMPORAL_UNAVAILABLE', 503, true, ERROR_CATEGORY.SYSTEM, 'Assistant execution service is unavailable'),
  AGENT_THREAD_BUSY: defineErrorSpec('AGENT_THREAD_BUSY', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant thread is busy'),
  AGENT_TURN_COMMAND_REPLAY_DIVERGED: defineErrorSpec('AGENT_TURN_COMMAND_REPLAY_DIVERGED', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant command identity conflicts with an earlier command'),
  PROJECT_AGENT_RUNTIME_FAILED: defineErrorSpec('PROJECT_AGENT_RUNTIME_FAILED', 502, true, ERROR_CATEGORY.SYSTEM, 'Assistant runtime failed'),
  PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED: defineErrorSpec('PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED', 400, false, ERROR_CATEGORY.PROVIDER, 'Assistant model is not configured'),
  PROJECT_AGENT_ASSISTANT_MODEL_INVALID: defineErrorSpec('PROJECT_AGENT_ASSISTANT_MODEL_INVALID', 400, false, ERROR_CATEGORY.PROVIDER, 'Assistant model configuration is invalid'),
  PROJECT_ASSISTANT_EPISODE_SCOPE_INVALID: defineErrorSpec('PROJECT_ASSISTANT_EPISODE_SCOPE_INVALID', 400, false, ERROR_CATEGORY.VALIDATION, 'Assistant episode scope is invalid'),
  PROJECT_DELETE_ACTIVE_EXECUTION: defineErrorSpec('PROJECT_DELETE_ACTIVE_EXECUTION', 409, false, ERROR_CATEGORY.VALIDATION, 'Project has active work'),
  PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED: defineErrorSpec('PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant turn protocol requires another user instruction'),
  PROJECT_AGENT_RUN_ACTIVE: defineErrorSpec('PROJECT_AGENT_RUN_ACTIVE', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant run is already active'),
  PROJECT_AGENT_CONTROL_ALREADY_RESOLVED: defineErrorSpec('PROJECT_AGENT_CONTROL_ALREADY_RESOLVED', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant control was already resolved'),
  PROJECT_AGENT_INTERRUPTION_NOT_PENDING: defineErrorSpec('PROJECT_AGENT_INTERRUPTION_NOT_PENDING', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant interruption is no longer pending'),
  PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING: defineErrorSpec('PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant choice interruption is no longer pending'),
  PROJECT_AGENT_CHOICE_OFFER_STALE: defineErrorSpec('PROJECT_AGENT_CHOICE_OFFER_STALE', 409, false, ERROR_CATEGORY.SYSTEM, 'Assistant choice offer is stale'),
  PROJECT_ASSISTANT_CARD_RESPONSE_FAILED: defineErrorSpec('PROJECT_ASSISTANT_CARD_RESPONSE_FAILED', 502, true, ERROR_CATEGORY.SYSTEM, 'Assistant card response failed'),
  PROJECT_ASSISTANT_BACKGROUND_FOLLOW_UP_FAILED: defineErrorSpec('PROJECT_ASSISTANT_BACKGROUND_FOLLOW_UP_FAILED', 502, true, ERROR_CATEGORY.SYSTEM, 'Assistant background follow-up failed'),
  CREATIVE_CONTEXT_INPUT_INVALID: defineErrorSpec('CREATIVE_CONTEXT_INPUT_INVALID', 400, false, ERROR_CATEGORY.VALIDATION, 'Creative context input is invalid'),
  CREATIVE_CONTEXT_SOURCE_MISMATCH: defineErrorSpec('CREATIVE_CONTEXT_SOURCE_MISMATCH', 409, false, ERROR_CATEGORY.VALIDATION, 'Creative context source does not match'),
  CREATIVE_CONTEXT_CHAPTER_NOT_FOUND: defineErrorSpec('CREATIVE_CONTEXT_CHAPTER_NOT_FOUND', 404, false, ERROR_CATEGORY.VALIDATION, 'Creative context chapter was not found'),
  CREATIVE_CONTEXT_RESOURCE_NOT_FOUND: defineErrorSpec('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', 404, false, ERROR_CATEGORY.VALIDATION, 'Creative context resource was not found'),
  CREATIVE_CONTEXT_RESOURCE_REVISION_CHANGED: defineErrorSpec('CREATIVE_CONTEXT_RESOURCE_REVISION_CHANGED', 409, false, ERROR_CATEGORY.VALIDATION, 'Creative context resource revision changed'),
  CREATIVE_CONTEXT_CHAPTER_RANGE_INVALID: defineErrorSpec('CREATIVE_CONTEXT_CHAPTER_RANGE_INVALID', 400, false, ERROR_CATEGORY.VALIDATION, 'Creative context chapter range is invalid'),
  CREATIVE_CONTEXT_BEAT_COVERAGE_INVALID: defineErrorSpec('CREATIVE_CONTEXT_BEAT_COVERAGE_INVALID', 400, false, ERROR_CATEGORY.VALIDATION, 'Creative context beat coverage is invalid'),
  CREATIVE_CONTEXT_EVENT_MISMATCH: defineErrorSpec('CREATIVE_CONTEXT_EVENT_MISMATCH', 409, false, ERROR_CATEGORY.VALIDATION, 'Creative context events do not match'),
  CREATIVE_CONTEXT_SNAPSHOT_MISMATCH: defineErrorSpec('CREATIVE_CONTEXT_SNAPSHOT_MISMATCH', 409, false, ERROR_CATEGORY.VALIDATION, 'Creative context snapshot does not match'),
  CREATIVE_CONTEXT_ENTITY_AMBIGUOUS: defineErrorSpec('CREATIVE_CONTEXT_ENTITY_AMBIGUOUS', 400, false, ERROR_CATEGORY.VALIDATION, 'Creative context entity is ambiguous'),
  CREATIVE_CONTEXT_ENTITY_MISSING: defineErrorSpec('CREATIVE_CONTEXT_ENTITY_MISSING', 400, false, ERROR_CATEGORY.VALIDATION, 'Creative context entity is missing'),
  CREATIVE_CONTEXT_ASSET_CONFLICT: defineErrorSpec('CREATIVE_CONTEXT_ASSET_CONFLICT', 409, false, ERROR_CATEGORY.VALIDATION, 'Creative context assets conflict'),
  CREATIVE_CONTEXT_BUDGET_EXCEEDED: defineErrorSpec('CREATIVE_CONTEXT_BUDGET_EXCEEDED', 413, false, ERROR_CATEGORY.VALIDATION, 'Creative context exceeds the budget'),
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
  CREATIVE_WORK_RESOURCE_BUDGET_EXCEEDED: defineErrorSpec('CREATIVE_WORK_RESOURCE_BUDGET_EXCEEDED', 500, true, ERROR_CATEGORY.PROVIDER, 'A creative work resource exceeded the read budget'),
  CREATIVE_WORK_CONTENT_BUDGET_EXCEEDED: defineErrorSpec('CREATIVE_WORK_CONTENT_BUDGET_EXCEEDED', 500, true, ERROR_CATEGORY.PROVIDER, 'Creative work content exceeded the read budget'),
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

export function isKnownErrorCode(code: unknown): code is UnifiedErrorCode {
  return typeof code === 'string' && code in ERROR_CATALOG
}

export function resolveUnifiedErrorCode(code: unknown): UnifiedErrorCode | null {
  if (isKnownErrorCode(code)) return code
  if (typeof code !== 'string') return null
  const normalized = code.trim().toUpperCase()
  return isKnownErrorCode(normalized) ? normalized : null
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
