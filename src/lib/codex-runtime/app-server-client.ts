import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type {
  RuntimeAdapter,
  RuntimeApprovalPolicy,
  RuntimeClientInfo,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeInitializeCapabilities,
  RuntimeInitializeResult,
  RuntimeJsonObject,
  RuntimeJsonValue,
  RuntimeRequestId,
  RuntimeSandboxPolicy,
  RuntimeServerRequestResponse,
  RuntimeSkillMetadata,
  RuntimeSkillsListEntry,
  RuntimeSkillsListParams,
  RuntimeSkillsListResponse,
  RuntimeThread,
  RuntimeThreadReadParams,
  RuntimeThreadResumeParams,
  RuntimeThreadStartParams,
  RuntimeTurn,
  RuntimeTurnInterruptParams,
  RuntimeTurnStartParams,
  RuntimeTurnSteerParams,
  RuntimeTurnStatus,
  RuntimeUserInput,
} from './runtime-adapter'

const DEFAULT_COMMAND = 'codex'
const DEFAULT_ARGS = [
  '--dangerously-bypass-hook-trust',
  'app-server',
  '--listen',
  'stdio://',
  '--enable',
  'code_mode_host',
] as const
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000

type PendingRequest = {
  readonly method: string
  readonly resolve: (value: RuntimeJsonValue) => void
  readonly reject: (error: Error) => void
}

type RpcError = {
  readonly code: number
  readonly message: string
  readonly data?: RuntimeJsonValue
}

export type CodexAppServerClientOptions = {
  readonly cwd: string
  readonly clientInfo: RuntimeClientInfo
  readonly initializeCapabilities?: RuntimeInitializeCapabilities | null
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly shutdownTimeoutMs?: number
}

export class CodexAppServerRpcError extends Error {
  readonly code: number
  readonly data?: RuntimeJsonValue

  constructor(method: string, error: RpcError) {
    super(`CODEX_APP_SERVER_RPC_ERROR:${method}:${error.code}:${error.message}`)
    this.name = 'CodexAppServerRpcError'
    this.code = error.code
    this.data = error.data
  }
}

export class CodexAppServerProtocolError extends Error {
  constructor(code: string) {
    super(`CODEX_APP_SERVER_PROTOCOL_ERROR:${code}`)
    this.name = 'CodexAppServerProtocolError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const allowedKeys = new Set(allowed)
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new CodexAppServerProtocolError(code)
  }
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CodexAppServerProtocolError(code)
  }
  return value
}

function requireFiniteNumber(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CodexAppServerProtocolError(code)
  }
  return value
}

function requireSafeInteger(value: unknown, code: string): number {
  const parsed = requireFiniteNumber(value, code)
  if (!Number.isSafeInteger(parsed)) throw new CodexAppServerProtocolError(code)
  return parsed
}

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw new CodexAppServerProtocolError(code)
  return value
}

function requireRequestId(value: unknown, code: string): RuntimeRequestId {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new CodexAppServerProtocolError(code)
}

function requireJsonValue(value: unknown, code: string): RuntimeJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return requireFiniteNumber(value, code)
  if (Array.isArray(value)) return value.map((entry) => requireJsonValue(entry, code))
  if (!isRecord(value)) throw new CodexAppServerProtocolError(code)

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, requireJsonValue(entry, code)]),
  )
}

function requireJsonObject(value: unknown, code: string): RuntimeJsonObject {
  const parsed = requireJsonValue(value, code)
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new CodexAppServerProtocolError(code)
  }
  return parsed
}

function requireTurnStatus(value: unknown): RuntimeTurnStatus {
  if (value === 'completed' || value === 'interrupted' || value === 'failed' || value === 'inProgress') {
    return value
  }
  throw new CodexAppServerProtocolError('TURN_STATUS_INVALID')
}

function parseThread(value: unknown): RuntimeThread {
  const raw = requireJsonObject(value, 'THREAD_INVALID')
  return {
    id: requireString(raw.id, 'THREAD_ID_INVALID'),
    raw,
  }
}

function parseTurn(value: unknown): RuntimeTurn {
  const raw = requireJsonObject(value, 'TURN_INVALID')
  return {
    id: requireString(raw.id, 'TURN_ID_INVALID'),
    status: requireTurnStatus(raw.status),
    raw,
  }
}

function parseSkillScope(value: unknown): RuntimeSkillMetadata['scope'] {
  if (value === 'user' || value === 'repo' || value === 'system' || value === 'admin') return value
  throw new CodexAppServerProtocolError('SKILLS_LIST_SKILL_SCOPE_INVALID')
}

function parseSkill(value: unknown): RuntimeSkillMetadata {
  if (!isRecord(value)) throw new CodexAppServerProtocolError('SKILLS_LIST_SKILL_INVALID')
  assertOnlyKeys(
    value,
    ['name', 'description', 'shortDescription', 'interface', 'dependencies', 'path', 'scope', 'enabled'],
    'SKILLS_LIST_SKILL_FIELDS_INVALID',
  )
  if (hasOwn(value, 'shortDescription') && value.shortDescription !== undefined) {
    requireString(value.shortDescription, 'SKILLS_LIST_SKILL_SHORT_DESCRIPTION_INVALID')
  }
  if (hasOwn(value, 'interface') && value.interface !== undefined) {
    requireJsonValue(value.interface, 'SKILLS_LIST_SKILL_INTERFACE_INVALID')
  }
  if (hasOwn(value, 'dependencies') && value.dependencies !== undefined) {
    requireJsonValue(value.dependencies, 'SKILLS_LIST_SKILL_DEPENDENCIES_INVALID')
  }
  return {
    name: requireString(value.name, 'SKILLS_LIST_SKILL_NAME_INVALID'),
    description: requireString(value.description, 'SKILLS_LIST_SKILL_DESCRIPTION_INVALID'),
    path: requireString(value.path, 'SKILLS_LIST_SKILL_PATH_INVALID'),
    scope: parseSkillScope(value.scope),
    enabled: requireBoolean(value.enabled, 'SKILLS_LIST_SKILL_ENABLED_INVALID'),
  }
}

function parseSkillsListEntry(value: unknown): RuntimeSkillsListEntry {
  if (!isRecord(value)) throw new CodexAppServerProtocolError('SKILLS_LIST_ENTRY_INVALID')
  assertOnlyKeys(value, ['cwd', 'skills', 'errors'], 'SKILLS_LIST_ENTRY_FIELDS_INVALID')
  if (!Array.isArray(value.skills) || !Array.isArray(value.errors)) {
    throw new CodexAppServerProtocolError('SKILLS_LIST_ENTRY_COLLECTION_INVALID')
  }
  return {
    cwd: requireString(value.cwd, 'SKILLS_LIST_ENTRY_CWD_INVALID'),
    skills: value.skills.map(parseSkill),
    errors: value.errors.map((error) => {
      if (!isRecord(error)) throw new CodexAppServerProtocolError('SKILLS_LIST_ERROR_INVALID')
      assertOnlyKeys(error, ['path', 'message'], 'SKILLS_LIST_ERROR_FIELDS_INVALID')
      return {
        path: requireString(error.path, 'SKILLS_LIST_ERROR_PATH_INVALID'),
        message: requireString(error.message, 'SKILLS_LIST_ERROR_MESSAGE_INVALID'),
      }
    }),
  }
}

function parseRpcError(value: unknown): RpcError {
  if (!isRecord(value)) throw new CodexAppServerProtocolError('RPC_ERROR_INVALID')
  assertOnlyKeys(value, ['code', 'message', 'data'], 'RPC_ERROR_FIELDS_INVALID')
  const code = requireSafeInteger(value.code, 'RPC_ERROR_CODE_INVALID')
  const message = requireString(value.message, 'RPC_ERROR_MESSAGE_INVALID')
  return hasOwn(value, 'data')
    ? { code, message, data: requireJsonValue(value.data, 'RPC_ERROR_DATA_INVALID') }
    : { code, message }
}

function putOptional(
  target: RuntimeJsonObject,
  key: string,
  value: RuntimeJsonValue | undefined,
): void {
  if (value !== undefined) target[key] = value
}

function approvalPolicyToJson(policy: RuntimeApprovalPolicy): RuntimeJsonValue {
  return requireJsonValue(policy, 'APPROVAL_POLICY_INVALID')
}

function sandboxPolicyToJson(policy: RuntimeSandboxPolicy): RuntimeJsonObject {
  return requireJsonObject(policy, 'SANDBOX_POLICY_INVALID')
}

function userInputToJson(input: RuntimeUserInput): RuntimeJsonObject {
  switch (input.type) {
    case 'text':
      return {
        type: 'text',
        text: requireString(input.text, 'USER_INPUT_TEXT_INVALID'),
        text_elements: [],
      }
    case 'image': {
      const result: RuntimeJsonObject = {
        type: 'image',
        url: requireString(input.url, 'USER_INPUT_URL_INVALID'),
      }
      putOptional(result, 'detail', input.detail)
      return result
    }
    case 'localImage': {
      const result: RuntimeJsonObject = {
        type: 'localImage',
        path: requireString(input.path, 'USER_INPUT_PATH_INVALID'),
      }
      putOptional(result, 'detail', input.detail)
      return result
    }
    case 'skill':
      return {
        type: 'skill',
        name: requireString(input.name, 'USER_INPUT_SKILL_NAME_INVALID'),
        path: requireString(input.path, 'USER_INPUT_SKILL_PATH_INVALID'),
      }
    case 'mention':
      return {
        type: 'mention',
        name: requireString(input.name, 'USER_INPUT_MENTION_NAME_INVALID'),
        path: requireString(input.path, 'USER_INPUT_MENTION_PATH_INVALID'),
      }
  }
}

function userInputsToJson(inputs: readonly RuntimeUserInput[]): RuntimeJsonValue[] {
  if (inputs.length === 0) throw new Error('CODEX_RUNTIME_INPUT_REQUIRED')
  return inputs.map(userInputToJson)
}

function validateOptions(options: CodexAppServerClientOptions): void {
  if (!options.cwd.trim()) throw new Error('CODEX_RUNTIME_CWD_REQUIRED')
  if (!options.clientInfo.name.trim()) throw new Error('CODEX_RUNTIME_CLIENT_NAME_REQUIRED')
  if (!options.clientInfo.version.trim()) throw new Error('CODEX_RUNTIME_CLIENT_VERSION_REQUIRED')
  if (options.shutdownTimeoutMs !== undefined && (!Number.isSafeInteger(options.shutdownTimeoutMs) || options.shutdownTimeoutMs <= 0)) {
    throw new Error('CODEX_RUNTIME_SHUTDOWN_TIMEOUT_INVALID')
  }
}

export class CodexAppServerClient implements RuntimeAdapter {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly reader: ReadlineInterface
  private readonly clientInfo: RuntimeClientInfo
  private readonly initializeCapabilities: RuntimeInitializeCapabilities | null
  private readonly shutdownTimeoutMs: number
  private readonly pendingRequests = new Map<RuntimeRequestId, PendingRequest>()
  private readonly pendingServerRequests = new Set<RuntimeRequestId>()
  private readonly listeners = new Set<RuntimeEventListener>()
  private nextRequestId = 1
  private initializePromise: Promise<RuntimeInitializeResult> | null = null
  private initializeResult: RuntimeInitializeResult | null = null
  private shutdownPromise: Promise<void> | null = null
  private protocolFailed = false
  private shuttingDown = false
  private didExit = false

  constructor(options: CodexAppServerClientOptions) {
    validateOptions(options)
    this.clientInfo = options.clientInfo
    this.initializeCapabilities = options.initializeCapabilities ?? null
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    this.child = spawn(options.command ?? DEFAULT_COMMAND, [...(options.args ?? DEFAULT_ARGS)], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    this.reader = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.reader.on('line', (line) => this.handleLine(line))
    this.child.stderr.on('data', () => {
      // stderr is diagnostic-only; consuming it prevents child-process backpressure.
    })
    this.child.once('error', (error) => this.failProtocol(new CodexAppServerProtocolError(`PROCESS_SPAWN_FAILED:${error.message}`)))
    this.child.once('exit', (code, signal) => this.handleExit(code, signal))
  }

  get closed(): boolean {
    return this.didExit || this.protocolFailed
  }

  async initialize(): Promise<RuntimeInitializeResult> {
    if (this.initializeResult) return this.initializeResult
    if (this.initializePromise) return await this.initializePromise
    this.assertUsable()

    const promise = this.performInitialize()
    this.initializePromise = promise
    try {
      const result = await promise
      this.initializeResult = result
      return result
    } catch (error) {
      this.initializePromise = null
      throw error
    }
  }

  async startThread(params: RuntimeThreadStartParams): Promise<RuntimeThread> {
    await this.requireInitialized()
    const requestParams: RuntimeJsonObject = {}
    putOptional(requestParams, 'model', params.model)
    putOptional(requestParams, 'modelProvider', params.modelProvider)
    putOptional(requestParams, 'serviceTier', params.serviceTier)
    putOptional(requestParams, 'cwd', params.cwd)
    putOptional(requestParams, 'approvalPolicy', params.approvalPolicy ? approvalPolicyToJson(params.approvalPolicy) : undefined)
    putOptional(requestParams, 'sandbox', params.sandbox)
    putOptional(requestParams, 'config', params.config)
    putOptional(requestParams, 'serviceName', params.serviceName)
    putOptional(requestParams, 'baseInstructions', params.baseInstructions)
    putOptional(requestParams, 'developerInstructions', params.developerInstructions)
    putOptional(requestParams, 'personality', params.personality)
    putOptional(requestParams, 'ephemeral', params.ephemeral)

    const response = await this.request('thread/start', requestParams)
    return this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'THREAD_START_RESPONSE_INVALID')
      return parseThread(result.thread)
    })
  }

  async resumeThread(params: RuntimeThreadResumeParams): Promise<RuntimeThread> {
    await this.requireInitialized()
    const requestParams: RuntimeJsonObject = {
      threadId: requireString(params.threadId, 'THREAD_RESUME_ID_INVALID'),
    }
    putOptional(requestParams, 'model', params.model)
    putOptional(requestParams, 'modelProvider', params.modelProvider)
    putOptional(requestParams, 'serviceTier', params.serviceTier)
    putOptional(requestParams, 'cwd', params.cwd)
    putOptional(requestParams, 'approvalPolicy', params.approvalPolicy ? approvalPolicyToJson(params.approvalPolicy) : undefined)
    putOptional(requestParams, 'sandbox', params.sandbox)
    putOptional(requestParams, 'config', params.config)
    putOptional(requestParams, 'baseInstructions', params.baseInstructions)
    putOptional(requestParams, 'developerInstructions', params.developerInstructions)
    putOptional(requestParams, 'personality', params.personality)

    const response = await this.request('thread/resume', requestParams)
    return this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'THREAD_RESUME_RESPONSE_INVALID')
      return parseThread(result.thread)
    })
  }

  async readThread(params: RuntimeThreadReadParams): Promise<RuntimeThread> {
    await this.requireInitialized()
    const requestParams: RuntimeJsonObject = {
      threadId: requireString(params.threadId, 'THREAD_READ_ID_INVALID'),
    }
    putOptional(requestParams, 'includeTurns', params.includeTurns)
    const response = await this.request('thread/read', requestParams)
    return this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'THREAD_READ_RESPONSE_INVALID')
      return parseThread(result.thread)
    })
  }

  async listSkills(params: RuntimeSkillsListParams): Promise<RuntimeSkillsListResponse> {
    await this.requireInitialized()
    const requestParams: RuntimeJsonObject = {}
    putOptional(requestParams, 'cwds', params.cwds
      ? params.cwds.map((cwd) => requireString(cwd, 'SKILLS_LIST_CWD_INVALID'))
      : undefined)
    putOptional(requestParams, 'forceReload', params.forceReload)
    const response = await this.request('skills/list', requestParams)
    return this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'SKILLS_LIST_RESPONSE_INVALID')
      assertOnlyKeys(result, ['data'], 'SKILLS_LIST_RESPONSE_FIELDS_INVALID')
      if (!Array.isArray(result.data)) {
        throw new CodexAppServerProtocolError('SKILLS_LIST_RESPONSE_DATA_INVALID')
      }
      return { data: result.data.map(parseSkillsListEntry) }
    })
  }

  async startTurn(params: RuntimeTurnStartParams): Promise<RuntimeTurn> {
    await this.requireInitialized()
    const requestParams: RuntimeJsonObject = {
      threadId: requireString(params.threadId, 'TURN_START_THREAD_ID_INVALID'),
      input: userInputsToJson(params.input),
    }
    putOptional(requestParams, 'clientUserMessageId', params.clientUserMessageId)
    putOptional(requestParams, 'cwd', params.cwd)
    putOptional(requestParams, 'approvalPolicy', params.approvalPolicy ? approvalPolicyToJson(params.approvalPolicy) : undefined)
    putOptional(requestParams, 'sandboxPolicy', params.sandboxPolicy ? sandboxPolicyToJson(params.sandboxPolicy) : undefined)
    putOptional(requestParams, 'model', params.model)
    putOptional(requestParams, 'serviceTier', params.serviceTier)
    putOptional(requestParams, 'effort', params.effort)
    putOptional(requestParams, 'summary', params.summary)
    putOptional(requestParams, 'personality', params.personality)
    putOptional(requestParams, 'outputSchema', params.outputSchema)
    putOptional(
      requestParams,
      'collaborationMode',
      params.collaborationMode
        ? requireJsonObject(params.collaborationMode, 'TURN_START_COLLABORATION_MODE_INVALID')
        : undefined,
    )

    const response = await this.request('turn/start', requestParams)
    return this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'TURN_START_RESPONSE_INVALID')
      return parseTurn(result.turn)
    })
  }

  async steerTurn(params: RuntimeTurnSteerParams): Promise<string> {
    await this.requireInitialized()
    const requestParams: RuntimeJsonObject = {
      threadId: requireString(params.threadId, 'TURN_STEER_THREAD_ID_INVALID'),
      expectedTurnId: requireString(params.expectedTurnId, 'TURN_STEER_EXPECTED_ID_INVALID'),
      input: userInputsToJson(params.input),
    }
    putOptional(requestParams, 'clientUserMessageId', params.clientUserMessageId)
    const response = await this.request('turn/steer', requestParams)
    return this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'TURN_STEER_RESPONSE_INVALID')
      return requireString(result.turnId, 'TURN_STEER_RESPONSE_ID_INVALID')
    })
  }

  async interruptTurn(params: RuntimeTurnInterruptParams): Promise<void> {
    await this.requireInitialized()
    const response = await this.request('turn/interrupt', {
      threadId: requireString(params.threadId, 'TURN_INTERRUPT_THREAD_ID_INVALID'),
      turnId: requireString(params.turnId, 'TURN_INTERRUPT_TURN_ID_INVALID'),
    })
    this.parseProtocolResponse(() => {
      const result = requireJsonObject(response, 'TURN_INTERRUPT_RESPONSE_INVALID')
      if (Object.keys(result).length !== 0) throw new CodexAppServerProtocolError('TURN_INTERRUPT_RESPONSE_NOT_EMPTY')
    })
  }

  hasPendingServerRequest(requestId: RuntimeRequestId): boolean {
    return !this.closed && this.pendingServerRequests.has(requestId)
  }

  async respondToServerRequest(response: RuntimeServerRequestResponse): Promise<void> {
    this.assertUsable()
    if (!this.pendingServerRequests.has(response.id)) {
      throw new Error('CODEX_RUNTIME_SERVER_REQUEST_UNKNOWN')
    }

    let outbound: RuntimeJsonObject
    if ('result' in response) {
      outbound = {
        id: response.id,
        result: requireJsonValue(response.result, 'SERVER_REQUEST_RESULT_INVALID'),
      }
    } else {
      const error: RuntimeJsonObject = {
        code: requireSafeInteger(response.error.code, 'SERVER_REQUEST_ERROR_CODE_INVALID'),
        message: requireString(response.error.message, 'SERVER_REQUEST_ERROR_MESSAGE_INVALID'),
      }
      putOptional(error, 'data', response.error.data)
      outbound = { id: response.id, error }
    }
    this.writeMessage(outbound)
    this.pendingServerRequests.delete(response.id)
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return await this.shutdownPromise
    const promise = this.performShutdown()
    this.shutdownPromise = promise
    return await promise
  }

  /** Immediately terminate the local app-server process group and its tools. */
  async forceShutdown(): Promise<void> {
    if (this.didExit) return
    this.shuttingDown = true
    this.rejectPending(new Error('CODEX_RUNTIME_FORCE_STOPPED'))
    this.pendingServerRequests.clear()
    const pid = this.child.pid
    if (process.platform !== 'win32' && typeof pid === 'number') {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    } else {
      this.child.kill('SIGKILL')
    }
    if (!(await this.waitForExit(this.shutdownTimeoutMs))) {
      throw new Error('CODEX_RUNTIME_FORCE_SHUTDOWN_TIMEOUT')
    }
  }

  private async performInitialize(): Promise<RuntimeInitializeResult> {
    const response = await this.request('initialize', {
      clientInfo: {
        name: requireString(this.clientInfo.name, 'INITIALIZE_CLIENT_NAME_INVALID'),
        title: this.clientInfo.title,
        version: requireString(this.clientInfo.version, 'INITIALIZE_CLIENT_VERSION_INVALID'),
      },
      capabilities: this.initializeCapabilities
        ? requireJsonObject(this.initializeCapabilities, 'INITIALIZE_CAPABILITIES_INVALID')
        : null,
    })
    const result = this.parseProtocolResponse<RuntimeInitializeResult>(() => {
      const raw = requireJsonObject(response, 'INITIALIZE_RESPONSE_INVALID')
      return {
        userAgent: requireString(raw.userAgent, 'INITIALIZE_USER_AGENT_INVALID'),
        codexHome: requireString(raw.codexHome, 'INITIALIZE_CODEX_HOME_INVALID'),
        platformFamily: requireString(raw.platformFamily, 'INITIALIZE_PLATFORM_FAMILY_INVALID'),
        platformOs: requireString(raw.platformOs, 'INITIALIZE_PLATFORM_OS_INVALID'),
        raw,
      }
    })
    this.writeMessage({ method: 'initialized', params: {} })
    return result
  }

  private async requireInitialized(): Promise<void> {
    await this.initialize()
  }

  private request(method: string, params: RuntimeJsonObject): Promise<RuntimeJsonValue> {
    this.assertUsable()
    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { method, resolve, reject })
      try {
        this.writeMessage({ id, method, params })
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error('CODEX_RUNTIME_REQUEST_WRITE_FAILED'))
      }
    })
  }

  private writeMessage(message: RuntimeJsonObject): void {
    this.assertUsable()
    const serialized = JSON.stringify(requireJsonObject(message, 'OUTBOUND_MESSAGE_INVALID'))
    if (!this.child.stdin.write(`${serialized}\n`)) {
      this.child.stdin.once('drain', () => undefined)
    }
  }

  private handleLine(line: string): void {
    if (this.protocolFailed || this.didExit) return
    if (!line.trim()) {
      this.failProtocol(new CodexAppServerProtocolError('EMPTY_MESSAGE'))
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
      this.handleMessage(parsed)
    } catch (error) {
      this.failProtocol(error instanceof Error ? error : new CodexAppServerProtocolError('MESSAGE_PARSE_FAILED'))
    }
  }

  private handleMessage(value: unknown): void {
    if (!isRecord(value)) throw new CodexAppServerProtocolError('MESSAGE_NOT_OBJECT')
    const hasId = hasOwn(value, 'id')
    const hasMethod = hasOwn(value, 'method')
    const hasResult = hasOwn(value, 'result')
    const hasError = hasOwn(value, 'error')

    if (hasMethod && hasId && !hasResult && !hasError) {
      assertOnlyKeys(value, ['id', 'method', 'params'], 'SERVER_REQUEST_FIELDS_INVALID')
      this.handleServerRequest(value)
      return
    }
    if (hasMethod && !hasId && !hasResult && !hasError) {
      assertOnlyKeys(value, ['method', 'params', 'emittedAtMs'], 'NOTIFICATION_FIELDS_INVALID')
      if (hasOwn(value, 'emittedAtMs')) {
        requireSafeInteger(value.emittedAtMs, 'NOTIFICATION_EMITTED_AT_INVALID')
      }
      this.emit({
        type: 'notification',
        method: requireString(value.method, 'NOTIFICATION_METHOD_INVALID'),
        params: requireJsonObject(value.params, 'NOTIFICATION_PARAMS_INVALID'),
      })
      return
    }
    if (!hasMethod && hasId && hasResult !== hasError) {
      assertOnlyKeys(value, hasResult ? ['id', 'result'] : ['id', 'error'], 'RESPONSE_FIELDS_INVALID')
      this.handleResponse(value, hasResult)
      return
    }
    throw new CodexAppServerProtocolError('MESSAGE_ENVELOPE_INVALID')
  }

  private handleResponse(value: Record<string, unknown>, hasResult: boolean): void {
    const id = requireRequestId(value.id, 'RESPONSE_ID_INVALID')
    const pending = this.pendingRequests.get(id)
    if (!pending) throw new CodexAppServerProtocolError('RESPONSE_ID_UNKNOWN')
    this.pendingRequests.delete(id)

    if (hasResult) {
      pending.resolve(requireJsonValue(value.result, 'RESPONSE_RESULT_INVALID'))
      return
    }
    pending.reject(new CodexAppServerRpcError(pending.method, parseRpcError(value.error)))
  }

  private handleServerRequest(value: Record<string, unknown>): void {
    const id = requireRequestId(value.id, 'SERVER_REQUEST_ID_INVALID')
    if (this.pendingServerRequests.has(id)) throw new CodexAppServerProtocolError('SERVER_REQUEST_ID_DUPLICATE')
    const request = {
      id,
      method: requireString(value.method, 'SERVER_REQUEST_METHOD_INVALID'),
      params: requireJsonObject(value.params, 'SERVER_REQUEST_PARAMS_INVALID'),
    }
    this.pendingServerRequests.add(id)
    this.emit({ type: 'serverRequest', request })
  }

  private failProtocol(error: Error): void {
    if (this.protocolFailed || this.didExit) return
    this.protocolFailed = true
    this.rejectPending(error)
    this.emit({ type: 'protocolError', error })
    this.child.kill('SIGKILL')
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.didExit) return
    this.didExit = true
    this.reader.close()
    this.rejectPending(new Error(`CODEX_APP_SERVER_EXITED:${code ?? 'null'}:${signal ?? 'null'}`))
    this.pendingServerRequests.clear()
    this.emit({ type: 'processExited', code, signal, expected: this.shuttingDown })
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error)
    this.pendingRequests.clear()
  }

  private parseProtocolResponse<Result>(parse: () => Result): Result {
    try {
      return parse()
    } catch (error) {
      const protocolError = error instanceof Error
        ? error
        : new CodexAppServerProtocolError('RESPONSE_SCHEMA_INVALID')
      this.failProtocol(protocolError)
      throw protocolError
    }
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'UNKNOWN_LISTENER_ERROR'
        process.stderr.write(`CODEX_RUNTIME_LISTENER_ERROR:${detail}\n`)
      }
    }
  }

  private assertUsable(): void {
    if (this.protocolFailed) throw new Error('CODEX_RUNTIME_PROTOCOL_FAILED')
    if (this.didExit) throw new Error('CODEX_RUNTIME_PROCESS_EXITED')
    if (this.shuttingDown) throw new Error('CODEX_RUNTIME_SHUTTING_DOWN')
  }

  private async performShutdown(): Promise<void> {
    if (this.didExit) return
    this.shuttingDown = true
    this.rejectPending(new Error('CODEX_RUNTIME_SHUTTING_DOWN'))
    this.pendingServerRequests.clear()
    this.child.stdin.end()

    if (await this.waitForExit(this.shutdownTimeoutMs)) return
    this.child.kill('SIGTERM')
    if (await this.waitForExit(this.shutdownTimeoutMs)) return
    this.child.kill('SIGKILL')
    if (!(await this.waitForExit(this.shutdownTimeoutMs))) {
      throw new Error('CODEX_RUNTIME_SHUTDOWN_TIMEOUT')
    }
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.didExit) return true
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.child.off('exit', onExit)
        resolve(value)
      }
      const onExit = (): void => finish(true)
      const timer = setTimeout(() => finish(this.didExit), timeoutMs)
      this.child.once('exit', onExit)
    })
  }
}
