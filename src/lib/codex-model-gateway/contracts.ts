export const CODEX_MODEL_GATEWAY_ASSISTANT_ID = 'workspace-command' as const
export const CODEX_MODEL_GATEWAY_PROVIDER_ID = 'wao-runtime' as const
export const CODEX_RUNTIME_BEARER_ENV_KEY = 'WAO_MCP_RUNTIME_BEARER_TOKEN' as const
export const CODEX_MODEL_GATEWAY_PATH = '/api/internal/codex-runtime/model' as const

export type CodexModelGatewayScope = {
  readonly userId: string
  readonly projectId: string
  readonly assistantId: typeof CODEX_MODEL_GATEWAY_ASSISTANT_ID
}

export type CodexModelGatewayRuntimeConfig = {
  /** Codex capability-catalog identity; the gateway restores the selected upstream id. */
  readonly runtimeModelId: string
  readonly modelId: string
  readonly modelKey: string
  readonly modelProviderId: typeof CODEX_MODEL_GATEWAY_PROVIDER_ID
  /** Base URL consumed by Codex; Codex appends `/responses`. */
  readonly baseUrl: string
  readonly wireApi: 'responses'
  readonly bearerTokenEnvironmentKey: typeof CODEX_RUNTIME_BEARER_ENV_KEY
  /** Same project-scoped bearer used by Wao MCP. */
  readonly bearerToken: string
  /** Codex is the only bounded retry owner for one model sampling request. */
  readonly requestMaxRetries: 1
  readonly streamMaxRetries: 2
}

export type CodexModelGatewayErrorCode =
  | 'SCOPE_INVALID'
  | 'ASSISTANT_MODEL_NOT_CONFIGURED'
  | 'ASSISTANT_MODEL_UNSUPPORTED'
  | 'PROVIDER_RESPONSES_UNSUPPORTED'
  | 'PROVIDER_CONFIG_UNAVAILABLE'
  | 'PROVIDER_BASE_URL_INVALID'
  | 'RUNTIME_BASE_URL_INVALID'
  | 'RUNTIME_TOKEN_SCOPE_MISMATCH'
  | 'ACTIVE_TURN_REQUIRED'
  | 'REQUEST_ENDPOINT_INVALID'
  | 'REQUEST_CONTENT_TYPE_INVALID'
  | 'REQUEST_BODY_READ_FAILED'
  | 'REQUEST_BODY_JSON_INVALID'
  | 'REQUEST_TURN_IDENTITY_INVALID'
  | 'REQUEST_TOOLS_INVALID'
  | 'REQUEST_BODY_INVALID'
  | 'REQUEST_INSTRUCTIONS_INVALID'
  | 'REQUEST_MODEL_MISMATCH'
  | 'BILLING_BALANCE_INSUFFICIENT'
  | 'PROVIDER_REQUEST_FAILED'
  | 'SEARCH_COMMAND_UNSUPPORTED'
  | 'SEARCH_QUERY_INVALID'
  | 'PROVIDER_SEARCH_RESPONSE_INVALID'
  | 'PROVIDER_SEARCH_RESULT_MISSING'

export class CodexModelGatewayError extends Error {
  readonly code: CodexModelGatewayErrorCode
  readonly httpStatus: number
  override readonly cause?: unknown

  constructor(
    code: CodexModelGatewayErrorCode,
    httpStatus: number,
    cause?: unknown,
  ) {
    super(`CODEX_MODEL_GATEWAY_${code}`, { cause })
    this.name = 'CodexModelGatewayError'
    this.code = code
    this.httpStatus = httpStatus
    this.cause = cause
  }
}
