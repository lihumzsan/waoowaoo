import { createHash, randomUUID } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { readJsonWithLimit } from '@/lib/http/body-limits'
import {
  AssistantRuntimeCapabilityTurnError,
  requireAssistantRuntimeCapabilityTurn,
  type AssistantRuntimeCapabilityTurn,
} from '@/lib/assistant-runtime/capability-turn'
import type {
  WaoMcpCallContextResolver,
  WaoMcpTrustedCallContext,
} from './contracts'
import { createProductionWaoMcpOperationExecutor } from './production-executor'
import type { WaoRuntimeTokenPayload } from './runtime-token'
import { createWaoMcpServer } from './server'

const WAO_MCP_MAX_ACTIVE_HTTP_SESSIONS = 1_024
const WAO_MCP_SESSION_ID_MAX_CHARS = 191
const WAO_MCP_REQUEST_MAX_BYTES = 2 * 1_024 * 1_024

type WaoMcpHttpSession = {
  id: string
  readonly scopeKey: string
  readonly expiresAtMs: number
  readonly server: ReturnType<typeof createWaoMcpServer>
  readonly transport: WebStandardStreamableHTTPServerTransport
}

const sessionsById = new Map<string, WaoMcpHttpSession>()
const sessionIdByScope = new Map<string, string>()
const initializingScopes = new Set<string>()
let pendingInitializations = 0

export type WaoMcpHttpBindingErrorCode =
  | 'ACTIVE_TURN_NOT_FOUND'
  | 'ACTIVE_TURN_AMBIGUOUS'
  | 'ACTIVE_TURN_IDENTITY_INVALID'
  | 'ACTIVE_TURN_CONTEXT_INVALID'

export class WaoMcpHttpBindingError extends Error {
  readonly code: WaoMcpHttpBindingErrorCode
  override readonly cause?: unknown

  constructor(code: WaoMcpHttpBindingErrorCode, cause?: unknown) {
    super(`WAO_MCP_HTTP_${code}`, { cause })
    this.name = 'WaoMcpHttpBindingError'
    this.code = code
    this.cause = cause
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseOptionalIdentity(
  value: unknown,
  code: WaoMcpHttpBindingErrorCode,
): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new WaoMcpHttpBindingError(code)
  }
  return value
}

function buildCodexMcpCallId(params: {
  readonly runtimeTurnId: string
  readonly transportRequestId: string | number
}): string {
  const canonical = JSON.stringify([
    'codex-mcp-call-v1',
    params.runtimeTurnId,
    String(params.transportRequestId),
  ])
  return `codex_mcp_${createHash('sha256').update(canonical, 'utf8').digest('base64url')}`
}

function buildRuntimeScopeKey(scope: WaoRuntimeTokenPayload): string {
  return JSON.stringify([
    'wao-mcp-runtime-scope-v1',
    scope.userId,
    scope.projectId,
    scope.assistantId,
    scope.nonce,
  ])
}

function mcpHttpError(
  status: number,
  code: number,
  message: string,
  headers?: Readonly<Record<string, string>>,
): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...headers,
      },
    },
  )
}

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function readSessionId(request: Request): string | null {
  const value = request.headers.get('mcp-session-id')?.trim() || null
  if (value && value.length > WAO_MCP_SESSION_ID_MAX_CHARS) return null
  return value
}

function removeSession(entry: WaoMcpHttpSession): void {
  if (sessionsById.get(entry.id) === entry) {
    sessionsById.delete(entry.id)
  }
  if (sessionIdByScope.get(entry.scopeKey) === entry.id) {
    sessionIdByScope.delete(entry.scopeKey)
  }
}

async function closeSession(entry: WaoMcpHttpSession): Promise<void> {
  removeSession(entry)
  await entry.server.close()
}

async function purgeExpiredSessions(nowMs: number): Promise<void> {
  const expired = [...sessionsById.values()].filter(
    (entry) => entry.expiresAtMs <= nowMs,
  )
  await Promise.allSettled(expired.map(async (entry) => await closeSession(entry)))
}

async function replaceScopeSession(scopeKey: string): Promise<void> {
  const existingId = sessionIdByScope.get(scopeKey)
  if (!existingId) return
  const existing = sessionsById.get(existingId)
  if (!existing) {
    sessionIdByScope.delete(scopeKey)
    return
  }
  await closeSession(existing)
}

async function parsePostBody(
  request: Request,
): Promise<unknown> {
  return await readJsonWithLimit(
    request,
    WAO_MCP_REQUEST_MAX_BYTES,
    'Wao MCP request',
  )
}

async function startHttpSessionExclusive(params: {
  readonly request: Request
  readonly scope: WaoRuntimeTokenPayload
  readonly parsedBody: unknown
}): Promise<Response> {
  const scopeKey = buildRuntimeScopeKey(params.scope)
  await replaceScopeSession(scopeKey)
  if (
    sessionsById.size + pendingInitializations
    >= WAO_MCP_MAX_ACTIVE_HTTP_SESSIONS
  ) {
    return mcpHttpError(
      503,
      -32000,
      'Wao MCP session capacity is exhausted.',
      { 'Retry-After': '1' },
    )
  }

  let entry: WaoMcpHttpSession | null = null
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: false,
    onsessioninitialized: async (sessionId) => {
      if (!entry || sessionsById.has(sessionId)) {
        throw new Error('WAO_MCP_HTTP_SESSION_ID_COLLISION')
      }
      entry.id = sessionId
      sessionsById.set(sessionId, entry)
      sessionIdByScope.set(scopeKey, sessionId)
    },
    onsessionclosed: () => {
      if (entry) removeSession(entry)
    },
  })
  const server = createWaoMcpServer({
    executor: createProductionWaoMcpOperationExecutor({
      lifecycle: {
        before: async (context) => {
          await assertBoundRuntimeContext(params.scope, context)
        },
        assertAuthorized: async (context) => {
          await assertBoundRuntimeContext(params.scope, context)
        },
        after: async () => {},
      },
    }),
    contextResolver: createBoundContextResolver(params.scope),
  })
  entry = {
    id: '',
    scopeKey,
    expiresAtMs: params.scope.expiry * 1_000,
    server,
    transport,
  }

  pendingInitializations += 1
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(params.request, {
      parsedBody: params.parsedBody,
    })
    const initializedId = transport.sessionId
    if (!initializedId) {
      await server.close()
      return response
    }
    const registered = sessionsById.get(initializedId)
    if (registered !== entry) {
      await server.close()
      return mcpHttpError(
        500,
        -32603,
        'Wao MCP session initialization failed.',
      )
    }
    return withNoStore(response)
  } catch (error) {
    if (entry) removeSession(entry)
    await server.close().catch(() => undefined)
    throw error
  } finally {
    pendingInitializations -= 1
  }
}

async function startHttpSession(params: {
  readonly request: Request
  readonly scope: WaoRuntimeTokenPayload
  readonly parsedBody: unknown
}): Promise<Response> {
  const scopeKey = buildRuntimeScopeKey(params.scope)
  if (initializingScopes.has(scopeKey)) {
    return mcpHttpError(
      409,
      -32000,
      'Wao MCP session initialization is already in progress.',
    )
  }
  initializingScopes.add(scopeKey)
  try {
    return await startHttpSessionExclusive(params)
  } finally {
    initializingScopes.delete(scopeKey)
  }
}

async function handleExistingSession(params: {
  readonly request: Request
  readonly scope: WaoRuntimeTokenPayload
  readonly sessionId: string
  readonly parsedBody?: unknown
}): Promise<Response> {
  const entry = sessionsById.get(params.sessionId)
  if (!entry) {
    return mcpHttpError(404, -32001, 'Wao MCP session was not found.')
  }
  if (entry.scopeKey !== buildRuntimeScopeKey(params.scope)) {
    return mcpHttpError(403, -32000, 'Wao MCP session scope mismatch.')
  }
  const response = await entry.transport.handleRequest(params.request, {
    ...(params.parsedBody === undefined
      ? {}
      : { parsedBody: params.parsedBody }),
  })
  if (params.request.method === 'DELETE') {
    removeSession(entry)
  }
  return withNoStore(response)
}

type ActiveRuntimeTurnBinding = Omit<
  WaoMcpTrustedCallContext,
  'callId'
>

async function resolveActiveRuntimeTurnBinding(
  scope: WaoRuntimeTokenPayload,
): Promise<{
  readonly base: ActiveRuntimeTurnBinding
  readonly runtimeTurnId: string
}> {
  let turn: AssistantRuntimeCapabilityTurn
  try {
    turn = await requireAssistantRuntimeCapabilityTurn({
      scope,
      ownerToken: scope.nonce,
    })
  } catch (error) {
    if (!(error instanceof AssistantRuntimeCapabilityTurnError)) throw error
    if (error.code === 'ACTIVE_TURN_AMBIGUOUS') {
      throw new WaoMcpHttpBindingError('ACTIVE_TURN_AMBIGUOUS', error)
    }
    if (error.code === 'ACTIVE_TURN_IDENTITY_INVALID') {
      throw new WaoMcpHttpBindingError('ACTIVE_TURN_IDENTITY_INVALID', error)
    }
    throw new WaoMcpHttpBindingError('ACTIVE_TURN_NOT_FOUND', error)
  }
  if (!isRecord(turn.contextJson)) {
    throw new WaoMcpHttpBindingError('ACTIVE_TURN_CONTEXT_INVALID')
  }
  return {
    runtimeTurnId: turn.runtimeTurnId,
    base: {
      threadId: turn.threadId,
      turnId: turn.turnId,
      requestId: turn.requestId,
      executionOwnerId: turn.executionOwnerId,
      userId: scope.userId,
      projectId: scope.projectId,
      source: 'codex_runtime_mcp',
      locale: parseOptionalIdentity(
        turn.contextJson.locale,
        'ACTIVE_TURN_CONTEXT_INVALID',
      ),
      selectedScopeRef: parseOptionalIdentity(
        turn.contextJson.selectedScopeRef,
        'ACTIVE_TURN_CONTEXT_INVALID',
      ),
      selectedAssetId: parseOptionalIdentity(
        turn.contextJson.selectedAssetId,
        'ACTIVE_TURN_CONTEXT_INVALID',
      ),
      userTurnText: null,
      userTurnMediaResourceIds: [],
      approvedInvocation: null,
      destructiveApproved: false,
    },
  }
}

function createBoundContextResolver(
  scope: WaoRuntimeTokenPayload,
): WaoMcpCallContextResolver {
  return {
    async resolve(call): Promise<WaoMcpTrustedCallContext> {
      call.signal.throwIfAborted()
      const binding = await resolveActiveRuntimeTurnBinding(scope)
      call.signal.throwIfAborted()
      return {
        ...binding.base,
        callId: buildCodexMcpCallId({
          runtimeTurnId: binding.runtimeTurnId,
          transportRequestId: call.requestId,
        }),
      }
    },
  }
}

async function assertBoundRuntimeContext(
  scope: WaoRuntimeTokenPayload,
  context: WaoMcpTrustedCallContext,
): Promise<void> {
  const binding = await resolveActiveRuntimeTurnBinding(scope)
  if (
    binding.base.threadId !== context.threadId
    || binding.base.turnId !== context.turnId
    || binding.base.executionOwnerId !== context.executionOwnerId
  ) {
    throw new WaoMcpHttpBindingError('ACTIVE_TURN_IDENTITY_INVALID')
  }
}

/**
 * Handles one authenticated request in a process-local stateful MCP session.
 * The session exists only to carry protocol requests such as elicitation; it is
 * not product state. The signed token nonce must still own the project's Redis
 * Runtime placement, and the current running Turn is re-read from MySQL for
 * every tool call as the product execution fence.
 */
export async function handleWaoMcpHttpRequest(params: {
  readonly request: Request
  readonly scope: WaoRuntimeTokenPayload
}): Promise<Response> {
  params.request.signal.throwIfAborted()
  await purgeExpiredSessions(Date.now())
  if (
    params.request.method !== 'POST'
    && params.request.method !== 'GET'
    && params.request.method !== 'DELETE'
  ) {
    return mcpHttpError(405, -32000, 'Method not allowed.', {
      Allow: 'POST, GET, DELETE',
    })
  }

  const rawSessionId = params.request.headers.get('mcp-session-id')
  const sessionId = readSessionId(params.request)
  if (rawSessionId !== null && !sessionId) {
    return mcpHttpError(400, -32000, 'Mcp-Session-Id is invalid.')
  }
  let parsedBody: unknown | undefined
  if (params.request.method === 'POST') {
    try {
      parsedBody = await parsePostBody(params.request)
    } catch {
      return mcpHttpError(400, -32700, 'Wao MCP request body is invalid.')
    }
  }
  if (sessionId) {
    return await handleExistingSession({
      request: params.request,
      scope: params.scope,
      sessionId,
      ...(parsedBody === undefined ? {} : { parsedBody }),
    })
  }
  if (params.request.method !== 'POST') {
    return mcpHttpError(
      400,
      -32000,
      'Mcp-Session-Id is required.',
    )
  }
  if (!isInitializeRequest(parsedBody)) {
    return mcpHttpError(
      400,
      -32000,
      'A valid initialize request is required.',
    )
  }
  return await startHttpSession({
    request: params.request,
    scope: params.scope,
    parsedBody,
  })
}
