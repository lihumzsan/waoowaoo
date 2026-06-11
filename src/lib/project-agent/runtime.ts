import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  type UIMessage,
  type ToolSet,
  type ToolExecutionOptions,
  type UIMessageStreamWriter,
} from 'ai'
import type { Tool } from '@ai-sdk/provider-utils'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { isConfirmedOperationInput, shouldRequireAssistantConfirmation } from '@/lib/operations/confirmation'
import { getProjectModelConfig } from '@/lib/config-service'
import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
import { writeOperationDataPart } from '@/lib/operations/types'
import { getRequestId } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAgentContext } from './types'
import { resolveProjectPhase } from './project-phase'
import { createProjectAgentStopController } from './stop-conditions'
import type {
  AgentDebugPartData,
  AgentRuntimeContextPartData,
  ProjectAgentStopPartData,
} from './types'
import { buildProjectAgentSystemPrompt, localizeSelectableToolDescription } from './copy'
import { normalizeProjectAgentLocale } from './locale'
import { compressMessages } from './message-compression'
import { resolveProjectAgentLanguageModel } from './model'
import type { ProjectAgentInteractionMode } from './types'
import { resolveProjectAgentExecutionMode } from './execution-mode'
import { createProjectAgentWait } from './waits'
import { stableArgsHash } from './runtime-signal'
import {
  safelyReleaseProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'
import { resolveEditFirstChoiceContinuation } from './edit-first-choice-continuation'
import { resolveProjectAgentToolset } from './toolset'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const projectAgentLogger = createScopedLogger({
  module: 'project-agent.runtime',
})

function writeDebugText(writer: UIMessageStreamWriter<UIMessage>, text: string) {
  writer.write({ type: 'start' })
  writer.write({ type: 'start-step' })
  writer.write({ type: 'text-start', id: 'agent-debug' })
  writer.write({ type: 'text-delta', id: 'agent-debug', delta: text })
  writer.write({ type: 'text-end', id: 'agent-debug' })
  writer.write({ type: 'finish-step' })
}

function normalizeInteractionMode(value: unknown): ProjectAgentInteractionMode | undefined {
  if (value !== 'auto' && value !== 'plan' && value !== 'fast') return undefined
  return value
}

function normalizeProjectAgentContext(raw: unknown): ProjectAgentContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as UnknownObject
  const locale = typeof record.locale === 'string' ? record.locale.trim() : ''
  const episodeId = typeof record.episodeId === 'string' ? record.episodeId.trim() : ''
  const selectedScopeRef = typeof record.selectedScopeRef === 'string' ? record.selectedScopeRef.trim() : ''
  const selectedPanelId = typeof record.selectedPanelId === 'string' ? record.selectedPanelId.trim() : ''
  const selectedClipId = typeof record.selectedClipId === 'string' ? record.selectedClipId.trim() : ''
  const selectedAssetId = typeof record.selectedAssetId === 'string' ? record.selectedAssetId.trim() : ''
  const interactionMode = normalizeInteractionMode(record.interactionMode)
  return {
    ...(locale ? { locale } : {}),
    ...(episodeId ? { episodeId } : {}),
    ...(selectedScopeRef ? { selectedScopeRef } : {}),
    ...(selectedPanelId ? { selectedPanelId } : {}),
    ...(selectedClipId ? { selectedClipId } : {}),
    ...(selectedAssetId ? { selectedAssetId } : {}),
    ...(interactionMode ? { interactionMode } : {}),
  }
}

async function toModelMessages(messages: UIMessage[]) {
  const withoutIds = messages.map((message) => {
    const rest: Omit<UIMessage, 'id'> = {
      role: message.role,
      parts: message.parts,
      ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
    }
    return rest
  })
  return await convertToModelMessages(withoutIds)
}

function estimateContextTokens(value: unknown): number | null {
  try {
    return Math.ceil(JSON.stringify(value).length / 4)
  } catch {
    return null
  }
}

function readNumberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function readUsageTokens(value: unknown): { inputTokens: number | null; outputTokens: number | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      inputTokens: null,
      outputTokens: null,
    }
  }
  const record = value as Record<string, unknown>
  return {
    inputTokens: readNumberField(record, ['inputTokens', 'promptTokens']),
    outputTokens: readNumberField(record, ['outputTokens', 'completionTokens']),
  }
}

function readToolNamesAndHashes(step: unknown): Array<{ toolName: string; argsHash: string }> {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return []
  const record = step as Record<string, unknown>
  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : []
  const toolResults = Array.isArray(record.toolResults) ? record.toolResults : []
  const candidates = toolCalls.length > 0 ? toolCalls : toolResults
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const candidateRecord = candidate as Record<string, unknown>
    const toolName = typeof candidateRecord.toolName === 'string' ? candidateRecord.toolName : ''
    if (!toolName) return []
    return [{
      toolName,
      argsHash: stableArgsHash(candidateRecord.input ?? {}),
    }]
  })
}

export async function createProjectAgentChatResponse(input: {
  request: NextRequest
  userId: string
  projectId: string
  context: unknown
  messages: unknown
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
  const runtimeMessages = await compressMessages({
    messages: normalizedMessages,
    locale,
    model: resolved.languageModel,
  })

  const stream = createUIMessageStream({
    originalMessages: runtimeMessages,
    execute: async ({ writer }) => {
      let runLockReleased = false
      const releaseRunLockOnce = async () => {
        if (!input.runLock || runLockReleased) return
        runLockReleased = true
        await safelyReleaseProjectAgentRunLock(input.runLock)
      }
      const agentDebug = new URL(input.request.url).searchParams.get('agentDebug') === '1'
      const operations = createProjectAgentOperationRegistry()
      const executionMode = resolveProjectAgentExecutionMode({
        interactionMode: context.interactionMode,
      })
      const requestId = stableRequestId
      const choiceContinuation = resolveEditFirstChoiceContinuation(runtimeMessages)
      const toolset = resolveProjectAgentToolset({
        registry: operations,
        workflow: phase.editFirstWorkflow,
        context,
        executionMode,
        continuationOperationId: choiceContinuation?.operationId ?? null,
      })
      const operationIds = toolset.operationIds
      projectAgentLogger.info({
        action: 'assistant.toolset.resolved',
        message: 'Project agent deterministic toolset resolved',
        requestId,
        projectId: input.projectId,
        userId: input.userId,
        details: {
          interactionMode: executionMode.interactionMode,
          effectiveIntent: executionMode.effectiveIntent,
          editFirstWorkflow: phase.editFirstWorkflow,
          toolset,
        },
      })
      const toolEntries = operationIds.map((operationId) => {
        const operation = operations[operationId]
        const description = localizeSelectableToolDescription(operationId, operation.summary, locale)
        const requiresApproval = shouldRequireAssistantConfirmation(operation.confirmation)
        const definition: Tool<unknown, unknown> = {
          description,
          inputSchema: operation.inputSchema,
          ...(requiresApproval ? { needsApproval: true } : {}),
          ...(operationId === 'request_edit_first_choice'
            ? {
                outputSchema: z.unknown(),
                onInputAvailable: async (options: {
                  input: unknown
                  toolCallId: string
                }) => {
                  await executeProjectAgentOperationFromTool({
                    request: input.request,
                    operationId,
                    projectId: input.projectId,
                    userId: input.userId,
                    context,
                    source: 'assistant-panel',
                    writer,
                    input: options.input,
                    toolCallId: options.toolCallId,
                  })
                },
              }
            : {
                execute: async (args: unknown, options?: ToolExecutionOptions) => {
                  const effectiveInput = requiresApproval && !isConfirmedOperationInput(args)
                    ? {
                        ...(isRecord(args) ? args : {}),
                        confirmed: true,
                      }
                    : args
                  return executeProjectAgentOperationFromTool({
                    request: input.request,
                    operationId,
                    projectId: input.projectId,
                    userId: input.userId,
                    context,
                    source: 'assistant-panel',
                    writer,
                    input: effectiveInput,
                    toolCallId: options?.toolCallId,
                  })
                },
              }),
        }
        return {
          entry: [operationId, definition] as const,
          debugTool: {
            operationId,
            description,
          },
        }
      })
      const tools = Object.fromEntries(toolEntries.map((item) => item.entry)) as ToolSet
      const baseSystemPrompt = buildProjectAgentSystemPrompt({
        locale,
        projectId: input.projectId,
        episodeId: context.episodeId || 'unknown',
        interactionMode: executionMode.interactionMode,
      })
      const systemPrompt = choiceContinuation
        ? `${baseSystemPrompt}\n\n[剪辑先行选择卡续跑指令]\n${choiceContinuation.instruction}`
        : baseSystemPrompt
      const modelMessages = await toModelMessages(runtimeMessages)
      writeOperationDataPart<AgentRuntimeContextPartData>(writer, 'data-agent-runtime-context', {
        requestId,
        modelKey: analysisModelKey,
        locale,
        projectId: input.projectId,
        episodeId: context.episodeId || null,
        interactionMode: executionMode.interactionMode,
        messageCounts: {
          normalized: normalizedMessages.length,
          runtime: runtimeMessages.length,
          model: modelMessages.length,
        },
        contextTokenEstimate: estimateContextTokens(modelMessages),
        toolset: {
          source: toolset.source,
          effectiveIntent: toolset.effectiveIntent,
          coreOperationIds: toolset.coreOperationIds,
          workflowOperationIds: toolset.workflowOperationIds,
          continuationOperationId: toolset.continuationOperationId,
        },
        editFirstWorkflow: phase.editFirstWorkflow,
        selectedTools: toolEntries.map((item) => item.debugTool),
      })
      if (agentDebug) {
        writeDebugText(writer, [
          '[agentDebug]',
          `requestId=${requestId}`,
          `interactionMode=${executionMode.interactionMode}`,
          `effectiveIntent=${executionMode.effectiveIntent}`,
          `toolsetSource=${toolset.source}`,
          `coreTools=${String(toolset.coreOperationIds.length)}`,
          `workflowTools=${String(toolset.workflowOperationIds.length)}`,
          `tools=${String(operationIds.length)}`,
          `editFirstStage=${phase.editFirstWorkflow.stage}`,
          ...(choiceContinuation ? [`choiceContinuation=${choiceContinuation.operationId}`] : []),
        ].join('\n'))
        writeOperationDataPart<AgentDebugPartData>(writer, 'data-agent-debug', {
          requestId,
          interactionMode: executionMode.interactionMode,
          effectiveIntent: executionMode.effectiveIntent,
          toolsetSource: toolset.source,
          coreOperationIds: toolset.coreOperationIds,
          workflowOperationIds: toolset.workflowOperationIds,
          operationIds,
        })
      }
      projectAgentLogger.info({
        action: 'assistant.toolset.result',
        message: 'Project agent toolset result',
        requestId,
        projectId: input.projectId,
        userId: input.userId,
        details: {
          interactionMode: executionMode.interactionMode,
          effectiveIntent: executionMode.effectiveIntent,
          toolChannelCount: Object.values(operations).filter((operation) => operation.channels.tool).length,
          editFirstWorkflow: phase.editFirstWorkflow,
          toolset,
          operationIds,
        },
      })
      const stopController = createProjectAgentStopController(tools)

      let result: ReturnType<typeof streamText>
      try {
        result = streamText({
          model: resolved.languageModel,
          system: systemPrompt,
          messages: modelMessages,
          tools,
          stopWhen: stopController.stopWhen,
          experimental_onToolCallStart: ({ toolCall }) => {
            projectAgentLogger.info({
              action: 'assistant.tool.call.start',
              message: 'Project agent tool call started',
              requestId,
              projectId: input.projectId,
              userId: input.userId,
              details: {
                toolName: toolCall.toolName,
              },
            })
          },
          experimental_onToolCallFinish: ({ toolCall, durationMs, success, error }) => {
            projectAgentLogger.info({
              action: 'assistant.tool.call.finish',
              message: 'Project agent tool call finished',
              requestId,
              projectId: input.projectId,
              userId: input.userId,
              details: {
                toolName: toolCall.toolName,
                durationMs,
                success,
                ...(success ? {} : { error: error instanceof Error ? error.message : String(error) }),
              },
            })
          },
          onFinish: async ({ steps }) => {
            try {
              const stopPart = stopController.buildStopPart(steps.length)
              const stopReason = stopPart?.reason ?? null
              steps.forEach((step, stepIndex) => {
                const usage = readUsageTokens((step as Record<string, unknown>).usage)
                const toolCalls = readToolNamesAndHashes(step)
                projectAgentLogger.info({
                  audit: true,
                  action: 'assistant.step.audit',
                  message: 'Project agent step audit',
                  requestId,
                  projectId: input.projectId,
                  userId: input.userId,
                  details: {
                    stepIndex,
                    modelKey: analysisModelKey,
                    finishReason: (step as Record<string, unknown>).finishReason ?? null,
                    toolName: toolCalls.map((toolCall) => toolCall.toolName).join(',') || null,
                    argsHash: toolCalls.map((toolCall) => toolCall.argsHash).join(',') || null,
                    stopReason,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                  },
                })
              })
              if (!stopPart) return
              if (stopPart.reason === 'awaiting_external_task' && stopPart.taskIds.length > 0) {
                await createProjectAgentWait({
                  projectId: input.projectId,
                  userId: input.userId,
                  episodeId: context.episodeId || null,
                  assistantId: 'workspace-command',
                  operationId: stopPart.operationIds.join(','),
                  taskIds: stopPart.taskIds,
                })
              }
              writeOperationDataPart<ProjectAgentStopPartData>(writer, 'data-agent-stop', stopPart)
            } finally {
              await releaseRunLockOnce()
            }
          },
          temperature: 0.2,
        })
      } catch (error) {
        await releaseRunLockOnce()
        const message = error instanceof Error ? error.message : String(error)
        projectAgentLogger.error({
          action: 'assistant.streamText.failed',
          message: 'Project agent streamText failed',
          requestId,
          projectId: input.projectId,
          userId: input.userId,
          details: {
            error: message,
          },
        })
        throw new Error(`PROJECT_AGENT_STREAM_FAILED requestId=${requestId}: ${message}`)
      }

      writer.merge(result.toUIMessageStream({
        originalMessages: runtimeMessages,
        sendReasoning: true,
      }))
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  })

  const response = createUIMessageStreamResponse({ stream })
  response.headers.set('x-request-id', stableRequestId)
  return response
}
