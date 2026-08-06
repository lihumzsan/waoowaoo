import type { PlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
import type { JsonObject } from '@/lib/operations/types'
import type {
  ElicitRequestFormParams,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'

export interface WaoMcpTrustedCallContext {
  /** Product Thread identity resolved outside model-controlled tool arguments. */
  readonly threadId: string
  /** Product Turn identity resolved outside model-controlled tool arguments. */
  readonly turnId: string
  /**
   * Stable Wao tool-call identity derived from the active runtime Turn and the
   * MCP logical request id. The raw transport id is never used without that
   * persisted Turn scope.
   */
  readonly callId: string
  /** Stable Wao command/Turn request identity, resolved by the runtime owner. */
  readonly requestId: string
  /** Active Turn execution fence used by the synchronous ToolEffect owner. */
  readonly executionOwnerId: string
  readonly userId: string
  readonly projectId: string
  readonly source: string
  readonly locale?: string | null
  readonly selectedScopeRef?: string | null
  readonly selectedAssetId?: string | null
  readonly userTurnText?: string | null
  readonly userTurnMediaResourceIds?: readonly string[]
  /** Exact immutable plan Grant associated with this Turn and call, if any. */
  readonly approvedInvocation?: PlannedOperationInvocation | null
  /** Trusted approval decision for this exact destructive Turn/call. */
  readonly destructiveApproved?: boolean
}

export interface WaoMcpOperationExecutorResult {
  /** Executor-owned, model-safe result. Never return credentials or raw keys. */
  readonly structuredContent: JsonObject
  /** Concise model-visible summary of the same structured result. */
  readonly text: string
  readonly isError?: boolean
}

export type WaoMcpElicitationRequest = ElicitRequestFormParams
export type WaoMcpElicitationResult = ElicitResult

export interface WaoMcpOperationExecutor {
  execute(params: {
    readonly operationId: string
    readonly input: Readonly<Record<string, unknown>>
    readonly context: WaoMcpTrustedCallContext
    readonly signal: AbortSignal
    /** Runtime transport for user interaction; execution independently verifies Wao's browser-authenticated decision. */
    readonly elicit: (
      request: WaoMcpElicitationRequest,
    ) => Promise<WaoMcpElicitationResult>
  }): Promise<WaoMcpOperationExecutorResult>
}

export interface WaoMcpExecutionLifecycle {
  before(context: WaoMcpTrustedCallContext): Promise<void>
  assertAuthorized(context: WaoMcpTrustedCallContext): Promise<void>
  after(context: WaoMcpTrustedCallContext): Promise<void>
}

export interface WaoMcpCallContextResolver {
  /**
   * Resolve scope and stable execution identity from the authenticated runtime
   * mapping. Transport request/session ids are lookup hints and are never
   * themselves business execution identities.
   */
  resolve(params: {
    readonly toolName: string
    /** MCP logical request correlation, unique only within its runtime scope. */
    readonly requestId: string | number
    readonly sessionId: string | null
    readonly signal: AbortSignal
  }): Promise<WaoMcpTrustedCallContext | null>
}
