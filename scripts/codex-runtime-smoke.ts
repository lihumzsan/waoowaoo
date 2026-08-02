import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  captureWorkspaceBundle,
  encodeWorkspaceBundle,
  materializeWorkspaceBundle,
  type WorkspaceBundleV1,
} from '@/lib/codex-runtime/workspace-bundle'
import { LocalRuntimeManager } from '@/lib/codex-runtime/local-runtime-manager'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeJsonObject,
} from '@/lib/codex-runtime/runtime-adapter'
import { WAO_MCP_STAGE_0_OPERATION_IDS } from '@/lib/wao-mcp/operation-catalog'
import { createWaoMcpServer } from '@/lib/wao-mcp/server'

const VALIDATED_CODEX_VERSION = 'codex-cli 0.144.1'
const DEFAULT_MODEL = 'gpt-5.6-sol'
const TURN_TIMEOUT_MS = 180_000

type AppServerSmokeResult = {
  readonly initializedUserAgent: string
  readonly threadId: string
  readonly resumed: boolean
  readonly liveTurn: boolean
  readonly liveTurnStatus: string | null
  readonly streamedText: string
}

function requireObject(value: unknown, label: string): RuntimeJsonObject {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value as RuntimeJsonObject
}

async function runWorkspaceSmoke(rootDir: string): Promise<void> {
  const authoringDir = path.join(rootDir, 'authoring')
  const bundle: WorkspaceBundleV1 = {
    schemaVersion: 1,
    files: [
      {
        path: 'project/brief.md',
        content: '# Runtime smoke\n\nThe Canvas is a projection of this authoring directory.\n',
      },
      {
        path: 'project/resources.json',
        content: '{"resources":[]}',
      },
    ],
  }

  await materializeWorkspaceBundle(authoringDir, bundle)
  const captured = await captureWorkspaceBundle(authoringDir)
  assert.deepEqual(encodeWorkspaceBundle(captured), encodeWorkspaceBundle(bundle))
}

async function runMcpSmoke(): Promise<void> {
  const calls: string[] = []
  const server = createWaoMcpServer({
    executor: {
      execute: async ({ operationId }) => {
        calls.push(operationId)
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
  const client = new Client({ name: 'wao-runtime-smoke', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])
    const listed = await client.listTools()
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      [...WAO_MCP_STAGE_0_OPERATION_IDS],
    )
    const result = await client.callTool({
      name: 'create_image',
      arguments: {},
    })
    assert.equal(result.isError, undefined)
    assert.deepEqual(calls, ['create_image'])
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

  const manager = new LocalRuntimeManager({
    clientInfo: {
      name: 'wao-runtime-smoke',
      title: 'Wao Codex Runtime Smoke',
      version: '0.1.0',
    },
  })
  const runtimeKey = 'stage-0-smoke'
  const cwd = path.join(params.rootDir, 'authoring')
  let streamedText = ''
  let liveTurnStatus: string | null = null

  try {
    const firstRuntime = await manager.ensure({ runtimeKey, cwd })
    const initialized = await firstRuntime.initialize()
    const thread = await firstRuntime.startThread({
      model: process.env.CODEX_RUNTIME_SMOKE_MODEL?.trim() || DEFAULT_MODEL,
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
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
    }

    if (params.liveTurn) {
      await manager.shutdown(runtimeKey)
      const secondRuntime = await manager.ensure({ runtimeKey, cwd })
      const resumed = await secondRuntime.resumeThread({
        threadId: thread.id,
        cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
      })
      assert.equal(resumed.id, thread.id)
    }

    return {
      initializedUserAgent: initialized.userAgent,
      threadId: thread.id,
      resumed: params.liveTurn,
      liveTurn: params.liveTurn,
      liveTurnStatus,
      streamedText,
    }
  } finally {
    await manager.shutdownAll()
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
      mcp: [...WAO_MCP_STAGE_0_OPERATION_IDS],
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
