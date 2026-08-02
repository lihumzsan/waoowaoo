import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { JsonObject } from '@/lib/operations/types'
import {
  createWaoMcpOperationCatalog,
  type WaoMcpStage0OperationId,
} from './operation-catalog'

export interface WaoMcpOperationExecutorResult {
  /** Executor-owned, model-safe result. Never return credentials or raw keys. */
  readonly structuredContent: JsonObject
  /** Concise model-visible summary of the same structured result. */
  readonly text: string
  readonly isError?: boolean
}

export interface WaoMcpOperationExecutor {
  execute(params: {
    readonly operationId: WaoMcpStage0OperationId
    readonly input: Readonly<Record<string, unknown>>
  }): Promise<WaoMcpOperationExecutorResult>
}

export interface CreateWaoMcpServerParams {
  readonly executor: WaoMcpOperationExecutor
  readonly name?: string
  readonly version?: string
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
 * Creates the transport-independent Stage 0 MCP protocol server. The injected
 * executor owns authentication, canonical Operation validation, approvals and
 * execution. This layer only advertises registry-derived tools and forwards
 * calls; it never reads or writes DB, Task, billing, or provider state.
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
        'Wao Stage 0 creative production tools. Tool schemas and descriptions come from the canonical Operation registry.',
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
    async (request): Promise<CallToolResult> => {
      const entry = entryByName.get(request.params.name as WaoMcpStage0OperationId)
      if (!entry) {
        return errorResult(
          'WAO_MCP_OPERATION_NOT_ALLOWED',
          'This operation is not available through the Stage 0 Wao MCP server.',
        )
      }

      try {
        return projectExecutorResult(
          await params.executor.execute({
            operationId: entry.operationId,
            input: request.params.arguments ?? {},
          }),
        )
      } catch {
        return errorResult(
          'WAO_MCP_EXECUTION_FAILED',
          'The operation could not be executed.',
        )
      }
    },
  )

  return server
}
