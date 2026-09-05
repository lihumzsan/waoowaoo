import { randomUUID } from 'node:crypto'
import type { UIMessage } from 'ai'
import { Prisma } from '@prisma/client'
import mysql from 'mysql2/promise'
import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import { RedisAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { AssistantRuntimeService } from '@/lib/assistant-runtime/service'
import { parseFailureRecord } from '@/lib/errors/failure'
import { findCarriedFailureRecord } from '@/lib/errors/normalize'
import type {
  AssistantRuntimeAccess,
  AssistantRuntimeModelConfiguration,
} from '@/lib/assistant-runtime/runtime-access'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeInitializeResult,
  RuntimeRequestId,
  RuntimeServerRequestResponse,
  RuntimeSkillsListResponse,
  RuntimeThread,
  RuntimeThreadReadParams,
  RuntimeTurn,
  RuntimeTurnStartParams,
  RuntimeTurnSteerParams,
} from '@/lib/codex-runtime/runtime-adapter'
import type {
  RuntimeContainerAdapter,
  RuntimeContainerHandle,
} from '@/lib/codex-runtime/runtime-container'
import {
  RuntimeSessionManager,
  type RuntimeSessionPersistence,
  type RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import type { ProjectProductionContext } from '@/lib/project-production-context'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

const runtimeThreadId = 'native-recovered-thread'
const runtimeTurnId = 'runtime-recovered-turn'
const runtimeWorkspaceDirectory = 'C:\\runtime-workspace'

class DeterministicRuntimeAdapter implements RuntimeAdapter {
  closed = false
  private readonly listeners = new Set<RuntimeEventListener>()
  private readonly pendingServerRequests = new Set<RuntimeRequestId>()
  private lastTurnThreadId: string | null = null

  constructor(private readonly startThreadFails: boolean) {}

  async initialize(): Promise<RuntimeInitializeResult> {
    return {
      userAgent: 'assistant-runtime-recovery-test',
      codexHome: 'C:\\runtime-home',
      platformFamily: 'windows',
      platformOs: 'windows',
      raw: {},
    }
  }

  async startThread(): Promise<RuntimeThread> {
    if (this.startThreadFails) throw new Error('NATIVE_THREAD_START_REJECTED')
    return { id: runtimeThreadId, raw: {} }
  }

  async resumeThread(): Promise<RuntimeThread> {
    throw new Error('NATIVE_THREAD_RESUME_REJECTED')
  }

  async readThread(params: RuntimeThreadReadParams): Promise<RuntimeThread> {
    return { id: params.threadId, raw: {} }
  }

  async listSkills(): Promise<RuntimeSkillsListResponse> {
    return { data: [{ cwd: runtimeWorkspaceDirectory, skills: [], errors: [] }] }
  }

  async startTurn(params: RuntimeTurnStartParams): Promise<RuntimeTurn> {
    this.lastTurnThreadId = params.threadId
    return { id: runtimeTurnId, status: 'inProgress', raw: {} }
  }

  async steerTurn(params: RuntimeTurnSteerParams): Promise<string> {
    return params.expectedTurnId
  }

  async interruptTurn(): Promise<void> {}

  hasPendingServerRequest(requestId: RuntimeRequestId): boolean {
    return !this.closed && this.pendingServerRequests.has(requestId)
  }

  async respondToServerRequest(response: RuntimeServerRequestResponse): Promise<void> {
    if (!this.pendingServerRequests.delete(response.id)) {
      throw new Error('TEST_RUNTIME_SERVER_REQUEST_UNKNOWN')
    }
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async shutdown(): Promise<void> {
    this.closed = true
    this.pendingServerRequests.clear()
  }

  completeTurn(): void {
    if (!this.lastTurnThreadId) throw new Error('TEST_RUNTIME_TURN_NOT_STARTED')
    const event: RuntimeEvent = {
      type: 'notification',
      method: 'turn/completed',
      params: {
        threadId: this.lastTurnThreadId,
        turn: { id: runtimeTurnId, status: 'completed' },
      },
    }
    for (const listener of this.listeners) listener(event)
  }

  completeTurnWithAgentMessage(text: string): void {
    if (!this.lastTurnThreadId) throw new Error('TEST_RUNTIME_TURN_NOT_STARTED')
    const itemEvent: RuntimeEvent = {
      type: 'notification',
      method: 'item/completed',
      params: {
        threadId: this.lastTurnThreadId,
        turnId: runtimeTurnId,
        item: { id: 'oversize-agent-message', type: 'agentMessage', text },
      },
    }
    for (const listener of this.listeners) listener(itemEvent)
    this.completeTurn()
  }

  failTurnWithAgentMessage(text: string): void {
    if (!this.lastTurnThreadId) throw new Error('TEST_RUNTIME_TURN_NOT_STARTED')
    const itemEvent: RuntimeEvent = {
      type: 'notification',
      method: 'item/completed',
      params: {
        threadId: this.lastTurnThreadId,
        turnId: runtimeTurnId,
        item: { id: 'oversize-agent-message', type: 'agentMessage', text },
      },
    }
    const terminalEvent: RuntimeEvent = {
      type: 'notification',
      method: 'turn/completed',
      params: {
        threadId: this.lastTurnThreadId,
        turn: {
          id: runtimeTurnId,
          status: 'failed',
          error: { message: 'NATIVE_RUNTIME_TURN_FAILED', codexErrorInfo: 'other' },
        },
      },
    }
    for (const listener of this.listeners) {
      listener(itemEvent)
      listener(terminalEvent)
    }
  }

  requestUserDecision(): void {
    if (!this.lastTurnThreadId) throw new Error('TEST_RUNTIME_TURN_NOT_STARTED')
    const event: RuntimeEvent = {
      type: 'serverRequest',
      request: {
        id: 'asset-approval',
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: this.lastTurnThreadId,
          turnId: runtimeTurnId,
          mode: 'form',
          message: 'Keep the generated assets?',
          requestedSchema: {
            type: 'object',
            required: ['optionId'],
            properties: {
              optionId: {
                type: 'string',
                oneOf: [{ const: 'pause', title: 'Pause' }],
              },
            },
          },
        },
      },
    }
    this.pendingServerRequests.add(event.request.id)
    for (const listener of this.listeners) listener(event)
  }
}

class DeterministicRuntimeContainer implements RuntimeContainerAdapter {
  private readonly runtimes: DeterministicRuntimeAdapter[] = []

  constructor(private readonly startThreadFails = false) {}

  async reconcile(): Promise<void> {}

  async launch(): Promise<RuntimeContainerHandle> {
    const runtime = new DeterministicRuntimeAdapter(this.startThreadFails)
    this.runtimes.push(runtime)
    return {
      runtime,
      runtimeWorkspaceDirectory,
      identity: `test-runtime-container-${this.runtimes.length}`,
      stop: async () => await runtime.shutdown(),
    }
  }

  completeLatestTurn(): void {
    const latest = this.runtimes.at(-1)
    if (!latest) throw new Error('TEST_RUNTIME_NOT_LAUNCHED')
    latest.completeTurn()
  }

  completeLatestTurnWithAgentMessage(text: string): void {
    const latest = this.runtimes.at(-1)
    if (!latest) throw new Error('TEST_RUNTIME_NOT_LAUNCHED')
    latest.completeTurnWithAgentMessage(text)
  }

  failLatestTurnWithAgentMessage(text: string): void {
    const latest = this.runtimes.at(-1)
    if (!latest) throw new Error('TEST_RUNTIME_NOT_LAUNCHED')
    latest.failTurnWithAgentMessage(text)
  }

  requestLatestUserDecision(): void {
    const latest = this.runtimes.at(-1)
    if (!latest) throw new Error('TEST_RUNTIME_NOT_LAUNCHED')
    latest.requestUserDecision()
  }
}

const testPersistence: RuntimeSessionPersistence = {
  readContractRevision: async () => 'a'.repeat(64),
  reconcileBeforeStart: async () => undefined,
  materialize: async (_scope, contractRevision) => ({
    hostWorkspaceDirectory: runtimeWorkspaceDirectory,
    contractRevision,
  }),
  destroyMaterialization: async () => undefined,
  clearScope: async () => undefined,
}

function testModel(project: { readonly id: string; readonly name: string }): AssistantRuntimeModelConfiguration {
  const projectProductionContext: ProjectProductionContext = {
    schemaVersion: 10,
    version: 'test',
    project: {
      projectId: project.id,
      name: project.name,
      description: null,
      videoRatio: null,
      videoResolution: '1080p',
      imageResolution: '1024x1024',
    },
    productionCapabilities: { video: null, music: null, sound: null },
    productionDefaults: {
      video: { vocalPerformanceMode: 'native_dialogue' },
    },
  }
  return {
    modelKey: 'codex::gpt-5.5',
    runtimeModel: 'gpt-5.5',
    projectProductionContext,
    thread: {
      start: { sandbox: 'workspace-write', approvalPolicy: 'never' },
      resume: { sandbox: 'workspace-write', approvalPolicy: 'never' },
    },
  }
}

describe('Assistant Runtime native Thread recovery', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('fails closed when the bound native Thread cannot resume', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const priorMessage: UIMessage = {
      id: 'preserved-message',
      role: 'user',
      parts: [{ type: 'text', text: 'preserve this Wao fact' }],
    }
    const thread = await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        runtimeThreadId: 'native-unresumable-thread',
        nextMessagePosition: 2,
        messages: {
          create: {
            messageId: priorMessage.id,
            position: 1,
            messageJson: priorMessage as unknown as Prisma.InputJsonValue,
            byteLength: Buffer.byteLength(JSON.stringify(priorMessage), 'utf8'),
          },
        },
      },
    })
    const container = new DeterministicRuntimeContainer()
    const closedPlacements: Array<{
      readonly scope: RuntimeSessionScope
      readonly ownerToken: string
    }> = []
    const manager = new RuntimeSessionManager({
      container,
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      closePlacementTransportSessions: async (placement) => {
        closedPlacements.push(placement)
      },
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
    }
    const service = new AssistantRuntimeService({
      manager,
      access: { get: async () => access, invalidate: () => undefined },
      models: { resolve: async () => testModel(project) },
    })
    const message: UIMessage = {
      id: 'recovery-message',
      role: 'user',
      parts: [{ type: 'text', text: 'continue with a new native Thread' }],
    }

    try {
      await expect(service.send({
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        requestId: randomUUID(),
        sourceId: message.id,
        message,
        context: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
      })).rejects.toThrow('NATIVE_THREAD_RESUME_REJECTED')

      await expect(prisma.projectAssistantThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: {
          runtimeThreadId: true,
          messages: { orderBy: { position: 'asc' }, select: { messageJson: true } },
        },
      })).resolves.toMatchObject({
        runtimeThreadId: 'native-unresumable-thread',
        messages: expect.arrayContaining([
          { messageJson: priorMessage },
          { messageJson: expect.objectContaining({ id: message.id, role: 'user', parts: message.parts }) },
        ]),
      })
      await expect(prisma.projectAgentTurn.count({ where: { threadId: thread.id } }))
        .resolves.toBe(1)
      const failedTurn = await prisma.projectAgentTurn.findFirstOrThrow({
        where: { threadId: thread.id },
        select: { failure: true },
      })
      const failure = parseFailureRecord(failedTurn.failure)
      expect(failure?.interpretation.code).toBe('PROJECT_AGENT_RUNTIME_FAILED')
      expect(failure?.native.message).toContain('NATIVE_THREAD_RESUME_REJECTED')
    } finally {
      await manager.shutdownAll()
    }
    expect(closedPlacements).toHaveLength(1)
    expect(closedPlacements).toEqual(closedPlacements.map(() => ({
      scope: { projectId: project.id, userId: user.id },
      ownerToken: access.ownerToken,
    })))
  })

  it('keeps the old binding when the fresh native Thread cannot start', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const priorMessage: UIMessage = {
      id: 'preserved-on-failure',
      role: 'user',
      parts: [{ type: 'text', text: 'do not discard this Wao fact' }],
    }
    const thread = await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        runtimeThreadId: null,
        nextMessagePosition: 2,
        messages: {
          create: {
            messageId: priorMessage.id,
            position: 1,
            messageJson: priorMessage as unknown as Prisma.InputJsonValue,
            byteLength: Buffer.byteLength(JSON.stringify(priorMessage), 'utf8'),
          },
        },
      },
    })
    const manager = new RuntimeSessionManager({
      container: new DeterministicRuntimeContainer(true),
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      closePlacementTransportSessions: async () => undefined,
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
    }
    const service = new AssistantRuntimeService({
      manager,
      access: { get: async () => access, invalidate: () => undefined },
      models: { resolve: async () => testModel(project) },
    })
    const message: UIMessage = {
      id: 'fresh-start-failure-message',
      role: 'user',
      parts: [{ type: 'text', text: 'this attempt must not replace the binding' }],
    }

    try {
      await expect(service.send({
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        requestId: randomUUID(),
        sourceId: message.id,
        message,
        context: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
      })).rejects.toThrow('NATIVE_THREAD_START_REJECTED')

      await expect(prisma.projectAssistantThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: {
          runtimeThreadId: true,
          messages: { orderBy: { position: 'asc' }, select: { messageJson: true } },
        },
      })).resolves.toMatchObject({
        runtimeThreadId: null,
        messages: expect.arrayContaining([
          { messageJson: priorMessage },
          { messageJson: expect.objectContaining({ id: message.id, role: 'user', parts: message.parts }) },
        ]),
      })
      await expect(prisma.projectAgentTurn.count({ where: { threadId: thread.id } }))
        .resolves.toBe(1)
    } finally {
      await manager.shutdownAll()
    }
  })

  it('settles a failed native Thread binding before placement cleanup waits', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const thread = await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
      },
    })
    const container = new DeterministicRuntimeContainer()
    let service: AssistantRuntimeService | null = null
    let cleanupObservedQueuedTurn = false
    const sourceId = 'native-thread-binding-settlement-message'
    const manager = new RuntimeSessionManager({
      container,
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      closePlacementTransportSessions: async () => undefined,
      waitForTurnSettlement: async (scope) => {
        const turn = await prisma.projectAgentTurn.findFirstOrThrow({
          where: { sourceId },
          select: { status: true },
        })
        if (turn.status === 'queued') {
          cleanupObservedQueuedTurn = true
          throw new Error('TEST_PLACEMENT_STOPPED_BEFORE_DURABLE_SETTLEMENT')
        }
        if (!service) throw new Error('TEST_ASSISTANT_RUNTIME_SERVICE_MISSING')
        await service.waitForTurnSettlements(scope)
      },
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
    }
    service = new AssistantRuntimeService({
      manager,
      access: { get: async () => access, invalidate: () => undefined },
      models: { resolve: async () => testModel(project) },
    })
    const message: UIMessage = {
      id: sourceId,
      role: 'user',
      parts: [{ type: 'text', text: 'reject the first native Thread binding' }],
    }
    const triggerName = 'test_reject_assistant_native_thread_binding'
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL_REQUIRED')
    const database = await mysql.createConnection(databaseUrl)

    try {
      await database.query(`DROP TRIGGER IF EXISTS ${triggerName}`)
      await database.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON project_assistant_threads
        FOR EACH ROW
        BEGIN
          IF OLD.id = ${database.escape(thread.id)}
            AND OLD.runtimeThreadId IS NULL
            AND NEW.runtimeThreadId IS NOT NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TEST_ASSISTANT_NATIVE_THREAD_BIND_REJECTED';
          END IF;
        END
      `)

      let sendError: unknown = null
      try {
        await service.send({
          projectId: project.id,
          userId: user.id,
          assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
          requestId: randomUUID(),
          sourceId: message.id,
          message,
          context: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
        })
      } catch (error) {
        sendError = error
      }

      expect(cleanupObservedQueuedTurn).toBe(false)
      expect(findCarriedFailureRecord(sendError)?.native.message)
        .toContain('TEST_ASSISTANT_NATIVE_THREAD_BIND_REJECTED')
      await expect(service.waitForTurnSettlements({
        projectId: project.id,
        userId: user.id,
      })).resolves.toBeUndefined()
      await expect(prisma.projectAgentTurn.findFirstOrThrow({
        where: { sourceId },
        select: { status: true, failure: true },
      })).resolves.toMatchObject({
        status: 'interrupted',
        failure: expect.any(Object),
      })
      await expect(prisma.projectAssistantThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: { runtimeThreadId: true },
      })).resolves.toEqual({ runtimeThreadId: null })
    } finally {
      await database.query(`DROP TRIGGER IF EXISTS ${triggerName}`)
      await database.end()
      await manager.shutdownAll()
    }
  })

  it('keeps a failed prepare settlement visible and fenced', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const manager = new RuntimeSessionManager({
      container: new DeterministicRuntimeContainer(true),
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      closePlacementTransportSessions: async () => undefined,
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
    }
    const service = new AssistantRuntimeService({
      manager,
      access: { get: async () => access, invalidate: () => undefined },
      models: { resolve: async () => testModel(project) },
    })
    const message: UIMessage = {
      id: 'prepare-settlement-failure-message',
      role: 'user',
      parts: [{ type: 'text', text: 'preserve both prepare and settlement failures' }],
    }
    const triggerName = 'test_reject_assistant_prepare_settlement'
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL_REQUIRED')
    const database = await mysql.createConnection(databaseUrl)

    try {
      await database.query(`DROP TRIGGER IF EXISTS ${triggerName}`)
      await database.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON project_agent_turns
        FOR EACH ROW
        BEGIN
          IF NEW.sourceId = 'prepare-settlement-failure-message' AND NEW.status = 'interrupted' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TEST_ASSISTANT_PREPARE_SETTLEMENT_REJECTED';
          END IF;
        END
      `)

      let sendError: unknown = null
      try {
        await service.send({
          projectId: project.id,
          userId: user.id,
          assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
          requestId: randomUUID(),
          sourceId: message.id,
          message,
          context: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
        })
      } catch (error) {
        sendError = error
      }

      expect(sendError).toBeInstanceOf(AggregateError)
      expect(findCarriedFailureRecord(sendError)?.native.message)
        .toContain('NATIVE_THREAD_START_REJECTED')
      expect((sendError as AggregateError).errors.map((error) => String(error)))
        .toEqual(expect.arrayContaining([
          expect.stringContaining('NATIVE_THREAD_START_REJECTED'),
          expect.stringContaining('TEST_ASSISTANT_PREPARE_SETTLEMENT_REJECTED'),
        ]))
      await expect(service.waitForTurnSettlements({
        projectId: project.id,
        userId: user.id,
      })).rejects.toThrow('TEST_ASSISTANT_PREPARE_SETTLEMENT_REJECTED')
      await expect(prisma.projectAgentTurn.findFirstOrThrow({
        where: { sourceId: message.id },
        select: { status: true, failure: true },
      })).resolves.toEqual({ status: 'queued', failure: null })
    } finally {
      await database.query(`DROP TRIGGER IF EXISTS ${triggerName}`)
      await database.end()
      await manager.shutdownAll()
    }
  })

  it('settles an oversize assistant snapshot as one stable failed Turn', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const container = new DeterministicRuntimeContainer()
    const manager = new RuntimeSessionManager({
      container,
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      closePlacementTransportSessions: async () => undefined,
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
    }
    const service = new AssistantRuntimeService({
      manager,
      access: { get: async () => access, invalidate: () => undefined },
      models: { resolve: async () => testModel(project) },
    })
    const message: UIMessage = {
      id: 'user-message-before-oversize-reply',
      role: 'user',
      parts: [{ type: 'text', text: 'produce an intentionally oversize reply' }],
    }

    try {
      const receipt = await service.send({
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        requestId: randomUUID(),
        sourceId: message.id,
        message,
        context: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
      })
      container.failLatestTurnWithAgentMessage('x'.repeat(1_100_000))

      await expect(service.waitForTurnSettlements({
        projectId: project.id,
        userId: user.id,
      })).resolves.toBeUndefined()

      const turn = await prisma.projectAgentTurn.findUniqueOrThrow({
        where: { id: receipt.turnId },
        select: { status: true, assistantMessageId: true, failure: true },
      })
      expect(turn.status).toBe('failed')
      expect(turn.assistantMessageId).toBeNull()
      expect(parseFailureRecord(turn.failure)?.interpretation.code)
        .toBe('ASSISTANT_RUNTIME_MESSAGE_TOO_LARGE')
    } finally {
      await manager.shutdownAll()
    }
  })

  it('settles an accepted user decision when the runtime omits a resolved notification', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const container = new DeterministicRuntimeContainer()
    const manager = new RuntimeSessionManager({
      container,
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      closePlacementTransportSessions: async () => undefined,
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
    }
    const service = new AssistantRuntimeService({
      manager,
      access: { get: async () => access, invalidate: () => undefined },
      models: { resolve: async () => testModel(project) },
    })
    const message: UIMessage = {
      id: 'decision-without-resolution-event',
      role: 'user',
      parts: [{ type: 'text', text: 'ask for an asset decision' }],
    }

    try {
      const receipt = await service.send({
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        requestId: randomUUID(),
        sourceId: message.id,
        message,
        context: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
      })
      container.requestLatestUserDecision()

      const readInteraction = async () => (
        await prisma.agentTurnInteraction.findFirst({
          where: { turnId: receipt.turnId },
          select: { id: true, status: true },
        })
      )
      await expect.poll(readInteraction).toMatchObject({ status: 'pending' })
      const interactionId = (await readInteraction())?.id
      if (!interactionId) throw new Error('TEST_INTERACTION_NOT_PERSISTED')

      await service.respondToServerRequest({
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        threadId: receipt.threadId,
        turnId: receipt.turnId,
        interactionId,
        response: {
          id: 'asset-approval',
          result: { action: 'accept', content: { optionId: 'pause' }, _meta: null },
        },
      })

      await expect(prisma.agentTurnInteraction.findUniqueOrThrow({
        where: { id: interactionId },
        select: { status: true, resolvedAt: true },
      })).resolves.toMatchObject({ status: 'resolved', resolvedAt: expect.any(Date) })
      await expect(prisma.projectAgentTurn.findUniqueOrThrow({
        where: { id: receipt.turnId },
        select: { status: true },
      })).resolves.toEqual({ status: 'running' })
    } finally {
      await manager.shutdownAll()
    }
  })
})
