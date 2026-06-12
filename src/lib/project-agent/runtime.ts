import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from 'ai'
import {
  Agent,
  RunContext,
  RunState,
  run,
  type AgentInputItem,
  type FunctionToolResult,
  type RunToolApprovalItem,
  type Tool,
} from '@openai/agents'
import { aisdk } from '@openai/agents-extensions/ai-sdk'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { getProjectModelConfig } from '@/lib/config-service'
import { getRequestId } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import type {
  AgentDebugPartData,
  AgentRuntimeContextPartData,
  ProjectAgentApprovalResponseData,
  ProjectAgentContext,
  ProjectAgentInterruptionPartData,
  ProjectAgentStopPartData,
} from './types'
import { buildProjectAgentSystemPrompt, localizeSelectableToolDescription } from './copy'
import { normalizeProjectAgentLocale } from './locale'
import { compressMessages } from './message-compression'
import { resolveProjectAgentLanguageModel } from './model'
import { createProjectAgentWait } from './waits'
import {
  safelyReleaseProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'
import { resolveEditFirstChoiceContinuation } from './edit-first-choice-continuation'
import { resolveProjectAgentToolset } from './toolset'
import { createProjectAgentOperationTool } from './agents-tool-adapter'
import {
  PROJECT_AGENT_MAX_TURNS,
  buildProjectAgentStopPartFromToolOutputs,
} from './stop-conditions'
import {
  createDataChunk,
  createProjectAgentUiMessageStream,
  type ProjectAgentUiChunk,
} from './agents-ui-stream'
import { resolveProjectPhase } from './project-phase'

type UnknownObject = { [key: string]: unknown }

interface ProjectAgentAgentsRunContext {
  requestId: string
  projectId: string
  userId: string
  locale: string
}

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const projectAgentLogger = createScopedLogger({
  module: 'project-agent.runtime',
})

function normalizeProjectAgentContext(raw: unknown): ProjectAgentContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as UnknownObject
  const locale = typeof record.locale === 'string' ? record.locale.trim() : ''
  const episodeId = typeof record.episodeId === 'string' ? record.episodeId.trim() : ''
  const selectedScopeRef = typeof record.selectedScopeRef === 'string' ? record.selectedScopeRef.trim() : ''
  const selectedPanelId = typeof record.selectedPanelId === 'string' ? record.selectedPanelId.trim() : ''
  const selectedClipId = typeof record.selectedClipId === 'string' ? record.selectedClipId.trim() : ''
  const selectedAssetId = typeof record.selectedAssetId === 'string' ? record.selectedAssetId.trim() : ''
  return {
    ...(locale ? { locale } : {}),
    ...(episodeId ? { episodeId } : {}),
    ...(selectedScopeRef ? { selectedScopeRef } : {}),
    ...(selectedPanelId ? { selectedPanelId } : {}),
    ...(selectedClipId ? { selectedClipId } : {}),
    ...(selectedAssetId ? { selectedAssetId } : {}),
  }
}

function estimateContextTokens(value: unknown): number | null {
  try {
    return Math.ceil(JSON.stringify(value).length / 4)
  } catch {
    return null
  }
}

function readTextFromParts(parts: readonly unknown[]): string {
  return parts.flatMap((part) => {
    if (!isRecord(part)) return []
    if (part.type !== 'text') return []
    const text = part.text
    return typeof text === 'string' && text.trim() ? [text] : []
  }).join('\n')
}

function isProjectAgentRuntimeControlMessage(message: UIMessage): boolean {
  if (message.role !== 'user') return false
  if (!isRecord(message.metadata)) return false
  const custom = message.metadata.custom
  return isRecord(custom) && (
    isRecord(custom.projectAgentChoiceResponse)
    || isRecord(custom.projectAgentApprovalResponse)
  )
}

function toAgentInputItems(messages: UIMessage[]): AgentInputItem[] {
  const items: AgentInputItem[] = []
  for (const message of messages) {
    if (isProjectAgentRuntimeControlMessage(message)) continue
    const text = readTextFromParts(message.parts)
    if (!text.trim()) continue
    if (message.role === 'user') {
      items.push({
        role: 'user',
        content: text,
      } satisfies AgentInputItem)
      continue
    }
    if (message.role === 'assistant') {
      items.push({
        role: 'assistant',
        status: 'completed',
        content: [{
          type: 'output_text',
          text,
        }],
      } satisfies AgentInputItem)
    }
  }
  return items
}

function createDebugTextChunks(text: string): ProjectAgentUiChunk[] {
  return [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'text-start', id: 'agent-debug' },
    { type: 'text-delta', id: 'agent-debug', delta: text },
    { type: 'text-end', id: 'agent-debug' },
    { type: 'finish-step' },
  ].map((chunk) => chunk as unknown as ProjectAgentUiChunk)
}

function collectFunctionToolOutputs(
  toolResults: FunctionToolResult[],
): Array<{ toolName: string; output: unknown }> {
  return toolResults.flatMap((result) => {
    if (result.type !== 'function_output') return []
    return [{
      toolName: result.tool.name,
      output: result.output,
    }]
  })
}

function readApprovalString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const raw = value[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function readApprovalId(item: RunToolApprovalItem): string {
  return readApprovalString(item.rawItem, 'id')
    ?? readApprovalString(item.rawItem, 'callId')
    ?? `${item.name ?? 'tool'}:${crypto.randomUUID()}`
}

function readApprovalToolCallId(item: RunToolApprovalItem): string | null {
  return readApprovalString(item.rawItem, 'callId') ?? readApprovalString(item.rawItem, 'id')
}

function matchesApprovalItem(item: RunToolApprovalItem, approvalId: string): boolean {
  return readApprovalString(item.rawItem, 'id') === approvalId
    || readApprovalString(item.rawItem, 'callId') === approvalId
}

function findApprovalItem(
  state: RunState<ProjectAgentAgentsRunContext, Agent<ProjectAgentAgentsRunContext>>,
  approvalId: string,
): RunToolApprovalItem {
  const approvalItem = state.getInterruptions().find((item) => matchesApprovalItem(item, approvalId))
  if (!approvalItem) {
    throw new Error(`PROJECT_AGENT_APPROVAL_ITEM_NOT_FOUND approvalId=${approvalId}`)
  }
  return approvalItem
}

function createInterruptionPart(params: {
  requestId: string
  runState: string
  approvalItem: RunToolApprovalItem
  toolDescriptions: Map<string, string>
}): ProjectAgentInterruptionPartData {
  const operationId = params.approvalItem.name ?? 'unknown_operation'
  const description = params.toolDescriptions.get(operationId) ?? operationId
  return {
    requestId: params.requestId,
    approvalId: readApprovalId(params.approvalItem),
    operationId,
    runState: params.runState,
    toolCallId: readApprovalToolCallId(params.approvalItem),
    display: {
      title: operationId,
      description,
    },
  }
}

async function maybeCreateProjectAgentWait(params: {
  stopPart: ProjectAgentStopPartData | null
  projectId: string
  userId: string
  episodeId: string | null
}) {
  if (!params.stopPart || params.stopPart.reason !== 'awaiting_external_task' || params.stopPart.taskIds.length === 0) {
    return
  }
  await createProjectAgentWait({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    assistantId: 'workspace-command',
    operationId: params.stopPart.operationIds.join(','),
    taskIds: params.stopPart.taskIds,
  })
}

function buildRunContext(params: {
  requestId: string
  projectId: string
  userId: string
  locale: string
}): RunContext<ProjectAgentAgentsRunContext> {
  return new RunContext<ProjectAgentAgentsRunContext>({
    requestId: params.requestId,
    projectId: params.projectId,
    userId: params.userId,
    locale: params.locale,
  })
}

export async function createProjectAgentChatResponse(input: {
  request: NextRequest
  userId: string
  projectId: string
  context: unknown
  messages: unknown
  approvalResponse?: ProjectAgentApprovalResponseData | null
  runLock?: ProjectAgentRunLock | null
}): Promise<Response> {
  const stableRequestId = getRequestId(input.request) ?? crypto.randomUUID()
  const validation = await safeValidateUIMessages({ messages: input.messages })
  if (!validation.success) {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  const normalizedMessages = validation.data
  if (normalizedMessages.length === 0) {
    throw new Error('PROJECT_AGENT_EMPTY_MESSAGES')
  }

  const projectConfig = await getProjectModelConfig(input.projectId, input.userId)
  const analysisModelKey = projectConfig.analysisModel?.trim() || ''
  if (!analysisModelKey) {
    throw new Error('PROJECT_AGENT_MODEL_NOT_CONFIGURED')
  }

  const contextBase = normalizeProjectAgentContext(input.context)
  const context: ProjectAgentContext = {
    ...contextBase,
  }
  const phase = await resolveProjectPhase({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: context.episodeId || null,
  })
  const resolved = await resolveProjectAgentLanguageModel({
    userId: input.userId,
    analysisModelKey,
  })
  const locale = normalizeProjectAgentLocale(context.locale)
  const runtimeMessages = input.approvalResponse
    ? normalizedMessages
    : await compressMessages({
        messages: normalizedMessages,
        locale,
        model: resolved.languageModel,
      })
  const agentInput = toAgentInputItems(runtimeMessages)

  let runLockReleased = false
  const releaseRunLockOnce = async () => {
    if (!input.runLock || runLockReleased) return
    runLockReleased = true
    await safelyReleaseProjectAgentRunLock(input.runLock)
  }

  const agentDebug = new URL(input.request.url).searchParams.get('agentDebug') === '1'
  const operations = createProjectAgentOperationRegistry()
  const requestId = stableRequestId
  const choiceContinuation = resolveEditFirstChoiceContinuation(runtimeMessages)
  const toolset = resolveProjectAgentToolset({
    registry: operations,
    workflow: phase.editFirstWorkflow,
    context,
    continuationOperationId: choiceContinuation?.operationId ?? null,
  })
  const operationIds = toolset.operationIds
  const selectedTools = operationIds.map((operationId) => {
    const operation = operations[operationId]
    if (!operation) {
      throw new Error(`PROJECT_AGENT_OPERATION_NOT_FOUND operationId=${operationId}`)
    }
    return {
      operation,
      description: localizeSelectableToolDescription(operationId, operation.summary, locale),
    }
  })
  const toolDescriptions = new Map(selectedTools.map((item) => [item.operation.id, item.description]))
  const initialChunks: ProjectAgentUiChunk[] = [
    createDataChunk('data-agent-runtime-context', {
      runtime: 'openai-agents-sdk',
      requestId,
      modelKey: analysisModelKey,
      locale,
      projectId: input.projectId,
      episodeId: context.episodeId || null,
      messageCounts: {
        normalized: normalizedMessages.length,
        runtime: runtimeMessages.length,
        model: agentInput.length,
      },
      contextTokenEstimate: estimateContextTokens(agentInput),
      toolset: {
        source: toolset.source,
        coreOperationIds: toolset.coreOperationIds,
        workflowOperationIds: toolset.workflowOperationIds,
        continuationOperationId: toolset.continuationOperationId,
      },
      editFirstWorkflow: phase.editFirstWorkflow,
      selectedTools: selectedTools.map((item) => ({
        operationId: item.operation.id,
        description: item.description,
      })),
    } satisfies AgentRuntimeContextPartData),
  ]

  if (agentDebug) {
    initialChunks.push(...createDebugTextChunks([
      '[agentDebug]',
      `requestId=${requestId}`,
      'runtime=openai-agents-sdk',
      `toolsetSource=${toolset.source}`,
      `coreTools=${String(toolset.coreOperationIds.length)}`,
      `workflowTools=${String(toolset.workflowOperationIds.length)}`,
      `tools=${String(operationIds.length)}`,
      `editFirstStage=${phase.editFirstWorkflow.stage}`,
      ...(choiceContinuation ? [`choiceContinuation=${choiceContinuation.operationId}`] : []),
    ].join('\n')))
    initialChunks.push(createDataChunk('data-agent-debug', {
      requestId,
      toolsetSource: toolset.source,
      coreOperationIds: toolset.coreOperationIds,
      workflowOperationIds: toolset.workflowOperationIds,
      operationIds,
    } satisfies AgentDebugPartData))
  }

  projectAgentLogger.info({
    action: 'assistant.toolset.resolved',
    message: 'Project agent deterministic toolset resolved',
    requestId,
    projectId: input.projectId,
    userId: input.userId,
    details: {
      runtime: 'openai-agents-sdk',
      editFirstWorkflow: phase.editFirstWorkflow,
      toolset,
    },
  })

  let latestStopPart: ProjectAgentStopPartData | null = null
  const sideChannelChunks: ProjectAgentUiChunk[] = []
  const drainSideChannelChunks = () => sideChannelChunks.splice(0, sideChannelChunks.length)
  const tools: Tool<ProjectAgentAgentsRunContext>[] = selectedTools.map((item) => (
    createProjectAgentOperationTool({
      request: input.request,
      operation: item.operation,
      description: item.description,
      projectId: input.projectId,
      userId: input.userId,
      context,
      writer: {
        write: (chunk) => {
          sideChannelChunks.push(chunk as unknown as ProjectAgentUiChunk)
        },
        merge: () => {
          throw new Error('PROJECT_AGENT_TOOL_WRITER_MERGE_UNSUPPORTED')
        },
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
    }) as Tool<ProjectAgentAgentsRunContext>
  ))

  const baseSystemPrompt = buildProjectAgentSystemPrompt({
    locale,
    projectId: input.projectId,
    episodeId: context.episodeId || 'unknown',
  })
  const systemPrompt = choiceContinuation
    ? `${baseSystemPrompt}\n\n[剪辑先行选择卡续跑指令]\n${choiceContinuation.instruction}`
    : baseSystemPrompt
  const agent = new Agent<ProjectAgentAgentsRunContext>({
    name: 'Project Workspace Agent',
    instructions: systemPrompt,
    model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
    modelSettings: {
      temperature: 0.2,
    },
    tools,
    toolUseBehavior: (_runContext, toolResults) => {
      const stopPart = buildProjectAgentStopPartFromToolOutputs(collectFunctionToolOutputs(toolResults))
      if (!stopPart) {
        return {
          isFinalOutput: false,
          isInterrupted: undefined,
        }
      }
      latestStopPart = stopPart
      return {
        isFinalOutput: true,
        finalOutput: '',
      }
    },
  })
  const runContext = buildRunContext({
    requestId,
    projectId: input.projectId,
    userId: input.userId,
    locale,
  })

  const approvalResponse = input.approvalResponse ?? null
  const runInput = approvalResponse
    ? await (async () => {
        const state = await RunState.fromStringWithContext<ProjectAgentAgentsRunContext, Agent<ProjectAgentAgentsRunContext>>(
          agent,
          approvalResponse.runState,
          runContext,
          { contextStrategy: 'replace' },
        )
        const approvalItem = findApprovalItem(state, approvalResponse.approvalId)
        if (approvalResponse.approved) {
          state.approve(approvalItem)
        } else {
          state.reject(approvalItem, {
            message: approvalResponse.reason || 'PROJECT_AGENT_TOOL_APPROVAL_REJECTED',
          })
        }
        return state
      })()
    : agentInput

  try {
    const result = await run(agent, runInput, {
      stream: true,
      maxTurns: PROJECT_AGENT_MAX_TURNS,
      context: runContext,
      toolNotFoundBehavior: 'raise_error',
    })
    const stream = createProjectAgentUiMessageStream({
      source: result,
      initialChunks,
      drainChunks: drainSideChannelChunks,
      beforeFinish: async () => {
        const chunks: ProjectAgentUiChunk[] = []
        let completionError: unknown = null
        try {
          await result.completed
        } catch (error) {
          completionError = error
        }

        const approvalItem = result.interruptions[0] ?? result.state.getInterruptions()[0] ?? null
        if (approvalItem) {
          chunks.push(createDataChunk('data-agent-interruption', createInterruptionPart({
            requestId,
            runState: result.state.toString(),
            approvalItem,
            toolDescriptions,
          })))
        }

        await maybeCreateProjectAgentWait({
          stopPart: latestStopPart,
          projectId: input.projectId,
          userId: input.userId,
          episodeId: context.episodeId || null,
        })
        if (latestStopPart) {
          chunks.push(createDataChunk('data-agent-stop', latestStopPart))
        }

        if (completionError && !approvalItem) {
          throw completionError
        }
        return chunks
      },
      onSettled: releaseRunLockOnce,
    })
    const response = createUIMessageStreamResponse({ stream })
    response.headers.set('x-request-id', stableRequestId)
    return response
  } catch (error) {
    await releaseRunLockOnce()
    const message = error instanceof Error ? error.message : String(error)
    projectAgentLogger.error({
      action: 'assistant.agents.run.failed',
      message: 'Project agent Agents SDK run failed',
      requestId,
      projectId: input.projectId,
      userId: input.userId,
      details: {
        error: message,
      },
    })
    throw new Error(`PROJECT_AGENT_RUN_FAILED requestId=${requestId}: ${message}`)
  }
}
