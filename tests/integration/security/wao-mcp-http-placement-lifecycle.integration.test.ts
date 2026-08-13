import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  closeWaoMcpHttpSessionsForRuntimeScope,
  handleWaoMcpHttpRequest,
} from '@/lib/wao-mcp/http-transport'
import type { WaoRuntimeTokenPayload } from '@/lib/wao-mcp/runtime-token'

function placement(nonce = randomUUID()): WaoRuntimeTokenPayload {
  return {
    userId: `user_${randomUUID()}`,
    projectId: `project_${randomUUID()}`,
    assistantId: 'workspace-command',
    nonce,
  }
}

function initializeRequest(): Request {
  return new Request('http://localhost/api/internal/codex-runtime/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'placement-lifecycle-test', version: '1' },
      },
    }),
  })
}

async function initialize(scope: WaoRuntimeTokenPayload): Promise<{
  readonly response: Response
  readonly sessionId: string | null
}> {
  const response = await handleWaoMcpHttpRequest({ request: initializeRequest(), scope })
  const sessionId = response.headers.get('mcp-session-id')
  await response.text()
  return { response, sessionId }
}

async function readSession(
  scope: WaoRuntimeTokenPayload,
  sessionId: string,
): Promise<Response> {
  return await handleWaoMcpHttpRequest({
    scope,
    request: new Request('http://localhost/api/internal/codex-runtime/mcp', {
      method: 'GET',
      headers: {
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
    }),
  })
}

describe('Wao MCP HTTP placement lifecycle', () => {
  it('removes the protocol session when its Runtime placement closes', async () => {
    const scope = placement()
    const initialized = await initialize(scope)
    expect(initialized.response.status).toBe(200)
    expect(initialized.sessionId).toBeTruthy()

    await closeWaoMcpHttpSessionsForRuntimeScope(scope)

    const response = await readSession(scope, initialized.sessionId!)
    expect(response.status).toBe(404)
    await response.body?.cancel()
  })

  it('replaces an old generation before accepting a new placement generation', async () => {
    const oldScope = placement()
    const newScope = { ...oldScope, nonce: randomUUID() }
    const oldSession = await initialize(oldScope)
    const newSession = await initialize(newScope)
    expect(newSession.response.status).toBe(200)

    const response = await readSession(oldScope, oldSession.sessionId!)
    expect(response.status).toBe(404)
    await response.body?.cancel()
    await closeWaoMcpHttpSessionsForRuntimeScope(newScope)
  })

  it('serializes initialization across generations of the same placement', async () => {
    const firstScope = placement()
    const secondScope = { ...firstScope, nonce: randomUUID() }
    const responses = await Promise.all([
      initialize(firstScope),
      initialize(secondScope),
    ])

    expect(responses.map(({ response }) => response.status).sort()).toEqual([200, 409])
    await closeWaoMcpHttpSessionsForRuntimeScope(firstScope)
    await closeWaoMcpHttpSessionsForRuntimeScope(secondScope)
  })
})
