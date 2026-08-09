import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { projectCodexProviderResponse } from '@/lib/codex-model-gateway/error-projection'
import { LocalRuntimeManager } from '@/lib/codex-runtime/local-runtime-manager'
import { PRODUCTION_CODEX_INITIALIZE_CAPABILITIES } from '@/lib/codex-runtime/runtime-config'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeJsonObject,
  RuntimeJsonValue,
} from '@/lib/codex-runtime/runtime-adapter'
import { ASSISTANT_RUNTIME_CODEX_VERSION } from '@/lib/assistant-runtime/runtime-access'

const TURN_TIMEOUT_MS = 30_000
const PROVIDER_ID = 'wao-gateway-error-smoke'

type ProviderFailureCase = {
  readonly name: string
  readonly status: number
  readonly error: {
    readonly type: string
    readonly code: string
  }
  readonly errorType?: string
  readonly expected: RuntimeJsonValue
}

const CASES: readonly ProviderFailureCase[] = [
  {
    name: 'billing',
    status: 402,
    error: { type: 'payment_required', code: 'insufficient_credits' },
    expected: 'usageLimitExceeded',
  },
  {
    name: 'configuration',
    status: 401,
    error: { type: 'authentication_error', code: 'invalid_api_key' },
    expected: 'serverOverloaded',
  },
  {
    name: 'request',
    status: 422,
    error: { type: 'invalid_request_error', code: 'invalid_request' },
    expected: 'other',
  },
  {
    name: 'rate-limit',
    status: 429,
    error: { type: 'rate_limit_error', code: 'rate_limit_exceeded' },
    expected: {
      responseTooManyFailedAttempts: { httpStatusCode: 429 },
    },
  },
  {
    name: 'outage',
    status: 503,
    error: { type: 'server_error', code: 'provider_down' },
    expected: 'serverOverloaded',
  },
  {
    name: 'internal',
    status: 500,
    error: { type: 'server_error', code: 'provider_internal_error' },
    expected: 'serverOverloaded',
  },
  {
    name: 'policy',
    status: 400,
    error: { type: 'invalid_request_error', code: 'content_policy_violation' },
    expected: 'cyberPolicy',
  },
  {
    name: 'context',
    status: 400,
    error: { type: 'invalid_request_error', code: 'invalid_prompt' },
    errorType: 'context_length_exceeded',
    expected: 'contextWindowExceeded',
  },
]

function requireObject(value: unknown, label: string): RuntimeJsonObject {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value as RuntimeJsonObject
}

async function drainRequest(request: IncomingMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    request.on('data', () => undefined)
    request.once('end', resolve)
    request.once('error', reject)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function startGatewayServer(): Promise<{
  readonly baseUrl: string
  readonly select: (failure: ProviderFailureCase) => void
  readonly close: () => Promise<void>
}> {
  let selected: ProviderFailureCase | null = null
  const server = createServer((request, response) => {
    void (async () => {
      await drainRequest(request)
      if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end('{"error":{"message":"not found"}}')
        return
      }
      assert(selected, 'Gateway smoke failure case was not selected')
      const providerResponse = Response.json({
        error: { ...selected.error, message: 'provider-private-message' },
        ...(selected.errorType ? { error_type: selected.errorType } : {}),
      }, {
        status: selected.status,
        headers: {
          'Retry-After': selected.status === 429 ? '1' : '0',
          'X-Request-Id': `smoke-${selected.name}`,
        },
      })
      const projected = await projectCodexProviderResponse(providerResponse)
      const body = Buffer.from(await projected.response.arrayBuffer())
      response.writeHead(
        projected.response.status,
        Object.fromEntries(projected.response.headers.entries()),
      )
      response.end(body)
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end('{"error":{"message":"smoke gateway failed"}}')
      server.emit('smokeError', error)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string', 'Gateway smoke address unavailable')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    select: (failure) => {
      selected = failure
    },
    close: async () => await closeServer(server),
  }
}

function waitForTurnCompletion(
  runtime: RuntimeAdapter,
  threadId: string,
): Promise<RuntimeJsonObject> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('CODEX_GATEWAY_ERROR_SMOKE_TIMEOUT'))
    }, TURN_TIMEOUT_MS)
    const finish = (callback: () => void): void => {
      clearTimeout(timeout)
      unsubscribe()
      callback()
    }
    const unsubscribe = runtime.subscribe((event: RuntimeEvent) => {
      if (event.type === 'protocolError' || event.type === 'processExited') {
        finish(() => reject(new Error(`CODEX_GATEWAY_ERROR_SMOKE_EVENT:${event.type}`)))
        return
      }
      if (event.type !== 'notification' || event.method !== 'turn/completed') return
      const params = requireObject(event.params, 'turn completion params')
      if (params.threadId !== threadId) return
      finish(() => resolve(requireObject(params.turn, 'completed turn')))
    })
  })
}

async function main(): Promise<void> {
  const actualVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim()
  assert.equal(actualVersion, `codex-cli ${ASSISTANT_RUNTIME_CODEX_VERSION}`)

  const root = await mkdtemp(path.join(tmpdir(), 'wao-codex-gateway-error-smoke-'))
  const codexHome = path.join(root, 'codex-home')
  const workspace = path.join(root, 'workspace')
  await Promise.all([
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
    mkdir(workspace, { recursive: true, mode: 0o700 }),
  ])
  const gateway = await startGatewayServer()
  const manager = new LocalRuntimeManager({
    clientInfo: {
      name: 'wao-gateway-error-smoke',
      title: 'Wao Gateway Error Smoke',
      version: '0.1.0',
    },
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      HOME: codexHome,
      WAO_GATEWAY_ERROR_SMOKE_TOKEN: 'smoke-token',
    },
    initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
  })

  try {
    const runtime = await manager.ensure({
      runtimeKey: 'gateway-error-smoke',
      cwd: workspace,
    })
    const config = {
      model_providers: {
        [PROVIDER_ID]: {
          name: 'Wao Gateway Error Smoke Provider',
          base_url: gateway.baseUrl,
          env_key: 'WAO_GATEWAY_ERROR_SMOKE_TOKEN',
          wire_api: 'responses',
          requires_openai_auth: false,
          request_max_retries: 0,
          stream_max_retries: 0,
        },
      },
    }
    for (const failure of CASES) {
      gateway.select(failure)
      const thread = await runtime.startThread({
        model: 'gateway-error-smoke-model',
        modelProvider: PROVIDER_ID,
        cwd: workspace,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config,
        developerInstructions: 'This is an offline Provider error protocol smoke.',
        ephemeral: true,
      })
      const completed = waitForTurnCompletion(runtime, thread.id)
      await runtime.startTurn({
        threadId: thread.id,
        input: [{ type: 'text', text: 'Trigger the configured offline Provider response.' }],
        cwd: workspace,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      })
      const turn = await completed
      assert.equal(turn.status, 'failed')
      const error = requireObject(turn.error, `${failure.name} turn error`)
      assert.deepEqual(
        error.codexErrorInfo,
        failure.expected,
        `${failure.name}:${JSON.stringify(error)}`,
      )
    }
    process.stdout.write(`${JSON.stringify({
      codex: actualVersion,
      cases: CASES.map((failure) => failure.name),
      result: 'ok',
    })}\n`)
  } finally {
    await Promise.allSettled([manager.shutdownAll(), gateway.close()])
    await rm(root, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
