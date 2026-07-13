import type { NextRequest } from 'next/server'
import { executeProjectAgentCommand, type ProjectAgentCommand } from '@/lib/project-agent/command-service'
import { parseProjectAgentControlAction } from '@/lib/project-agent/control'
import { parseAssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import {
  mapProjectAgentCommandError,
  readProjectAgentCommandEpisodeId,
  readProjectAgentCommandHttpBody,
  readProjectAgentCommandString,
  type ProjectAgentCommandHttpBody,
} from '../../command-http'

type ProjectAgentRunControlKind = 'approval_response' | 'choice_response'

function buildControlPayload(params: {
  kind: ProjectAgentRunControlKind
  runId: string
  body: ProjectAgentCommandHttpBody
}): Record<string, unknown> {
  switch (params.kind) {
    case 'approval_response':
      return {
        type: 'approval_response',
        runId: params.runId,
        interruptionId: params.body.interruptionId,
        approved: params.body.approved,
        reason: params.body.reason,
      }
    case 'choice_response':
      return {
        type: 'choice_response',
        runId: params.runId,
        interruptionId: params.body.interruptionId,
        cardId: params.body.cardId,
        toolCallId: params.body.toolCallId,
        output: params.body.output,
      }
  }
}

function assertNoLegacyMessagesField(body: ProjectAgentCommandHttpBody): void {
  if (Object.prototype.hasOwnProperty.call(body, 'messages')) {
    throw new Error('PROJECT_AGENT_MESSAGES_NOT_ACCEPTED')
  }
}

function buildProjectAgentControlCommand(params: {
  kind: ProjectAgentRunControlKind
  runId: string
  body: ProjectAgentCommandHttpBody
}): ProjectAgentCommand {
  const action = parseProjectAgentControlAction(buildControlPayload(params))
  if (!action) throw new Error('PROJECT_AGENT_CONTROL_INVALID')
  const visibleUserText = readProjectAgentCommandString(params.body.visibleUserText)
  switch (action.type) {
    case 'approval_response':
      return {
        kind: action.type,
        action,
        visibleUserText,
      }
    case 'choice_response':
      return {
        kind: action.type,
        action,
        visibleUserText,
      }
  }
}

export async function handleProjectAgentRunControlRequest(params: {
  request: NextRequest
  projectId: string
  userId: string
  runId: string
  kind: ProjectAgentRunControlKind
}): Promise<Response> {
  try {
    const body = await readProjectAgentCommandHttpBody(params.request)
    assertNoLegacyMessagesField(body)
    return await executeProjectAgentCommand({
      request: params.request,
      scope: {
        projectId: params.projectId,
        userId: params.userId,
        episodeId: readProjectAgentCommandEpisodeId(body),
        assistantId: 'workspace-command',
      },
      context: body.context,
      locale: readProjectAgentCommandString(body.locale),
      assistantPermissionMode: parseAssistantPermissionMode(body.assistantPermissionMode),
      command: buildProjectAgentControlCommand({
        kind: params.kind,
        runId: params.runId,
        body,
      }),
    })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
}
