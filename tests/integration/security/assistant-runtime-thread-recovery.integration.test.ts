import { randomUUID } from 'node:crypto'
import type { UIMessage } from 'ai'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import { RedisAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { AssistantRuntimeService } from '@/lib/assistant-runtime/service'
import type {
  AssistantRuntimeAccess,
  AssistantRuntimeModelConfiguration,
} from '@/lib/assistant-runtime/runtime-access'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeInitializeResult,
  RuntimeServerRequestResponse,
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
} from '@/lib/codex-runtime/runtime-adapter'
import type {
  RuntimeContainerAdapter,
  RuntimeContainerHandle,
  RuntimeContainerLaunchRequest,
} from '@/lib/codex-runtime/runtime-container'
import {
  RuntimeSessionManager,
  type RuntimeSessionPersistence,
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

  async startThread(_params: RuntimeThreadStartParams): Promise<RuntimeThread> {
    if (this.startThreadFails) throw new Error('NATIVE_THREAD_START_REJECTED')
    return { id: runtimeThreadId, raw: {} }
  }

  async resumeThread(_params: RuntimeThreadResumeParams): Promise<RuntimeThread> {
    throw new Error('NATIVE_THREAD_RESUME_REJECTED')
  }

  async readThread(params: RuntimeThreadReadParams): Promise<RuntimeThread> {
    return { id: params.threadId, raw: {} }
  }

  async listSkills(_params: RuntimeSkillsListParams): Promise<RuntimeSkillsListResponse> {
    return { data: [{ cwd: runtimeWorkspaceDirectory, skills: [], errors: [] }] }
  }

  async startTurn(params: RuntimeTurnStartParams): Promise<RuntimeTurn> {
    this.lastTurnThreadId = params.threadId
    return { id: runtimeTurnId, status: 'inProgress', raw: {} }
  }

  async steerTurn(params: RuntimeTurnSteerParams): Promise<string> {
    return params.expectedTurnId
  }

  async interruptTurn(_params: RuntimeTurnInterruptParams): Promise<void> {}

  async respondToServerRequest(_response: RuntimeServerRequestResponse): Promise<void> {}

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async shutdown(): Promise<void> {
    this.closed = true
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
    for (const listener of this.listeners) listener(event)
  }
}

class DeterministicRuntimeContainer implements RuntimeContainerAdapter {
  private readonly runtimes: DeterministicRuntimeAdapter[] = []

  constructor(private readonly startThreadFails = false) {}

  async reconcile(_scopeId: string): Promise<void> {}

  async launch(_request: RuntimeContainerLaunchRequest): Promise<RuntimeContainerHandle> {
    const runtime = new DeterministicRuntimeAdapter(this.startThreadFails)
    this.runtimes.push(runtime)
    return {
      runtime,
      runtimeWorkspaceDirectory,
      identity: `test-runtime-container-${this.runtimes.length}`,
      stop: async (_mode) => await runtime.shutdown(),
    }
  }

  completeLatestTurn(): void {
    const latest = this.runtimes.at(-1)
    if (!latest) throw new Error('TEST_RUNTIME_NOT_LAUNCHED')
    latest.completeTurn()
  }

  requestLatestUserDecision(): void {
    const latest = this.runtimes.at(-1)
    if (!latest) throw new Error('TEST_RUNTIME_NOT_LAUNCHED')
    latest.requestUserDecision()
  }
}

const testPersistence: RuntimeSessionPersistence = {
  reconcileBeforeStart: async () => undefined,
  materialize: async () => ({ hostWorkspaceDirectory: runtimeWorkspaceDirectory }),
  destroyMaterialization: async () => undefined,
  clearScope: async () => undefined,
}

function testModel(project: { readonly id: string; readonly name: string }): AssistantRuntimeModelConfiguration {
  const projectProductionContext: ProjectProductionContext = {
    schemaVersion: 5,
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

  it('replaces an unresumable native Thread without losing Wao conversation facts', async () => {
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
        messagesJson: [priorMessage] as unknown as Prisma.InputJsonValue,
      },
    })
    const container = new DeterministicRuntimeContainer()
    const manager = new RuntimeSessionManager({
      container,
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
      expiresAtMs: Date.now() + 60_000,
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
      })).resolves.toMatchObject({
        outcome: 'accepted',
        threadId: thread.id,
        runtimeThreadId,
        runtimeTurnId,
      })

      container.completeLatestTurn()
      await service.waitForTurnSettlements({ projectId: project.id, userId: user.id })

      await expect(prisma.projectAssistantThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: { runtimeThreadId: true, messagesJson: true },
      })).resolves.toMatchObject({
        runtimeThreadId,
        messagesJson: expect.arrayContaining([
          priorMessage,
          expect.objectContaining({ id: message.id, role: 'user', parts: message.parts }),
        ]),
      })
      await expect(prisma.projectAgentTurn.count({ where: { threadId: thread.id } }))
        .resolves.toBe(1)
    } finally {
      await manager.shutdownAll()
    }
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
        runtimeThreadId: 'native-still-bound-thread',
        messagesJson: [priorMessage] as unknown as Prisma.InputJsonValue,
      },
    })
    const manager = new RuntimeSessionManager({
      container: new DeterministicRuntimeContainer(true),
      persistence: testPersistence,
      ownership: new RedisAssistantRuntimeOwnership(),
      idleTimeoutMs: 60_000,
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
      expiresAtMs: Date.now() + 60_000,
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
        select: { runtimeThreadId: true, messagesJson: true },
      })).resolves.toMatchObject({
        runtimeThreadId: 'native-still-bound-thread',
        messagesJson: expect.arrayContaining([
          priorMessage,
          expect.objectContaining({ id: message.id, role: 'user', parts: message.parts }),
        ]),
      })
      await expect(prisma.projectAgentTurn.count({ where: { threadId: thread.id } }))
        .resolves.toBe(1)
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
      waitForTurnSettlement: async () => undefined,
      onError: () => undefined,
    })
    const access: AssistantRuntimeAccess = {
      environment: { WAO_MCP_TEST_TOKEN: 'test-token' },
      bearerToken: 'test-token',
      ownerToken: `owner_${randomUUID()}`,
      expiresAtMs: Date.now() + 60_000,
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
