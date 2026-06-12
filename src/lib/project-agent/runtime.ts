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
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { getProjectModelConfig } from '@/lib/config-service'
import { getRequestId } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import type {
  AgentDebugPartData,
  AgentRuntimeContextPartData,
  ProjectAgentChoiceResolvedPartData,
  ProjectAgentContext,
  ProjectAgentInterruptionPartData,
  ProjectAgentInterruptionResolvedPartData,
  ProjectAgentRunPartData,
  ProjectAgentStopPartData,
} from './types'
import {
  buildProjectAgentSystemPrompt,
  localizeProjectAgentOperationTitle,
  localizeSelectableToolDescription,
} from './copy'
import { normalizeProjectAgentLocale } from './locale'
import type { AssistantPermissionMode } from './permission-mode'
import { compressMessages } from './message-compression'
import { resolveProjectAgentLanguageModel } from './model'
import {
  createProjectAgentWait,
  type ProjectAgentWaitFollowUp,
  type ProjectAgentWaitFollowUpMode,
} from './waits'
import {
  safelyReleaseProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'
import type { EditFirstChoiceContinuation } from './edit-first-choice-continuation'
import type { EditFirstChoiceType } from './choice-card'
import {
  clearProjectAgentInterruptionRunState,
  createProjectAgentApprovalInterruption,
  reopenProjectAgentInterruption,
  type ProjectAgentApprovalInterruptionRecord,
  type SupersededProjectAgentInterruption,
} from './interruptions'
import {
  safelyUpdateProjectAgentRunStatus,
  type ProjectAgentRunRecord,
} from './runs'
import { resolveProjectAgentToolset } from './toolset'
import { createProjectAgentOperationTool } from './agents-tool-adapter'
import {
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
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

/**
 * Control resolved by the route from the structured request body + database.
 * The runtime never infers continuation intent from message history.
 */
export type ProjectAgentResolvedControl =
  | {
    kind: 'user_turn'
    supersededInterruptions: SupersededProjectAgentInterruption[]
  }
  | {
    kind: 'approval'
    interruption: ProjectAgentApprovalInterruptionRecord
    approved: boolean
    reason: string | null
  }
  | {
    kind: 'choice'
    interruptionId: string | null
    choiceType: EditFirstChoiceType
    toolCallId: string | null
    cardId: string | null
    continuation: EditFirstChoiceContinuation
  }
  | {
    kind: 'task_follow_up'
    followUp: ProjectAgentWaitFollowUp
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

function toAgentInputItems(messages: UIMessage[]): AgentInputItem[] {
  const items: AgentInputItem[] = []
  for (const message of messages) {
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

function buildTaskFollowUpInputItem(followUp: ProjectAgentWaitFollowUp): AgentInputItem {
  const lines = [
    '[task_update]',
    `operation=${followUp.operationId}`,
    `status=${followUp.terminalStatus}`,
    `total=${String(followUp.total)} succeeded=${String(followUp.successCount)} failed=${String(followUp.failedCount)}`,
    ...(followUp.failedTaskIds.length > 0 ? [`failedTaskIds=${followUp.failedTaskIds.join(',')}`] : []),
    'Background tasks reached a terminal state. Give the user a short readable summary of the result, then continue with the immediate next injected operation if one exists. Do not re-run the operation that just completed.',
  ]
  return {
    role: 'user',
    content: lines.join('\n'),
  } satisfies AgentInputItem
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

function resolveWaitFollowUpModeForOperations(
  registry: ProjectAgentOperationRegistry,
  operationIds: string[],
): ProjectAgentWaitFollowUpMode {
  if (operationIds.length === 0) return 'resume_agent'
  const allComplete = operationIds.every((operationId) => (
    registry[operationId]?.agentFlow?.onTaskComplete === 'complete'
  ))
  if (allComplete) return 'complete'
  const allAwaitUserChoice = operationIds.every((operationId) => (
    registry[operationId]?.agentFlow?.onTaskComplete === 'await_user_choice'
  ))
  return allAwaitUserChoice ? 'await_user_choice' : 'resume_agent'
}

async function maybeCreateProjectAgentWait(params: {
  stopPart: ProjectAgentStopPartData | null
  registry: ProjectAgentOperationRegistry
  runId: string
  projectId: string
  userId: string
  episodeId: string | null
}): Promise<ProjectAgentWaitFollowUpMode | null> {
  if (!params.stopPart || params.stopPart.reason !== 'awaiting_external_task' || params.stopPart.taskIds.length === 0) {
    return null
  }
  const followUpMode = resolveWaitFollowUpModeForOperations(params.registry, params.stopPart.operationIds)
  await createProjectAgentWait({
    runId: params.runId,
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    assistantId: 'workspace-command',
    operationId: params.stopPart.operationIds.join(','),
    taskIds: params.stopPart.taskIds,
    followUpMode,
  })
  return followUpMode
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
  assistantPermissionMode: AssistantPermissionMode
  run: ProjectAgentRunRecord
  control: ProjectAgentResolvedControl
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

  const control = input.control
  const contextBase = normalizeProjectAgentContext(input.context)
  const context: ProjectAgentContext = {
    ...contextBase,
    runId: input.run.id,
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
  const runtimeMessages = control.kind === 'approval'
    ? normalizedMessages
    : await compressMessages({
        messages: normalizedMessages,
        locale,
        model: resolved.languageModel,
      })

  let runLockReleased = false
  const releaseRunLockOnce = async () => {
    if (!input.runLock || runLockReleased) return
    runLockReleased = true
    await safelyReleaseProjectAgentRunLock(input.runLock)
  }

  const agentDebug = new URL(input.request.url).searchParams.get('agentDebug') === '1'
  const operations = createProjectAgentOperationRegistry()
  const requestId = stableRequestId
  const choiceContinuation = control.kind === 'choice' ? control.continuation : null
  const approvalInterruption = control.kind === 'approval' ? control.interruption : null
  const toolset = resolveProjectAgentToolset({
    registry: operations,
    workflow: phase.editFirstWorkflow,
    context,
    continuationOperationId: choiceContinuation?.operationId ?? null,
    resumeOperationId: approvalInterruption?.operationId ?? null,
    includeChoiceOperation: !choiceContinuation,
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

  const agentInput: AgentInputItem[] = control.kind === 'approval'
    ? []
    : [
        ...toAgentInputItems(runtimeMessages),
        ...(control.kind === 'choice' ? control.continuation.inputItems : []),
        ...(control.kind === 'task_follow_up' ? [buildTaskFollowUpInputItem(control.followUp)] : []),
      ]

  const initialChunks: ProjectAgentUiChunk[] = [
    createDataChunk('data-agent-run', {
      runId: input.run.id,
      requestId,
      status: 'running',
      controlKind: input.run.controlKind,
      stopReason: null,
    } satisfies ProjectAgentRunPartData),
    createDataChunk('data-agent-runtime-context', {
      runtime: 'openai-agents-sdk',
      requestId,
      modelKey: analysisModelKey,
      locale,
      assistantPermissionMode: input.assistantPermissionMode,
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
        resumeOperationId: toolset.resumeOperationId,
        includeChoiceOperation: toolset.includeChoiceOperation,
      },
      editFirstWorkflow: phase.editFirstWorkflow,
      selectedTools: selectedTools.map((item) => ({
        operationId: item.operation.id,
        description: item.description,
      })),
    } satisfies AgentRuntimeContextPartData),
  ]

  if (control.kind === 'approval') {
    initialChunks.push(createDataChunk('data-agent-interruption-resolved', {
      runId: input.run.id,
      interruptionId: control.interruption.id,
      approvalId: control.interruption.approvalId,
      outcome: control.approved ? 'approved' : 'rejected',
    } satisfies ProjectAgentInterruptionResolvedPartData))
  }
  if (control.kind === 'user_turn') {
    for (const superseded of control.supersededInterruptions) {
      initialChunks.push(createDataChunk('data-agent-interruption-resolved', {
        runId: superseded.runId,
        interruptionId: superseded.id,
        approvalId: superseded.approvalId,
        outcome: 'superseded',
      } satisfies ProjectAgentInterruptionResolvedPartData))
    }
  }
  if (control.kind === 'choice') {
    initialChunks.push(createDataChunk('data-assistant-choice-resolved', {
      runId: input.run.id,
      interruptionId: control.interruptionId,
      choiceType: control.choiceType,
      toolCallId: control.toolCallId,
      cardId: control.cardId,
    } satisfies ProjectAgentChoiceResolvedPartData))
  }

  if (agentDebug) {
    initialChunks.push(...createDebugTextChunks([
      '[agentDebug]',
      `requestId=${requestId}`,
      'runtime=openai-agents-sdk',
      `control=${control.kind}`,
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
      control: control.kind,
      editFirstWorkflow: phase.editFirstWorkflow,
      toolset,
    },
  })

  let latestStopPart: ProjectAgentStopPartData | null = null
  const stopController = createProjectAgentStopController()
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
      assistantPermissionMode: input.assistantPermissionMode,
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

  const systemPrompt = buildProjectAgentSystemPrompt({
    locale,
    projectId: input.projectId,
    episodeId: context.episodeId || 'unknown',
    assistantPermissionMode: input.assistantPermissionMode,
  })
  const agent = new Agent<ProjectAgentAgentsRunContext>({
    name: 'Project Workspace Agent',
    instructions: systemPrompt,
    model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
    modelSettings: {
      temperature: 0.2,
    },
    tools,
    toolUseBehavior: (_runContext, toolResults) => {
      const stopPart = stopController.evaluateStep(collectFunctionToolOutputs(toolResults))
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

  const runInput = approvalInterruption
    ? await (async () => {
        const state = await RunState.fromStringWithContext<ProjectAgentAgentsRunContext, Agent<ProjectAgentAgentsRunContext>>(
          agent,
          approvalInterruption.runState,
          runContext,
          { contextStrategy: 'replace' },
        )
        const approvalItem = findApprovalItem(state, approvalInterruption.approvalId)
        if (control.kind === 'approval' && control.approved) {
          state.approve(approvalItem)
        } else {
          state.reject(approvalItem, {
            message: (control.kind === 'approval' ? control.reason : null) || 'PROJECT_AGENT_TOOL_APPROVAL_REJECTED',
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
      toolNames: operationIds,
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
          const approvalId = readApprovalId(approvalItem)
          const operationId = approvalItem.name ?? 'unknown_operation'
          const interruptionId = await createProjectAgentApprovalInterruption({
            runId: input.run.id,
            projectId: input.projectId,
            userId: input.userId,
            episodeId: context.episodeId || null,
            assistantId: 'workspace-command',
            operationId,
            approvalId,
            toolCallId: readApprovalToolCallId(approvalItem),
            runState: result.state.toString(),
          })
          chunks.push(createDataChunk('data-agent-interruption', {
            runId: input.run.id,
            requestId,
            interruptionId,
            approvalId,
            operationId,
            toolCallId: readApprovalToolCallId(approvalItem),
            display: {
              title: localizeProjectAgentOperationTitle(operationId, normalizeProjectAgentLocale(locale)),
              description: toolDescriptions.get(operationId) ?? operationId,
            },
          } satisfies ProjectAgentInterruptionPartData))
          await safelyUpdateProjectAgentRunStatus({
            runId: input.run.id,
            status: 'awaiting_approval',
            stopReason: 'awaiting_approval',
          })
        }

        if (approvalInterruption) {
          await clearProjectAgentInterruptionRunState(approvalInterruption.id)
        }

        const waitFollowUpMode = await maybeCreateProjectAgentWait({
          stopPart: latestStopPart,
          registry: operations,
          runId: input.run.id,
          projectId: input.projectId,
          userId: input.userId,
          episodeId: context.episodeId || null,
        })
        if (latestStopPart) {
          chunks.push(createDataChunk('data-agent-stop', latestStopPart))
        }

        if (completionError && !approvalItem) {
          await safelyUpdateProjectAgentRunStatus({
            runId: input.run.id,
            status: 'failed',
            stopReason: 'completion_error',
            errorCode: 'PROJECT_AGENT_RUN_COMPLETION_FAILED',
            errorMessage: completionError instanceof Error ? completionError.message : String(completionError),
          })
          throw completionError
        }
        if (!approvalItem) {
          if (latestStopPart?.reason === 'awaiting_external_task') {
            await safelyUpdateProjectAgentRunStatus({
              runId: input.run.id,
              status: 'awaiting_task',
              stopReason: waitFollowUpMode === 'await_user_choice' ? 'awaiting_task_then_choice' : 'awaiting_task',
            })
          } else if (latestStopPart?.reason === 'awaiting_user_confirmation') {
            await safelyUpdateProjectAgentRunStatus({
              runId: input.run.id,
              status: 'awaiting_choice',
              stopReason: 'awaiting_user_choice',
            })
          } else if (latestStopPart?.reason === 'tool_error') {
            await safelyUpdateProjectAgentRunStatus({
              runId: input.run.id,
              status: 'failed',
              stopReason: 'tool_error',
              errorCode: latestStopPart.codes[0] ?? 'PROJECT_AGENT_TOOL_ERROR',
              errorMessage: latestStopPart.operationIds.join(','),
            })
          } else {
            await safelyUpdateProjectAgentRunStatus({
              runId: input.run.id,
              status: 'completed',
              stopReason: 'completed',
            })
          }
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
    await safelyUpdateProjectAgentRunStatus({
      runId: input.run.id,
      status: 'failed',
      stopReason: 'run_failed',
      errorCode: 'PROJECT_AGENT_RUN_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    if (approvalInterruption) {
      await reopenProjectAgentInterruption(approvalInterruption.id)
    }
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
