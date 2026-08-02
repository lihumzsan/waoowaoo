import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  WaoMcpCallContextResolver,
  WaoMcpOperationExecutor,
  WaoMcpOperationExecutorResult,
} from './contracts'
import { createWaoMcpOperationCatalog } from './operation-catalog'

export interface CreateWaoMcpServerParams {
  readonly executor: WaoMcpOperationExecutor
  readonly contextResolver: WaoMcpCallContextResolver
  readonly name?: string
  readonly version?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
            elicit: async (elicitation) => {
              const result = await server.elicitInput(elicitation, {
                signal: extra.signal,
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
      } catch {
        extra.signal.throwIfAborted()
        return errorResult(
          'WAO_MCP_EXECUTION_FAILED',
          'The operation could not be executed.',
        )
      }
    },
  )

  return server
}
