import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { ApiError, normalizeError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { prisma } from '@/lib/prisma'
import { normalizeOperationRuntimeSignal } from '@/lib/project-agent/runtime-signal'
import { createProjectAgentWait } from '@/lib/project-agent/waits'
import { buildProjectAssistantScopeRef } from '@/lib/project-agent/persistence'
import type { ProjectAgentContext, ProjectAssistantId } from '@/lib/project-agent/types'

export type AssistantToolApprovalDecision = 'approve' | 'deny'

export interface AssistantToolApprovalRequest {
  approvalId: string
  decision: AssistantToolApprovalDecision
}

export interface CreateAssistantToolApprovalInput {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  toolCallId: string
  operationId: string
  operationInput: unknown
  context: ProjectAgentContext
}

export interface AssistantToolApprovalResolution {
  approvalId: string
  operationId: string
  toolCallId: string
  output: Record<string, unknown>
}

const ASSISTANT_TOOL_APPROVAL_TTL_MS = 30 * 60 * 1000
const ASSISTANT_TOOL_APPROVAL_ID = 'workspace-command' satisfies ProjectAssistantId

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}

function readJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSISTANT_TOOL_APPROVAL_INPUT_INVALID',
      message: 'stored operation input must be an object',
    })
  }
  return value
}

function hashJson(value: Prisma.InputJsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function buildCancelledOutput(operationId: string): Record<string, unknown> {
  return {
    ok: false,
    operationId,
    error: {
      code: 'OPERATION_CANCELLED',
      message: 'USER_CANCELLED_OPERATION',
      operationId,
      details: null,
    },
  }
}

function buildFailedOutput(operationId: string, error: unknown): Record<string, unknown> {
  const normalized = normalizeError(error)
  const detailCode = typeof normalized.details?.code === 'string' && normalized.details.code.trim()
    ? normalized.details.code.trim()
    : null
  return {
    ok: false,
    operationId,
    error: {
      code: detailCode || normalized.code,
      message: normalized.message,
      operationId,
      details: normalized.details ?? null,
    },
  }
}

function readStoredOutput(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export async function createAssistantToolApproval(
  input: CreateAssistantToolApprovalInput,
): Promise<{ approvalId: string }> {
  const toolCallId = input.toolCallId.trim()
  if (!toolCallId) {
    throw new Error('ASSISTANT_TOOL_APPROVAL_TOOL_CALL_ID_REQUIRED')
  }
  const operationInputJson = toJsonValue(input.operationInput)
  const contextJson = toJsonValue(input.context)
  const assistantId = input.assistantId ?? ASSISTANT_TOOL_APPROVAL_ID
  const episodeId = input.episodeId?.trim() || input.context.episodeId?.trim() || null
  const record = await prisma.assistantToolApproval.create({
    data: {
      projectId: input.projectId,
      userId: input.userId,
      episodeId,
      assistantId,
      scopeRef: buildProjectAssistantScopeRef({ projectId: input.projectId, episodeId }),
      toolCallId,
      operationId: input.operationId,
      operationInputJson,
      operationInputHash: hashJson(operationInputJson),
      contextJson,
      expiresAt: new Date(Date.now() + ASSISTANT_TOOL_APPROVAL_TTL_MS),
    },
    select: { id: true },
  })
  return { approvalId: record.id }
}

export function normalizeAssistantToolApprovalRequest(body: unknown): AssistantToolApprovalRequest {
  if (!isRecord(body)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSISTANT_TOOL_APPROVAL_BODY_INVALID',
      field: 'body',
      message: 'request body must be an object',
    })
  }
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId.trim() : ''
  if (!approvalId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSISTANT_TOOL_APPROVAL_ID_REQUIRED',
      field: 'approvalId',
      message: 'approvalId must be a non-empty string',
    })
  }
  if (body.decision !== 'approve' && body.decision !== 'deny') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSISTANT_TOOL_APPROVAL_DECISION_INVALID',
      field: 'decision',
      message: 'decision must be approve or deny',
    })
  }
  return {
    approvalId,
    decision: body.decision,
  }
}

export async function resolveAssistantToolApproval(input: {
  request: NextRequest
  projectId: string
  userId: string
  approvalId: string
  decision: AssistantToolApprovalDecision
}): Promise<AssistantToolApprovalResolution> {
  const approval = await prisma.assistantToolApproval.findFirst({
    where: {
      id: input.approvalId,
      projectId: input.projectId,
      userId: input.userId,
    },
  })
  if (!approval) {
    throw new ApiError('NOT_FOUND', {
      code: 'ASSISTANT_TOOL_APPROVAL_NOT_FOUND',
      message: 'assistant tool approval not found',
    })
  }

  const storedOutput = readStoredOutput(approval.resultJson)
  if (approval.status === 'consumed' || approval.status === 'denied') {
    if (storedOutput) {
      return {
        approvalId: approval.id,
        operationId: approval.operationId,
        toolCallId: approval.toolCallId,
        output: storedOutput,
      }
    }
    throw new ApiError('CONFLICT', {
      code: 'ASSISTANT_TOOL_APPROVAL_ALREADY_RESOLVED',
      message: 'assistant tool approval has already been resolved',
    })
  }

  if (approval.status !== 'pending') {
    throw new ApiError('CONFLICT', {
      code: 'ASSISTANT_TOOL_APPROVAL_NOT_PENDING',
      message: 'assistant tool approval is not pending',
      status: approval.status,
    })
  }

  if (approval.expiresAt.getTime() <= Date.now()) {
    const expiredOutput = buildFailedOutput(approval.operationId, new ApiError('CONFLICT', {
      code: 'ASSISTANT_TOOL_APPROVAL_EXPIRED',
      message: 'assistant tool approval expired',
    }))
    await prisma.assistantToolApproval.update({
      where: { id: approval.id },
      data: {
        status: 'expired',
        resolvedAt: new Date(),
        resultJson: toJsonValue(expiredOutput),
      },
    })
    return {
      approvalId: approval.id,
      operationId: approval.operationId,
      toolCallId: approval.toolCallId,
      output: expiredOutput,
    }
  }

  if (input.decision === 'deny') {
    const cancelledOutput = buildCancelledOutput(approval.operationId)
    await prisma.assistantToolApproval.update({
      where: { id: approval.id },
      data: {
        status: 'denied',
        resolvedAt: new Date(),
        resultJson: toJsonValue(cancelledOutput),
      },
    })
    return {
      approvalId: approval.id,
      operationId: approval.operationId,
      toolCallId: approval.toolCallId,
      output: cancelledOutput,
    }
  }

  const claimed = await prisma.assistantToolApproval.updateMany({
    where: {
      id: approval.id,
      status: 'pending',
    },
    data: {
      status: 'approved',
      resolvedAt: new Date(),
    },
  })
  if (claimed.count !== 1) {
    throw new ApiError('CONFLICT', {
      code: 'ASSISTANT_TOOL_APPROVAL_CONCURRENT_RESOLUTION',
      message: 'assistant tool approval was resolved by another request',
    })
  }

  const context = isRecord(approval.contextJson) ? approval.contextJson : {}
  const storedInput = readJsonRecord(approval.operationInputJson)
  const confirmedInput = {
    ...storedInput,
    confirmed: true,
  }
  const contextEpisodeId = typeof context.episodeId === 'string' && context.episodeId.trim()
    ? context.episodeId.trim()
    : approval.episodeId
  let output: Record<string, unknown>
  try {
    const data = await executeProjectAgentOperationFromApi({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      operationId: approval.operationId,
      input: confirmedInput,
      context: {
        ...(typeof context.locale === 'string' ? { locale: context.locale } : {}),
        ...(contextEpisodeId ? { episodeId: contextEpisodeId } : {}),
        ...(typeof context.selectedScopeRef === 'string' ? { selectedScopeRef: context.selectedScopeRef } : {}),
        ...(typeof context.selectedPanelId === 'string' ? { selectedPanelId: context.selectedPanelId } : {}),
        ...(typeof context.selectedClipId === 'string' ? { selectedClipId: context.selectedClipId } : {}),
        ...(typeof context.selectedAssetId === 'string' ? { selectedAssetId: context.selectedAssetId } : {}),
      },
      source: 'assistant-confirmation',
    })
    output = {
      ok: true,
      operationId: approval.operationId,
      data,
    }
    const runtimeSignal = normalizeOperationRuntimeSignal({
      toolName: approval.operationId,
      output: {
        ok: true,
        data,
      },
    })
    if (runtimeSignal.kind === 'await_task' && runtimeSignal.taskIds.length > 0) {
      await createProjectAgentWait({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: contextEpisodeId,
        assistantId: ASSISTANT_TOOL_APPROVAL_ID,
        operationId: runtimeSignal.operationId,
        taskIds: runtimeSignal.taskIds,
      })
    }
  } catch (error) {
    output = buildFailedOutput(approval.operationId, error)
  }

  await prisma.assistantToolApproval.update({
    where: { id: approval.id },
    data: {
      status: 'consumed',
      resultJson: toJsonValue(output),
    },
  })

  return {
    approvalId: approval.id,
    operationId: approval.operationId,
    toolCallId: approval.toolCallId,
    output,
  }
}
