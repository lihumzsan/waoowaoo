import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { LocalRuntimeManager } from '@/lib/codex-runtime/local-runtime-manager'
import {
  PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
  readCodexRuntimeConfig,
} from '@/lib/codex-runtime/runtime-config'
import { resolveCodexExecutablePath } from '@/lib/ai-providers/codex/client'
import { CODEX_DEFAULT_MODEL_ID } from '@/lib/ai-providers/codex/constants'
import { assertOnlyKeys, CodexAppServerProtocolError } from '@/lib/codex-runtime/app-server-client'
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
  readonly skillsListed: readonly string[]
  readonly protocolSurfaceValidated: boolean
  readonly runtimeContractValidated: boolean
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

async function listRelativeNames(root: string): Promise<readonly string[]> {
  const names: string[] = []
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name
      names.push(relative)
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(path.join(directory, entry.name), relative)
      }
    }
  }
  await visit(root, '')
  return names.sort()
}

async function withStageTimeout<T>(
  label: string,
  action: () => Promise<T>,
  timeoutMs = OFFLINE_STAGE_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`CODEX_RUNTIME_SMOKE_STAGE_TIMEOUT:${label}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function assertPinnedProtocolSurface(rootDir: string): Promise<void> {
  const schemaDirectory = path.join(rootDir, 'protocol-schema')
  execFileSync(resolveCodexExecutablePath(), [
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

function buildNativeRuntimeConfig(): RuntimeJsonObject {
  const tools = ASSISTANT_RUNTIME_STATIC_CONTRACT.tools
  return {
    web_search: tools.webSearch,
    model_provider: tools.modelProvider.id,
    model_providers: {
      [tools.modelProvider.id]: {
        name: tools.modelProvider.name,
        requires_openai_auth: tools.modelProvider.requiresOpenAiAuth,
        supports_websockets: tools.modelProvider.supportsWebsockets,
        supports_standalone_web_search: tools.modelProvider.supportsStandaloneWebSearch,
      },
    },
    features: {
      skill_search: tools.features.skillSearch,
      image_generation: tools.features.imageGeneration,
      standalone_web_search: tools.features.standaloneWebSearch,
      code_mode: {
        enabled: tools.features.codeMode.enabled,
        direct_only_tool_namespaces: [...tools.features.codeMode.directOnlyToolNamespaces],
      },
      code_mode_host: {
        enabled: tools.features.codeModeHost.enabled,
        disable_in_process_fallback: tools.features.codeModeHost.disableInProcessFallback,
      },
    },
    // The native smoke intentionally does not start Wao's HTTP endpoint. The
    // MCP registry and auth boundary are verified by runMcpSmoke separately.
    mcp_servers: {},
  }
}

async function runAppServerSmoke(params: {
  rootDir: string
  liveTurn: boolean
}): Promise<AppServerSmokeResult> {
  const staticToolContract = ASSISTANT_RUNTIME_STATIC_CONTRACT.tools
  assert.equal(
    staticToolContract.features.standaloneWebSearch,
    false,
    'Native Codex owns standalone web search; Wao must not install a model gateway search bridge.',
  )
  assert.deepEqual(staticToolContract.modelProvider, {
    id: 'wao-openai-local-compaction',
    name: 'Wao OpenAI',
    requiresOpenAiAuth: true,
    supportsWebsockets: true,
    supportsStandaloneWebSearch: true,
  })
  assert.equal(staticToolContract.waoMcp.required, true)
  assert.throws(
    () => assertOnlyKeys({ unexpected: true }, [], 'SMOKE_UNEXPECTED_FIELD'),
    CodexAppServerProtocolError,
  )
  const dockerConfig = readCodexRuntimeConfig({
    ...process.env,
    NODE_ENV: 'development',
    CODEX_RUNTIME_DRIVER: 'docker',
    CODEX_RUNTIME_HOST_ROOT: path.join(params.rootDir, 'docker-persistence'),
    CODEX_RUNTIME_IDLE_TIMEOUT_MS: '10000',
    CODEX_RUNTIME_IMAGE: 'waoowaoo-codex-runtime:smoke',
    CODEX_RUNTIME_NETWORK: 'waoowaoo-codex-runtime-smoke',
    CODEX_RUNTIME_CPU_LIMIT: '1',
    CODEX_RUNTIME_MEMORY_BYTES: '268435456',
    CODEX_RUNTIME_PIDS_LIMIT: '32',
    OPENAI_API_KEY: 'smoke-placeholder',
  })
  assert.equal(dockerConfig.driver, 'docker')
  const persistence = new AssistantRuntimePersistence({
    hostRoot: path.join(params.rootDir, 'runtime-persistence'),
    scopedCodexHome: false,
  })
  const sharedHome = path.join(params.rootDir, 'shared-codex-home')
  await mkdir(sharedHome, { recursive: true, mode: 0o700 })
  const sharedHomeSentinel = path.join(sharedHome, 'sentinel.txt')
  await writeFile(sharedHomeSentinel, 'preserve me\n')
  const sharedHomeBefore = await listRelativeNames(sharedHome)
  const persistenceScope = { userId: 'runtime-smoke-user', projectId: 'runtime-smoke-project' }
  const materialization = await persistence.materialize(persistenceScope)
  assert.equal(
    'hostCodexHomeDirectory' in materialization,
    false,
    'Runtime materialization must never allocate a per-scope Codex Home.',
  )
  assert.deepEqual(await listRelativeNames(sharedHome), sharedHomeBefore)
  await assert.rejects(access(path.join(params.rootDir, 'runtime-persistence', 'codex-homes')), { code: 'ENOENT' })
  const actualVersion = execFileSync(resolveCodexExecutablePath(), ['--version'], { encoding: 'utf8' }).trim()
  assert.equal(
    actualVersion,
    process.env.CODEX_RUNTIME_EXPECTED_VERSION?.trim()
      || `codex-cli ${ASSISTANT_RUNTIME_CODEX_VERSION}`,
    'Codex CLI version differs from the Stage 0 validated protocol version',
  )
  await assertPinnedProtocolSurface(params.rootDir)
  const cwd = materialization.hostWorkspaceDirectory
  const professionalSkillIds = CREATIVE_RUNTIME_SKILLS.map((skill) => skill.skillIds[1])
  for (const runtimeSkill of CREATIVE_RUNTIME_SKILLS) {
    const professionalSkillId = runtimeSkill.skillIds[1]
    const installedSkill = await readFile(
      path.join(cwd, '.agents', 'skills', professionalSkillId, 'SKILL.md'),
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
  const createManager = () => new LocalRuntimeManager({
    clientInfo: {
      name: 'wao-runtime-smoke',
      title: 'Wao Codex Runtime Smoke',
      version: '0.1.0',
    },
    env: {
      ...process.env,
      WAO_MCP_RUNTIME_BEARER_TOKEN: 'runtime-smoke-token',
    },
    initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
  })
  const manager = createManager()
  let restoredManager: LocalRuntimeManager | null = null
  const runtimeKey = 'stage-0-smoke'
  const approvalPolicy = ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.approvalPolicy
  const nativeRuntimeConfig = buildNativeRuntimeConfig()
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
    for (const professionalSkillId of professionalSkillIds) {
      assert.ok(enabledSkillNames.includes(professionalSkillId), `Native Codex did not load ${professionalSkillId}`)
    }
    const thread = await firstRuntime.startThread({
      model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || CODEX_DEFAULT_MODEL_ID,
      cwd,
      approvalPolicy,
      sandbox: 'read-only',
      config: nativeRuntimeConfig,
      developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
      ephemeral: false,
    })
    assert.equal((await firstRuntime.readThread({ threadId: thread.id })).id, thread.id)

    const persistenceMarker = 'RUNTIME_SMOKE_OK'
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
        approvalPolicy,
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      })
      const completedTurn = await completed
      assert.equal(completedTurn.id, turn.id)
      liveTurnStatus = typeof completedTurn.status === 'string' ? completedTurn.status : null
      assert.equal(liveTurnStatus, 'completed')
      assert.equal(streamedText.trim(), 'RUNTIME_SMOKE_OK')
    }

    const beforeCrash = await firstRuntime.readThread({ threadId: thread.id, includeTurns: params.liveTurn })
    if (params.liveTurn) assert.ok(JSON.stringify(beforeCrash.raw).includes(persistenceMarker))

    let resumed = false
    if (params.liveTurn) {
      // SIGKILL the app-server and resume the materialized native thread. No
      // Wao checkpoint, bundle restore, or product-message injection participates.
      await manager.forceShutdown(runtimeKey)
      restoredManager = createManager()
      const secondRuntime = await restoredManager.ensure({ runtimeKey, cwd })
      const resumedThread = await secondRuntime.resumeThread({
        threadId: thread.id,
        model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || CODEX_DEFAULT_MODEL_ID,
        cwd,
        approvalPolicy,
        sandbox: 'read-only',
        config: nativeRuntimeConfig,
      })
      assert.equal(resumedThread.id, thread.id)
      resumed = true
      const afterCrash = await secondRuntime.readThread({ threadId: thread.id, includeTurns: true })
      assert.ok(JSON.stringify(afterCrash.raw).includes(persistenceMarker))
      const restoredSkills = await secondRuntime.listSkills({ cwds: [cwd], forceReload: true })
      const restoredEnabledSkillNames = (restoredSkills.data[0]?.skills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => skill.name)
        .sort()
      for (const professionalSkillId of professionalSkillIds) {
        assert.ok(
          restoredEnabledSkillNames.includes(professionalSkillId),
          `Native Codex did not retain ${professionalSkillId} after resume`,
        )
      }
    }
    await manager.shutdownAll()
    await restoredManager?.shutdownAll()
    await persistence.destroyMaterialization(materialization)
    await persistence.clearScope(persistenceScope)
    await persistence.clearScope(persistenceScope)
    assert.deepEqual(await listRelativeNames(sharedHome), sharedHomeBefore)
    await assert.rejects(access(cwd), { code: 'ENOENT' })

    return {
      initializedUserAgent: initialized.userAgent,
      threadId: thread.id,
      resumed,
      failedTurnPersisted: false,
      idempotentScopeClearValidated: true,
      liveTurn: params.liveTurn,
      liveTurnStatus,
      streamedText,
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
    ])
  }
}

async function runNativeConcurrencySmoke(rootDir: string): Promise<void> {
  const persistence = new AssistantRuntimePersistence({
    hostRoot: path.join(rootDir, 'concurrency-persistence'),
    scopedCodexHome: false,
  })
  const sharedHome = path.join(rootDir, 'concurrency-shared-home')
  await mkdir(sharedHome, { recursive: true, mode: 0o700 })
  await writeFile(path.join(sharedHome, 'sentinel.txt'), 'preserve me\n')
  const sharedHomeBefore = await listRelativeNames(sharedHome)
  const scopeA = { userId: 'runtime-concurrency-user-a', projectId: 'runtime-concurrency-project-a' }
  const scopeB = { userId: 'runtime-concurrency-user-b', projectId: 'runtime-concurrency-project-b' }
  const materializationA = await persistence.materialize(scopeA)
  const materializationB = await persistence.materialize(scopeB)
  const managerA = new LocalRuntimeManager({
    clientInfo: { name: 'wao-runtime-concurrency-a', title: 'Wao Codex Runtime Concurrency A', version: '0.1.0' },
    env: { ...process.env, WAO_MCP_RUNTIME_BEARER_TOKEN: 'runtime-concurrency-token-a' },
    initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
  })
  const managerB = new LocalRuntimeManager({
    clientInfo: { name: 'wao-runtime-concurrency-b', title: 'Wao Codex Runtime Concurrency B', version: '0.1.0' },
    env: { ...process.env, WAO_MCP_RUNTIME_BEARER_TOKEN: 'runtime-concurrency-token-b' },
    initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
  })
  const runtimeKeyA = 'native-concurrency-a'
  const runtimeKeyB = 'native-concurrency-b'
  const cwdA = materializationA.hostWorkspaceDirectory
  const cwdB = materializationB.hostWorkspaceDirectory
  const config = buildNativeRuntimeConfig()
  const approvalPolicy = ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.approvalPolicy
  const sentinelA = 'NATIVE_CONCURRENCY_ALPHA'
  const sentinelB = 'NATIVE_CONCURRENCY_BETA'
  try {
    const [runtimeA, runtimeB] = await Promise.all([
      managerA.ensure({ runtimeKey: runtimeKeyA, cwd: cwdA }),
      managerB.ensure({ runtimeKey: runtimeKeyB, cwd: cwdB }),
    ])
    const [initializedA, initializedB] = await Promise.all([
      runtimeA.initialize(),
      runtimeB.initialize(),
    ])
    assert.equal(initializedA.platformFamily, initializedB.platformFamily)
    const [threadA, threadB] = await Promise.all([
      runtimeA.startThread({
        model: CODEX_DEFAULT_MODEL_ID,
        cwd: cwdA,
        approvalPolicy,
        sandbox: 'read-only',
        config,
        developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
        ephemeral: false,
      }),
      runtimeB.startThread({
        model: CODEX_DEFAULT_MODEL_ID,
        cwd: cwdB,
        approvalPolicy,
        sandbox: 'read-only',
        config,
        developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
        ephemeral: false,
      }),
    ])
    assert.notEqual(threadA.id, threadB.id)
    let streamedA = ''
    let streamedB = ''
    const completionA = waitForTurnCompletion({
      runtime: runtimeA,
      threadId: threadA.id,
      onDelta: (delta) => { streamedA += delta },
    })
    const completionB = waitForTurnCompletion({
      runtime: runtimeB,
      threadId: threadB.id,
      onDelta: (delta) => { streamedB += delta },
    })
    const [turnA, turnB] = await Promise.all([
      runtimeA.startTurn({
        threadId: threadA.id,
        input: [{ type: 'text', text: `Reply with exactly ${sentinelA}.` }],
        cwd: cwdA,
        approvalPolicy,
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      }),
      runtimeB.startTurn({
        threadId: threadB.id,
        input: [{ type: 'text', text: `Reply with exactly ${sentinelB}.` }],
        cwd: cwdB,
        approvalPolicy,
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      }),
    ])
    const [completedA, completedB] = await Promise.all([completionA, completionB])
    assert.equal(completedA.id, turnA.id)
    assert.equal(completedB.id, turnB.id)
    assert.equal(completedA.status, 'completed')
    assert.equal(completedB.status, 'completed')
    assert.equal(streamedA.trim(), sentinelA)
    assert.equal(streamedB.trim(), sentinelB)
    const [readA, readB] = await Promise.all([
      runtimeA.readThread({ threadId: threadA.id, includeTurns: true }),
      runtimeB.readThread({ threadId: threadB.id, includeTurns: true }),
    ])
    const serializedA = JSON.stringify(readA.raw)
    const serializedB = JSON.stringify(readB.raw)
    assert.ok(serializedA.includes(sentinelA))
    assert.ok(!serializedA.includes(sentinelB))
    assert.ok(serializedB.includes(sentinelB))
    assert.ok(!serializedB.includes(sentinelA))
  } finally {
    await Promise.allSettled([managerA.shutdownAll(), managerB.shutdownAll()])
    await Promise.allSettled([
      persistence.destroyMaterialization(materializationA),
      persistence.destroyMaterialization(materializationB),
      persistence.clearScope(scopeA),
      persistence.clearScope(scopeB),
    ])
  }
  assert.deepEqual(await listRelativeNames(sharedHome), sharedHomeBefore)
}

async function main(): Promise<void> {
  const liveTurn = process.argv.includes('--native-live-turn')
  const nativeConcurrency = process.argv.includes('--native-concurrency')
  const rootDir = await mkdtemp(path.join(tmpdir(), 'wao-codex-runtime-smoke-'))
  try {
    await withStageTimeout('mcp', async () => await runMcpSmoke())
    const appServer = await withStageTimeout(
      'app-server',
      async () => await runAppServerSmoke({ rootDir, liveTurn }),
    )
    if (nativeConcurrency) {
      await withStageTimeout(
        'native-concurrency',
        async () => await runNativeConcurrencySmoke(rootDir),
        180_000,
      )
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mcp: createWaoMcpToolRegistry().map((entry) => entry.name),
      appServer,
      nativeConcurrencyValidated: nativeConcurrency,
    }, null, 2)}\n`)
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
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
