import { readRequestBufferWithLimit } from '@/lib/http/body-limits'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  CodexModelGatewayError,
  type CodexModelGatewayScope,
} from './contracts'
import { resolveCodexModelGatewayUpstream } from './selection'
import { requireCodexModelGatewayActiveTurn } from './active-turn-guard'

const CODEX_MODEL_REQUEST_MAX_BYTES = 16 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateResponsesEndpoint(request: Request): void {
  const url = new URL(request.url)
  if (
    !url.pathname.endsWith('/api/internal/codex-runtime/model/responses')
    || url.search
    || url.hash
  ) {
    throw new CodexModelGatewayError('REQUEST_ENDPOINT_INVALID', 404)
  }
}

function readInstructionMessage(item: Record<string, unknown>): string | null {
  if (item.type !== 'message') return null
  if (item.role !== 'developer' && item.role !== 'system') return null
  if (!Array.isArray(item.content) || item.content.length === 0) {
    throw new CodexModelGatewayError('REQUEST_INSTRUCTIONS_INVALID', 400)
  }
  const parts = item.content.map((part) => {
    if (
      !isRecord(part)
      || part.type !== 'input_text'
      || typeof part.text !== 'string'
      || !part.text.trim()
    ) {
      throw new CodexModelGatewayError('REQUEST_INSTRUCTIONS_INVALID', 400)
    }
    return part.text
  })
  return parts.join('\n\n')
}

/**
 * Codex may append current-Turn developer context after Product View history.
 * OpenRouter's Anthropic-compatible routes translate that item to a mid-history
 * system message and reject the otherwise valid Responses request. The gateway
 * is the single provider adaptation boundary, so it lifts every instruction
 * message into the canonical top-level `instructions` field while preserving
 * all user, assistant, tool and reasoning items in their original order.
 */
export function normalizeCodexProviderRequest(body: Record<string, unknown>): void {
  const topLevel = body.instructions
  if (topLevel !== undefined && topLevel !== null && typeof topLevel !== 'string') {
    throw new CodexModelGatewayError('REQUEST_INSTRUCTIONS_INVALID', 400)
  }
  if (!Array.isArray(body.input)) return

  const instructions = typeof topLevel === 'string' && topLevel.trim()
    ? [topLevel]
    : []
  const input: unknown[] = []
  for (const item of body.input) {
    if (!isRecord(item)) {
      input.push(item)
      continue
    }
    const instruction = readInstructionMessage(item)
    if (instruction === null) input.push(item)
    else instructions.push(instruction)
  }
  body.input = input
  if (instructions.length > 0) body.instructions = instructions.join('\n\n')
}

async function readAndValidateBody(params: {
  readonly request: Request
  readonly runtimeModelId: string
  readonly upstreamModelId: string
}): Promise<Buffer> {
  const contentType = params.request.headers.get('content-type')?.toLowerCase()
    || ''
  if (!contentType.startsWith('application/json')) {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  let body: Buffer
  try {
    body = await readRequestBufferWithLimit(
      params.request,
      CODEX_MODEL_REQUEST_MAX_BYTES,
      'Codex Responses request',
    )
  } catch {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  if (!isRecord(parsed)) {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  if (parsed.model !== params.runtimeModelId) {
    throw new CodexModelGatewayError('REQUEST_MODEL_MISMATCH', 403)
  }
  normalizeCodexProviderRequest(parsed)
  parsed.model = params.upstreamModelId
  return Buffer.from(JSON.stringify(parsed), 'utf8')
}

function projectProviderResponse(response: Response): Response {
  const headers = new Headers()
  const contentType = response.headers.get('content-type')?.trim()
  const retryAfter = response.headers.get('retry-after')?.trim()
  if (contentType) headers.set('Content-Type', contentType)
  if (retryAfter) headers.set('Retry-After', retryAfter)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * One transparent Responses API POST. Usage events stay in the provider body
 * and are consumed by Codex/app-server; this bridge never creates a second
 * usage or billing writer.
 */
export async function proxyCodexResponsesRequest(params: {
  readonly request: Request
  readonly scope: {
    readonly userId: string
    readonly projectId: string
    readonly assistantId: string
    readonly nonce: string
  }
}): Promise<Response> {
  validateResponsesEndpoint(params.request)
  if (params.scope.assistantId !== CODEX_MODEL_GATEWAY_ASSISTANT_ID) {
    throw new CodexModelGatewayError('SCOPE_INVALID', 403)
  }
  const scope: CodexModelGatewayScope = {
    userId: params.scope.userId,
    projectId: params.scope.projectId,
    assistantId: CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  }
  await requireCodexModelGatewayActiveTurn(scope, params.scope.nonce)
  const upstream = await resolveCodexModelGatewayUpstream(scope)
  const body = await readAndValidateBody({
    request: params.request,
    runtimeModelId: upstream.runtimeModelId,
    upstreamModelId: upstream.modelId,
  })
  const requestedAccept = params.request.headers.get('accept')?.toLowerCase()
    || ''
  const accept = requestedAccept.includes('text/event-stream')
    ? 'text/event-stream'
    : 'application/json'

  let response: Response
  try {
    response = await fetchWithProviderProxy(upstream.responsesEndpoint, {
      method: 'POST',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${upstream.providerApiKey}`,
        'Content-Type': 'application/json',
      },
      body: new Uint8Array(body),
      redirect: 'error',
      signal: params.request.signal,
    })
  } catch {
    params.request.signal.throwIfAborted()
    throw new CodexModelGatewayError('PROVIDER_REQUEST_FAILED', 502)
  }
  return projectProviderResponse(response)
}
