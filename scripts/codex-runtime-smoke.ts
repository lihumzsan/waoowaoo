import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  captureWorkspaceBundle,
  encodeWorkspaceBundle,
  materializeWorkspaceBundle,
  type WorkspaceBundleV1,
} from '@/lib/codex-runtime/workspace-bundle'
import { LocalRuntimeManager } from '@/lib/codex-runtime/local-runtime-manager'
import { PRODUCTION_CODEX_INITIALIZE_CAPABILITIES } from '@/lib/codex-runtime/runtime-config'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeJsonObject,
} from '@/lib/codex-runtime/runtime-adapter'
import { createWaoMcpOperationCatalog } from '@/lib/wao-mcp/operation-catalog'
import { createWaoMcpServer } from '@/lib/wao-mcp/server'
import type { WaoMcpOperationExecutorResult } from '@/lib/wao-mcp/contracts'
import { inspectCapturedCodexState } from '@/lib/assistant-runtime/runtime-persistence'
import {
  CREATIVE_SKILLS,
  readCreativeSkillResource,
} from '@/lib/creative-skills'
import {
  ASSISTANT_RUNTIME_APPROVAL_METHODS,
  ASSISTANT_RUNTIME_INPUT_METHODS,
} from '@/lib/assistant-runtime/view-contract'

const VALIDATED_CODEX_VERSION = 'codex-cli 0.146.0'
const DEFAULT_MODEL = 'gpt-5.6-sol'
const TURN_TIMEOUT_MS = 180_000

type AppServerSmokeResult = {
  readonly initializedUserAgent: string
  readonly threadId: string
  readonly resumed: boolean
  readonly liveTurn: boolean
  readonly liveTurnStatus: string | null
  readonly streamedText: string
  readonly capturedStateBytes: number
  readonly customResponsesProvider: boolean
  readonly skillsListed: readonly string[]
  readonly protocolSurfaceValidated: boolean
}

function requireObject(value: unknown, label: string): RuntimeJsonObject {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value as RuntimeJsonObject
}

function createSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolver: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    resolver = () => resolve()
  })
  return {
    promise,
    resolve: () => {
      if (!resolver) throw new Error('CODEX_RUNTIME_SMOKE_SIGNAL_UNINITIALIZED')
      resolver()
    },
  }
}

async function assertPinnedProtocolSurface(rootDir: string): Promise<void> {
  const schemaDirectory = path.join(rootDir, 'protocol-schema')
  execFileSync('codex', [
    'app-server',
    'generate-json-schema',
    '--experimental',
    '--out',
    schemaDirectory,
  ], { encoding: 'utf8' })
  const [requests, notifications] = await Promise.all([
    readFile(path.join(schemaDirectory, 'ServerRequest.json'), 'utf8'),
    readFile(path.join(schemaDirectory, 'ServerNotification.json'), 'utf8'),
  ])
  for (const method of [
    ...ASSISTANT_RUNTIME_APPROVAL_METHODS,
    ...ASSISTANT_RUNTIME_INPUT_METHODS,
  ]) {
    assert.ok(requests.includes(`\"${method}\"`), `Pinned Codex protocol no longer exposes ${method}`)
  }
  for (const method of [
    'skills/changed',
    'thread/goal/updated',
    'thread/goal/cleared',
    'turn/plan/updated',
    'item/commandExecution/outputDelta',
    'item/fileChange/outputDelta',
    'item/fileChange/patchUpdated',
    'item/mcpToolCall/progress',
    'turn/diff/updated',
    'thread/compacted',
  ]) {
    assert.ok(notifications.includes(`\"${method}\"`), `Pinned Codex protocol no longer exposes ${method}`)
  }
  for (const itemType of [
    'commandExecution',
    'fileChange',
    'mcpToolCall',
    'collabAgentToolCall',
    'subAgentActivity',
    'webSearch',
  ]) {
    assert.ok(notifications.includes(`\"${itemType}\"`), `Pinned Codex protocol no longer exposes ${itemType}`)
  }
}

async function runWorkspaceSmoke(rootDir: string): Promise<void> {
  const workspaceDir = path.join(rootDir, 'workspace')
  const bundle: WorkspaceBundleV1 = {
    schemaVersion: 1,
    directories: ['project', 'project/empty'],
    files: [
      {
        path: 'project/brief.md',
        content: '# Runtime smoke\n\nThe Canvas is a projection of this project workspace.\n',
      },
      {
        path: 'project/resources.json',
        content: '{"resources":[]}',
      },
    ],
  }

  await materializeWorkspaceBundle(workspaceDir, bundle)
  const captured = await captureWorkspaceBundle(workspaceDir)
  assert.deepEqual(encodeWorkspaceBundle(captured), encodeWorkspaceBundle(bundle))
}

async function runMcpSmoke(): Promise<void> {
  const calls: string[] = []
  let completedCalls = 0
  let sessionClosed = false
  const elicitationObserved = createSignal()
  const approvalReleased = createSignal()
  const operationIds = createWaoMcpOperationCatalog().map((entry) => entry.operationId)
  const server = createWaoMcpServer({
    contextResolver: {
      resolve: async ({ requestId }) => ({
        threadId: 'smoke-thread',
        turnId: 'smoke-turn',
        callId: `smoke-call-${String(requestId)}`,
        requestId: 'smoke-request',
        executionOwnerId: 'smoke-owner',
        userId: 'smoke-user',
        projectId: 'smoke-project',
        source: 'codex_runtime_smoke',
      }),
    },
    executor: {
      execute: async ({ operationId, elicit }): Promise<WaoMcpOperationExecutorResult> => {
        calls.push(operationId)
        const decision = await elicit({
          mode: 'form',
          message: 'Approve this immutable smoke plan.',
          requestedSchema: {
            type: 'object',
            properties: {
              confirmed: { type: 'boolean', title: 'Approve' },
            },
            required: ['confirmed'],
          },
        })
        if (
          decision.action !== 'accept'
          || decision.content?.confirmed !== true
        ) {
          return {
            text: 'approval_required',
            structuredContent: {
              ok: false,
              confirmationRequired: true,
            },
            isError: true,
          }
        }
        completedCalls += 1
        return {
          text: `accepted:${operationId}`,
          structuredContent: {
            ok: true,
            operationId,
            mode: 'stage_0_no_effect',
          },
        }
      },
    },
  })
  const serverTransport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: false,
    onsessionclosed: () => {
      sessionClosed = true
    },
  })
  const fetchMcp: typeof fetch = async (input, init) => {
    return await serverTransport.handleRequest(new Request(input, init))
  }
  const clientTransport = new StreamableHTTPClientTransport(
    new URL('http://wao-runtime-smoke.invalid/mcp'),
    { fetch: fetchMcp },
  )
  const client = new Client(
    { name: 'wao-runtime-smoke', version: '0.1.0' },
    { capabilities: { elicitation: { form: {} } } },
  )
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    assert.equal(request.params.mode, 'form')
    assert.equal(request.params.requestedSchema.type, 'object')
    elicitationObserved.resolve()
    await approvalReleased.promise
    return {
      action: 'accept',
      content: { confirmed: true },
    }
  })

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    assert.ok(clientTransport.sessionId)
    const listed = await client.listTools()
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      operationIds,
    )
    let toolCallSettled = false
    const pendingResult = client.callTool({
      name: 'create_image',
      arguments: {},
    }).finally(() => {
      toolCallSettled = true
    })
    await elicitationObserved.promise
    assert.equal(completedCalls, 0)
    assert.equal(toolCallSettled, false)
    approvalReleased.resolve()
    const result = await pendingResult
    assert.equal(result.isError, undefined)
    assert.deepEqual(calls, ['create_image'])
    assert.equal(completedCalls, 1)
    await clientTransport.terminateSession()
    assert.equal(sessionClosed, true)
  } finally {
    await Promise.allSettled([client.close(), server.close()])
  }
}

function waitForTurnCompletion(params: {
  runtime: RuntimeAdapter
  threadId: string
  onDelta: (delta: string) => void
}): Promise<RuntimeJsonObject> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('CODEX_RUNTIME_SMOKE_TURN_TIMEOUT'))
    }, TURN_TIMEOUT_MS)
    const finish = (callback: () => void): void => {
      clearTimeout(timeout)
      unsubscribe()
      callback()
    }
    const unsubscribe = params.runtime.subscribe((event: RuntimeEvent) => {
      if (event.type === 'protocolError' || event.type === 'processExited') {
        finish(() => reject(new Error(`CODEX_RUNTIME_SMOKE_EVENT:${event.type}`)))
        return
      }
      if (event.type === 'serverRequest') {
        void params.runtime.respondToServerRequest({
          id: event.request.id,
          error: {
            code: -32601,
            message: 'The Stage 0 smoke run does not approve interactive server requests.',
          },
        })
        return
      }
      if (event.type !== 'notification') return
      if (event.method === 'item/agentMessage/delta') {
        const eventParams = requireObject(event.params, 'agent message delta')
        if (eventParams.threadId === params.threadId && typeof eventParams.delta === 'string') {
          params.onDelta(eventParams.delta)
        }
        return
      }
      if (event.method !== 'turn/completed') return
      const eventParams = requireObject(event.params, 'turn completion')
      if (eventParams.threadId !== params.threadId) return
      finish(() => resolve(requireObject(eventParams.turn, 'completed turn')))
    })
  })
}

async function runAppServerSmoke(params: {
  rootDir: string
  liveTurn: boolean
}): Promise<AppServerSmokeResult> {
  const actualVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim()
  assert.equal(
    actualVersion,
    process.env.CODEX_RUNTIME_EXPECTED_VERSION?.trim() || VALIDATED_CODEX_VERSION,
    'Codex CLI version differs from the Stage 0 validated protocol version',
  )
  await assertPinnedProtocolSurface(params.rootDir)

  const codexHome = path.join(params.rootDir, 'codex-home')
  await mkdir(codexHome, { recursive: true, mode: 0o700 })
  for (const definition of CREATIVE_SKILLS) {
    const resource = await readCreativeSkillResource({ uri: definition.entryUri })
    const skillDirectory = path.join(codexHome, 'skills', definition.id)
    await mkdir(skillDirectory, { recursive: true, mode: 0o700 })
    await writeFile(
      path.join(skillDirectory, 'SKILL.md'),
      resource.content,
      { encoding: 'utf8', mode: 0o600 },
    )
  }
  const createManager = (home: string) => new LocalRuntimeManager({
    clientInfo: {
      name: 'wao-runtime-smoke',
      title: 'Wao Codex Runtime Smoke',
      version: '0.1.0',
    },
    env: {
      ...process.env,
      CODEX_HOME: home,
      HOME: home,
      WAO_MCP_RUNTIME_BEARER_TOKEN: 'runtime-smoke-token',
    },
    initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
  })
  const manager = createManager(codexHome)
  let restoredManager: LocalRuntimeManager | null = null
  const runtimeKey = 'stage-0-smoke'
  const cwd = path.join(params.rootDir, 'workspace')
  const customProviderConfig = {
    web_search: 'live',
    features: {
      standalone_web_search: true,
      code_mode: {
        enabled: true,
        direct_only_tool_namespaces: ['wao'],
      },
      code_mode_host: {
        enabled: true,
        disable_in_process_fallback: true,
      },
    },
    model_providers: {
      'wao-runtime-smoke': {
        name: 'Wao Runtime Smoke Responses Provider',
        base_url: 'http://127.0.0.1:9/api/internal/codex-runtime/model',
        env_key: 'WAO_MCP_RUNTIME_BEARER_TOKEN',
        wire_api: 'responses',
        requires_openai_auth: false,
        supports_standalone_web_search: true,
        request_max_retries: 0,
        stream_max_retries: 0,
      },
    },
  }
  let streamedText = ''
  let liveTurnStatus: string | null = null

  try {
    const firstRuntime = await manager.ensure({ runtimeKey, cwd })
    const initialized = await firstRuntime.initialize()
    const listedSkills = await firstRuntime.listSkills({
      cwds: [cwd],
      forceReload: true,
    })
    assert.equal(listedSkills.data.length, 1)
    assert.equal(listedSkills.data[0]?.cwd, cwd)
    assert.deepEqual(listedSkills.data[0]?.errors, [])
    for (const definition of CREATIVE_SKILLS) {
      assert.ok(listedSkills.data[0]?.skills.some((skill) => (
        skill.name === definition.id
        && skill.enabled
        && skill.scope === 'user'
      )), `Production Skill was not loaded by Codex: ${definition.id}`)
    }
    const thread = await firstRuntime.startThread({
      model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || DEFAULT_MODEL,
      modelProvider: 'wao-runtime-smoke',
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: customProviderConfig,
      developerInstructions: 'Reply in the locale used by the user. Do not modify files in this smoke run.',
      ephemeral: false,
    })
    assert.equal((await firstRuntime.readThread({ threadId: thread.id })).id, thread.id)

    if (params.liveTurn) {
      const completed = waitForTurnCompletion({
        runtime: firstRuntime,
        threadId: thread.id,
        onDelta: (delta) => {
          streamedText += delta
        },
      })
      const turn = await firstRuntime.startTurn({
        threadId: thread.id,
        input: [{ type: 'text', text: 'Reply with exactly RUNTIME_SMOKE_OK.' }],
        cwd,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      })
      const completedTurn = await completed
      assert.equal(completedTurn.id, turn.id)
      liveTurnStatus = typeof completedTurn.status === 'string' ? completedTurn.status : null
      assert.equal(liveTurnStatus, 'completed')
      assert.equal(streamedText.trim(), 'RUNTIME_SMOKE_OK')
    } else {
      // Force a durable rollout without contacting the model gateway. This is
      // the same stable Responses item shape used by legacy message injection.
      await firstRuntime.injectThreadItems({
        threadId: thread.id,
        items: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Runtime persistence smoke.' }],
        }, {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Product View recovery smoke.' }],
        }],
      })
    }

    const capturedStateBytes = await inspectCapturedCodexState(
      codexHome,
    )
    assert.ok(capturedStateBytes > 30)

    await manager.shutdown(runtimeKey)
    const restoredCodexHome = path.join(params.rootDir, 'restored-codex-home')
    await mkdir(restoredCodexHome, { recursive: true, mode: 0o700 })
    for (const directory of ['sessions', 'archived_sessions']) {
      await cp(
        path.join(codexHome, directory),
        path.join(restoredCodexHome, directory),
        { recursive: true, force: false, errorOnExist: true },
      ).catch((error: unknown) => {
        if (
          typeof error === 'object'
          && error !== null
          && 'code' in error
          && error.code === 'ENOENT'
        ) return
        throw error
      })
    }
    restoredManager = createManager(restoredCodexHome)
    const secondRuntime = await restoredManager.ensure({ runtimeKey, cwd })
    const resumed = await secondRuntime.resumeThread({
      threadId: thread.id,
      model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || DEFAULT_MODEL,
      modelProvider: 'wao-runtime-smoke',
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: customProviderConfig,
    })
    assert.equal(resumed.id, thread.id)
    assert.equal((await secondRuntime.readThread({ threadId: thread.id })).id, thread.id)

    return {
      initializedUserAgent: initialized.userAgent,
      threadId: thread.id,
      resumed: true,
      liveTurn: params.liveTurn,
      liveTurnStatus,
      streamedText,
      capturedStateBytes,
      customResponsesProvider: true,
      skillsListed: listedSkills.data[0]?.skills.map((skill) => skill.name) ?? [],
      protocolSurfaceValidated: true,
    }
  } finally {
    await Promise.allSettled([
      manager.shutdownAll(),
      restoredManager?.shutdownAll() ?? Promise.resolve(),
    ])
  }
}

async function main(): Promise<void> {
  const liveTurn = process.argv.includes('--live-turn')
  const rootDir = await mkdtemp(path.join(tmpdir(), 'wao-codex-runtime-smoke-'))
  try {
    await runWorkspaceSmoke(rootDir)
    await runMcpSmoke()
    const appServer = await runAppServerSmoke({ rootDir, liveTurn })
    process.stdout.write(`${JSON.stringify({
      ok: true,
      workspace: 'canonical_round_trip',
      mcp: createWaoMcpOperationCatalog().map((entry) => entry.operationId),
      appServer,
    }, null, 2)}\n`)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
