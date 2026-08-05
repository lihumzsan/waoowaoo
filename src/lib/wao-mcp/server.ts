import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ElicitResultSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import type { JsonObject } from '@/lib/operations/types'
import type {
  WaoMcpCallContextResolver,
  WaoMcpOperationExecutor,
  WaoMcpOperationExecutorResult,
} from './contracts'
import { createScopedLogger } from '@/lib/logging/core'
import { createWaoMcpOperationCatalog } from './operation-catalog'
import { WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS } from './runtime-token'

// MCP server-to-client requests have their own 60 second SDK default, separate
// from Codex's per-tool timeout. A billing elicitation is a user decision, so
// keep it alive within (but safely below) the capability token lifetime.
const mcpLogger = createScopedLogger({ module: 'wao-mcp.server' })

const WAO_MCP_ELICITATION_TIMEOUT_MS = (
  WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS - 5 * 60
) * 1_000

export interface CreateWaoMcpServerParams {
  readonly executor: WaoMcpOperationExecutor
  readonly contextResolver: WaoMcpCallContextResolver
  readonly name?: string
  readonly version?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readProgressToken(meta: unknown): string | number | null {
  const token = isRecord(meta) ? meta.progressToken : undefined
  return typeof token === 'string' || typeof token === 'number' ? token : null
}

function toJsonObject(value: unknown): JsonObject {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('WAO_MCP_ERROR_RESULT_NOT_JSON')
  const parsed: unknown = JSON.parse(serialized)
  if (!isRecord(parsed)) throw new Error('WAO_MCP_ERROR_RESULT_NOT_OBJECT')
  return parsed as JsonObject
}

function errorResult(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: {
      ok: false,
      error: { code, message },
    },
  }
}

function projectExecutorResult(
  result: WaoMcpOperationExecutorResult,
): CallToolResult {
  const text = result.text.trim()
  if (!text) {
    return errorResult(
      'WAO_MCP_EXECUTOR_RESULT_INVALID',
      'The operation executor returned an invalid result.',
    )
  }
  return {
    ...(result.isError ? { isError: true } : {}),
    content: [{ type: 'text', text }],
    structuredContent: result.structuredContent,
  }
}

/**
 * Creates the transport-independent MCP protocol server. The context resolver
 * binds each request to trusted Wao scope and stable Turn/call identity. The
 * executor owns canonical Operation validation, approvals and execution. This
 * layer only advertises registry-derived tools and forwards calls; it never
 * reads or writes DB, Task, billing, or provider state.
 */
export function createWaoMcpServer(
  params: CreateWaoMcpServerParams,
): Server {
  const catalog = createWaoMcpOperationCatalog()
  const entryByName = new Map(
    catalog.map((entry) => [entry.operationId, entry] as const),
  )
  const server = new Server(
    {
      name: params.name?.trim() || 'wao-mcp',
      version: params.version?.trim() || '0.1.0',
    },
    {
      capabilities: { tools: {} },
      instructions:
        'Wao creative production tools. Tool schemas and descriptions come from the canonical Operation registry.',
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: catalog.map((entry) => entry.tool),
    }),
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> => {
      const entry = entryByName.get(request.params.name)
      if (!entry) {
        return errorResult(
          'WAO_MCP_OPERATION_NOT_ALLOWED',
          'This operation is not available through Wao MCP.',
        )
      }

      // MCP only permits progress for a request that asked for it, and the
      // token is what routes a notification back to that call. No token means
      // the client wants none, so nothing is sent.
      const progressToken = readProgressToken(request.params._meta)
      // Whether the client asks for progress is not knowable from our side, and
      // the answer decides whether live tool lines can exist at all. Record it
      // once per call so real usage settles it instead of a guess.
      mcpLogger.info({
        action: 'wao_mcp.tool_call_received',
        message: 'wao mcp tool call received',
        details: { operationId: entry.operationId, progressRequested: progressToken !== null },
      })
      // MCP requires the progress value to increase with every notification, and
      // a compliant client drops the ones that do not. A fixed value therefore
      // sends nothing at all — the notifications leave and are discarded.
      let progressSequence = 0
      const reportProgress = (message: string): void => {
        const text = message.trim()
        if (progressToken === null || !text) return
        progressSequence += 1
        // Progress is decoration: a transport hiccup here must never surface as
        // a tool failure, so delivery failures are dropped on purpose.
        // Records what we actually put on the wire, so a missing progress line
        // can be attributed to a hop instead of investigated from scratch.
        mcpLogger.info({
          action: 'wao_mcp.progress_sent',
          message: 'wao mcp progress notification sent',
          details: { operationId: entry.operationId, sequence: progressSequence },
        })
        void extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: progressSequence, message: text.slice(0, 500) },
        }).catch(() => undefined)
      }

      try {
        const context = await params.contextResolver.resolve({
          operationId: entry.operationId,
          requestId: extra.requestId,
          sessionId: extra.sessionId?.trim() || null,
          signal: extra.signal,
        })
        if (!context) {
          return errorResult(
            'WAO_MCP_TRUSTED_CONTEXT_REQUIRED',
            'This tool call is not bound to an active Wao turn.',
          )
        }
        return projectExecutorResult(
          await params.executor.execute({
            operationId: entry.operationId,
            input: request.params.arguments ?? {},
            context,
            signal: extra.signal,
            reportProgress,
            elicit: async (elicitation) => {
              // Keep the server request related to this tools/call request.
              // Streamable HTTP routes related requests over the active POST
              // response; Server.elicitInput has no parent request identity
              // here and therefore targets a standalone SSE stream that the
              // Codex MCP client does not keep open.
              const result = await extra.sendRequest({
                method: 'elicitation/create',
                params: {
                  ...elicitation,
                  mode: 'form',
                },
              }, ElicitResultSchema, {
                signal: extra.signal,
                timeout: WAO_MCP_ELICITATION_TIMEOUT_MS,
                maxTotalTimeout: WAO_MCP_ELICITATION_TIMEOUT_MS,
              })
              return {
                action: result.action,
                ...(isRecord(result.content)
                  ? { content: result.content }
                  : {}),
              }
            },
          }),
        )
      } catch (error) {
        extra.signal.throwIfAborted()
        const projected = normalizeOperationExecutionToolError({
          error,
          operationId: entry.operationId,
        })
        return projectExecutorResult({
          structuredContent: {
            ok: false,
            error: toJsonObject(projected),
          },
          text: projected.message,
          isError: true,
        })
      }
    },
  )

  return server
}
