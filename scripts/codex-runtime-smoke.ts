import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { LocalRuntimeManager } from '@/lib/codex-runtime/local-runtime-manager'
import { PRODUCTION_CODEX_INITIALIZE_CAPABILITIES } from '@/lib/codex-runtime/runtime-config'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeJsonObject,
} from '@/lib/codex-runtime/runtime-adapter'
import { createWaoMcpServer } from '@/lib/wao-mcp/server'
import { createWaoMcpToolRegistry } from '@/lib/wao-mcp/tool-registry'
import {
  WAO_MCP_USER_DECISION_META_KEY,
  WAO_MCP_USER_DECISION_TOOL_NAME,
} from '@/lib/wao-mcp/user-decision'
import type { WaoMcpOperationExecutorResult } from '@/lib/wao-mcp/contracts'
import { AssistantRuntimePersistence } from '@/lib/assistant-runtime/runtime-persistence'
import {
  ASSISTANT_RUNTIME_CODEX_VERSION,
  ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
  ASSISTANT_RUNTIME_STATIC_CONTRACT,
} from '@/lib/assistant-runtime/runtime-access'
import {
  CREATIVE_RUNTIME_SKILLS,
} from '@/lib/creative-skills'
import {
  ASSISTANT_RUNTIME_APPROVAL_METHODS,
  ASSISTANT_RUNTIME_INPUT_METHODS,
} from '@/lib/assistant-runtime/view-contract'

const DEFAULT_MODEL = 'gpt-5.6-sol'
const TURN_TIMEOUT_MS = 180_000
const OFFLINE_STAGE_TIMEOUT_MS = 30_000

type AppServerSmokeResult = {
  readonly initializedUserAgent: string
  readonly threadId: string
  readonly resumed: boolean
  readonly failedTurnPersisted: boolean
  readonly idempotentScopeClearValidated: boolean
  readonly liveTurn: boolean
  readonly liveTurnStatus: string | null
  readonly streamedText: string
  readonly customResponsesProvider: boolean
  readonly skillsListed: readonly string[]
  readonly protocolSurfaceValidated: boolean
  readonly runtimeContractValidated: boolean
}

type RuntimeRequestCapture = {
  readonly baseUrl: string
  readonly request: Promise<RuntimeJsonObject>
  readonly close: () => Promise<void>
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

async function readHttpBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function startRuntimeRequestCapture(): Promise<RuntimeRequestCapture> {
  let resolveRequest!: (request: RuntimeJsonObject) => void
  let rejectRequest!: (error: unknown) => void
  let captured = false
  const request = new Promise<RuntimeJsonObject>((resolve, reject) => {
    resolveRequest = resolve
    rejectRequest = reject
  })
  const server = createServer((incoming, response) => {
    void (async () => {
      if (incoming.method !== 'POST' || !incoming.url?.endsWith('/responses')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"not found"}}')
        return
      }
      const bytes = await readHttpBody(incoming)
      if (!captured) {
        captured = true
        const parsed: unknown = JSON.parse(bytes.toString('utf8'))
        resolveRequest(requireObject(parsed, 'captured Responses request'))
      }
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        error: {
          message: 'Intentional runtime contract probe failure.',
          type: 'invalid_request_error',
          code: 'runtime_contract_probe',
        },
      }))
    })().catch((error: unknown) => {
      rejectRequest(error)
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end('{"error":{"message":"capture failed"}}')
    })
  })
  server.on('error', rejectRequest)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string', 'Runtime request capture address unavailable')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/api/internal/codex-runtime/model`,
    request,
    close: async () => await closeServer(server),
  }
}

function assertRuntimeContractRequest(request: RuntimeJsonObject): void {
  const serialized = JSON.stringify(request)
  assert.ok(
    serialized.includes('The native Web Search tool returns a synthesized, cited report'),
    'The live model request did not contain the current native Web Search instruction.',
  )
  assert.ok(
    !serialized.includes('Research the public web only through the wao MCP'),
    'The live model request retained the obsolete MCP-only Web Search instruction.',
  )
  assert.ok(
    serialized.includes('web__run'),
    'The live model request did not install the standalone Web Search executor.',
  )
  assert.ok(
    !serialized.includes('mcp__wao__web_search'),
    'The live model request installed the deleted Wao MCP search tool.',
  )
  assert.ok(
    ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS.includes('# Professional Wao Skills'),
    'The live model request did not load the canonical project Agent prompt.',
  )
  assert.ok(
    serialized.includes('wao.request_user_decision'),
    'The live model request did not name the Wao-owned user decision tool.',
  )
  assert.ok(
    !serialized.includes('native user-input request'),
    'The live model request retained the deleted native Choice instruction.',
  )
  for (const runtimeSkill of CREATIVE_RUNTIME_SKILLS) {
    const professionalSkillId = runtimeSkill.skillIds[1]
    assert.ok(
      serialized.includes(professionalSkillId),
      `The live model request did not expose Wao Skill ${professionalSkillId}.`,
    )
  }
  for (const toolName of ['spawn_agent', 'send_message', 'wait_agent', 'interrupt_agent']) {
    assert.ok(
      !serialized.includes(`\"${toolName}\"`),
      `The live model request exposed disabled collaboration tool ${toolName}.`,
    )
  }
}

async function withStageTimeout<T>(label: string, action: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`CODEX_RUNTIME_SMOKE_STAGE_TIMEOUT:${label}`)), OFFLINE_STAGE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
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
    'webSearch',
  ]) {
    assert.ok(notifications.includes(`\"${itemType}\"`), `Pinned Codex protocol no longer exposes ${itemType}`)
  }
  for (const terminalErrorField of [
    'willRetry',
    'codexErrorInfo',
    'responseStreamDisconnected',
    'responseTooManyFailedAttempts',
    'badRequest',
  ]) {
    assert.ok(
      notifications.includes(`\"${terminalErrorField}\"`),
      `Pinned Codex protocol no longer exposes terminal error field ${terminalErrorField}`,
    )
  }
}

async function runMcpSmoke(): Promise<void> {
  const calls: string[] = []
  let completedCalls = 0
  let sessionClosed = false
  const elicitationObserved = createSignal()
  const decisionElicitationObserved = createSignal()
  const decisionCancellationObserved = createSignal()
  let decisionElicitationCount = 0
  const approvalReleased = createSignal()
  const registry = createWaoMcpToolRegistry()
  const toolNames = registry.map((entry) => entry.name)
  const operationIds = registry.flatMap((entry) => (
    entry.kind === 'operation' ? [entry.operation.operationId] : []
  ))
  assert.ok(!operationIds.some((operationId) => operationId === 'web_search'), (
    'Wao MCP must not register a second search entry beside native Web Search.'
  ))
  assert.ok(!operationIds.includes('submit_production_manifest'), 'Deleted Manifest operation remains in Wao MCP.')
  for (const operationId of ['create_image', 'create_audio', 'create_video']) {
    assert.ok(operationIds.includes(operationId), `Direct media operation missing from Wao MCP: ${operationId}`)
  }
  assert.ok(
    toolNames.includes(WAO_MCP_USER_DECISION_TOOL_NAME),
    'Wao MCP user decision tool is missing from the exhaustive registry.',
  )
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
    if (Object.hasOwn(request.params.requestedSchema.properties, 'optionId')) {
      const option = requireObject(
        request.params.requestedSchema.properties.optionId,
        'decision option schema',
      )
      assert.equal(option.type, 'string')
      assert.ok(Array.isArray(option.oneOf))
      assert.equal(option.description, undefined)
      assert.deepEqual(request.params._meta?.[WAO_MCP_USER_DECISION_META_KEY], {
        protocol: 'wao_user_decision_presentation_v1',
        options: [
          {
            id: 'direction_a',
            description: 'Use a restrained documentary treatment.',
          },
          {
            id: 'direction_b',
            description: 'Use a cinematic narrative treatment.',
          },
        ],
      })
      decisionElicitationCount += 1
      if (decisionElicitationCount === 1) {
        decisionElicitationObserved.resolve()
        return {
          action: 'accept',
          content: { optionId: 'direction_b' },
        }
      }
      decisionCancellationObserved.resolve()
      return {
        action: 'decline',
      }
    }
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
      toolNames,
    )
    let toolCallSettled = false
    const pendingResult = client.callTool({
      name: 'create_image',
      arguments: {
        request: {
          kind: 'new',
          items: [{
            itemId: 'smoke-image',
            name: 'Smoke image',
            mediaType: 'image',
            schemaId: 'generic.image',
            assetKind: null,
            prompt: 'A minimal runtime contract smoke image.',
            count: 1,
          }],
        },
      },
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
    const userDecisionArguments = {
      header: 'Direction',
      question: 'Which direction should the project use?',
      options: [
        {
          id: 'direction_a',
          label: 'Direction A',
          description: 'Use a restrained documentary treatment.',
        },
        {
          id: 'direction_b',
          label: 'Direction B',
          description: 'Use a cinematic narrative treatment.',
        },
      ],
      otherLabel: 'Another direction',
    }
    const decisionResult = await client.callTool({
      name: WAO_MCP_USER_DECISION_TOOL_NAME,
      arguments: userDecisionArguments,
    })
    await decisionElicitationObserved.promise
    assert.equal(decisionResult.isError, undefined)
    assert.deepEqual(decisionResult.structuredContent, {
      ok: true,
      data: {
        outcome: 'selected',
        selection: {
          kind: 'option',
          optionId: 'direction_b',
          label: 'Direction B',
        },
      },
    })
    const cancellationResult = await client.callTool({
      name: WAO_MCP_USER_DECISION_TOOL_NAME,
      arguments: userDecisionArguments,
    })
    await decisionCancellationObserved.promise
    assert.equal(cancellationResult.isError, undefined)
    assert.deepEqual(cancellationResult.structuredContent, {
      ok: true,
      data: {
        outcome: 'cancelled',
        action: 'decline',
      },
    })
    assert.deepEqual(calls, ['create_image'])
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
    process.env.CODEX_RUNTIME_EXPECTED_VERSION?.trim()
      || `codex-cli ${ASSISTANT_RUNTIME_CODEX_VERSION}`,
    'Codex CLI version differs from the Stage 0 validated protocol version',
  )
  await assertPinnedProtocolSurface(params.rootDir)

  const persistence = new AssistantRuntimePersistence({
    hostRoot: path.join(params.rootDir, 'runtime-persistence'),
  })
  const persistenceScope = { userId: 'runtime-smoke-user', projectId: 'runtime-smoke-project' }
  const materialization = await persistence.materialize(persistenceScope)
  const codexHome = materialization.hostCodexHomeDirectory
  const cwd = materialization.hostWorkspaceDirectory
  const primaryInstructions = await readFile(path.join(codexHome, 'AGENTS.md'), 'utf8')
  assert.match(primaryInstructions, /developer instructions are the authoritative project policy/u)
  assert.doesNotMatch(primaryInstructions, /Subagent|child agent|delegate/iu)
  const primaryConfig = await readFile(path.join(codexHome, 'config.toml'), 'utf8')
  assert.match(primaryConfig, /\[agents\]\nenabled = false/)
  assert.ok(!primaryConfig.includes('hooks = true'))
  await assert.rejects(access(path.join(codexHome, 'agents')), { code: 'ENOENT' })
  await assert.rejects(access(path.join(codexHome, 'hooks.json')), { code: 'ENOENT' })
  await assert.rejects(access(path.join(codexHome, 'hooks')), { code: 'ENOENT' })
  const professionalSkillIds = CREATIVE_RUNTIME_SKILLS.map((skill) => skill.skillIds[1])
  for (const runtimeSkill of CREATIVE_RUNTIME_SKILLS) {
    const professionalSkillId = runtimeSkill.skillIds[1]
    const installedSkill = await readFile(
      path.join(codexHome, 'skills', professionalSkillId, 'SKILL.md'),
      'utf8',
    )
    assert.ok(installedSkill.includes(`name: ${professionalSkillId}`))
    assert.ok(installedSkill.includes(`outputKind=${JSON.stringify(runtimeSkill.outputKind)}`))
    assert.ok(installedSkill.includes('<wao_output_schema'))
    assert.ok(installedSkill.includes('<wao_skill_source id="creative-core"'))
    assert.ok(installedSkill.includes(`<wao_skill_source id="${professionalSkillId}"`))
    for (const otherSkillId of professionalSkillIds.filter((skillId) => skillId !== professionalSkillId)) {
      assert.ok(!installedSkill.includes(`<wao_skill_source id="${otherSkillId}"`), (
        `Runtime Skill ${professionalSkillId} embedded another professional domain: ${otherSkillId}`
      ))
    }
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
  const requestCapture = await startRuntimeRequestCapture()
  let restoredManager: LocalRuntimeManager | null = null
  const runtimeKey = 'stage-0-smoke'
  const toolContract = ASSISTANT_RUNTIME_STATIC_CONTRACT.tools
  const customProviderConfig = {
    web_search: toolContract.webSearch,
    features: {
      skill_search: toolContract.features.skillSearch,
      image_generation: toolContract.features.imageGeneration,
      standalone_web_search: toolContract.features.standaloneWebSearch,
      remote_compaction_v2: toolContract.features.remoteCompactionV2,
      code_mode: {
        enabled: toolContract.features.codeMode.enabled,
        direct_only_tool_namespaces: [...toolContract.features.codeMode.directOnlyToolNamespaces],
      },
      code_mode_host: {
        enabled: toolContract.features.codeModeHost.enabled,
        disable_in_process_fallback: toolContract.features.codeModeHost.disableInProcessFallback,
      },
    },
    model_providers: {
      'wao-runtime-smoke': {
        name: 'Wao Runtime Smoke Responses Provider',
        base_url: requestCapture.baseUrl,
        env_key: 'WAO_MCP_RUNTIME_BEARER_TOKEN',
        wire_api: toolContract.modelProvider.wireApi,
        requires_openai_auth: toolContract.modelProvider.requiresOpenAiAuth,
        supports_standalone_web_search: toolContract.modelProvider.supportsStandaloneWebSearch,
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
    const enabledSkillNames = (listedSkills.data[0]?.skills ?? [])
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name)
      .sort()
    assert.deepEqual(enabledSkillNames, [...professionalSkillIds].sort())
    const probeThread = await firstRuntime.startThread({
      model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || DEFAULT_MODEL,
      modelProvider: 'wao-runtime-smoke',
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: customProviderConfig,
      developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
      ephemeral: true,
    })
    const probeCompletion = waitForTurnCompletion({
      runtime: firstRuntime,
      threadId: probeThread.id,
      onDelta: () => undefined,
    })
    const probeTurn = await firstRuntime.startTurn({
      threadId: probeThread.id,
      input: [{ type: 'text', text: 'Probe the installed runtime contract.' }],
      cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    })
    const [capturedRequest, completedProbeTurn] = await Promise.all([
      requestCapture.request,
      probeCompletion,
    ])
    assert.equal(completedProbeTurn.id, probeTurn.id)
    assert.notEqual(completedProbeTurn.status, 'completed')
    assertRuntimeContractRequest(capturedRequest)

    const thread = await firstRuntime.startThread({
      model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || DEFAULT_MODEL,
      modelProvider: 'wao-runtime-smoke',
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: customProviderConfig,
      developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
      ephemeral: false,
    })
    assert.equal((await firstRuntime.readThread({ threadId: thread.id })).id, thread.id)

    const persistenceMarker = params.liveTurn
      ? 'Reply with exactly RUNTIME_SMOKE_OK.'
      : 'FAILED_TURN_PERSISTENCE_MARKER'
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
      const completed = waitForTurnCompletion({
        runtime: firstRuntime,
        threadId: thread.id,
        onDelta: () => undefined,
      })
      const failedTurn = await firstRuntime.startTurn({
        threadId: thread.id,
        input: [{ type: 'text', text: persistenceMarker }],
        cwd,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      })
      const completedTurn = await completed
      assert.equal(completedTurn.id, failedTurn.id)
      liveTurnStatus = typeof completedTurn.status === 'string' ? completedTurn.status : null
      assert.notEqual(liveTurnStatus, 'completed')
    }

    const beforeCrash = await firstRuntime.readThread({ threadId: thread.id, includeTurns: true })
    assert.ok(JSON.stringify(beforeCrash.raw).includes(persistenceMarker))

    // SIGKILL the app-server and reuse the exact same Codex home. No Wao
    // checkpoint, bundle restore, or product-message injection participates.
    await manager.forceShutdown(runtimeKey)
    restoredManager = createManager(codexHome)
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
    const afterCrash = await secondRuntime.readThread({ threadId: thread.id, includeTurns: true })
    assert.equal(afterCrash.id, thread.id)
    assert.ok(JSON.stringify(afterCrash.raw).includes(persistenceMarker))
    const restoredSkills = await secondRuntime.listSkills({ cwds: [cwd], forceReload: true })
    const restoredEnabledSkillNames = (restoredSkills.data[0]?.skills ?? [])
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name)
      .sort()
    assert.deepEqual(restoredEnabledSkillNames, [...professionalSkillIds].sort())
    await restoredManager.shutdown(runtimeKey)
    await persistence.destroyMaterialization(materialization)
    await persistence.clearScope(persistenceScope)
    await persistence.clearScope(persistenceScope)
    await assert.rejects(access(codexHome), { code: 'ENOENT' })

    return {
      initializedUserAgent: initialized.userAgent,
      threadId: thread.id,
      resumed: true,
      failedTurnPersisted: !params.liveTurn,
      idempotentScopeClearValidated: true,
      liveTurn: params.liveTurn,
      liveTurnStatus,
      streamedText,
      customResponsesProvider: true,
      skillsListed: listedSkills.data[0]?.skills
        .filter((skill) => skill.enabled)
        .map((skill) => `${skill.name}@${skill.path}`) ?? [],
      protocolSurfaceValidated: true,
      runtimeContractValidated: true,
    }
  } finally {
    await Promise.allSettled([
      manager.shutdownAll(),
      restoredManager?.shutdownAll() ?? Promise.resolve(),
      requestCapture.close(),
    ])
  }
}

async function main(): Promise<void> {
  const liveTurn = process.argv.includes('--live-turn')
  const rootDir = await mkdtemp(path.join(tmpdir(), 'wao-codex-runtime-smoke-'))
  try {
    await withStageTimeout('mcp', async () => await runMcpSmoke())
    const appServer = await withStageTimeout(
      'app-server',
      async () => await runAppServerSmoke({ rootDir, liveTurn }),
    )
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mcp: createWaoMcpToolRegistry().map((entry) => entry.name),
      appServer,
    }, null, 2)}\n`)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}

const smokeKeepAlive = setInterval(() => undefined, 1_000)
void main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
  .finally(() => clearInterval(smokeKeepAlive))
