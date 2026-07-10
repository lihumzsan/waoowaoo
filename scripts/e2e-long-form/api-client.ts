import { randomUUID } from 'node:crypto'
import type { E2eApprovalAction, E2eChoiceAction } from './types'
import { E2eHttpClient } from './http-client'

interface ProjectResponse {
  readonly project?: {
    readonly id?: string | null
  } | null
}

interface EpisodeResponse {
  readonly episode?: {
    readonly id?: string | null
  } | null
}

function readProjectId(payload: ProjectResponse): string {
  const id = payload.project?.id
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('E2E_API_ID_MISSING:project')
  }
  return id
}

function readEpisodeId(payload: EpisodeResponse): string {
  const id = payload.episode?.id
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('E2E_API_ID_MISSING:episode')
  }
  return id
}

export class E2eApiClient {
  constructor(private readonly http: E2eHttpClient) {}

  async createProject(name: string): Promise<string> {
    const { data } = await this.http.postJson<ProjectResponse>('/api/projects', { name })
    return readProjectId(data)
  }

  async createEpisode(input: {
    readonly projectId: string
    readonly name: string
  }): Promise<string> {
    const { data } = await this.http.postJson<EpisodeResponse>(
      `/api/projects/${encodeURIComponent(input.projectId)}/episodes`,
      { name: input.name },
    )
    return readEpisodeId(data)
  }

  async sendUserMessage(input: {
    readonly projectId: string
    readonly episodeId: string
    readonly text: string
    readonly locale: 'zh' | 'en'
    readonly assistantPermissionMode: 'ask' | 'auto'
  }): Promise<void> {
    await this.http.postStream(`/api/projects/${encodeURIComponent(input.projectId)}/assistant/chat`, {
      message: {
        id: `e2e-user-${randomUUID()}`,
        role: 'user',
        parts: [{ type: 'text', text: input.text }],
      },
      context: { episodeId: input.episodeId },
      episodeId: input.episodeId,
      locale: input.locale,
      assistantPermissionMode: input.assistantPermissionMode,
    })
  }

  async getSessionState(input: {
    readonly projectId: string
    readonly episodeId: string
    readonly locale: 'zh' | 'en'
  }): Promise<unknown> {
    const search = new URLSearchParams({
      episodeId: input.episodeId,
      locale: input.locale,
    })
    const { data } = await this.http.json<unknown>(
      `/api/projects/${encodeURIComponent(input.projectId)}/assistant/session-state?${search.toString()}`,
    )
    return data
  }

  async submitChoice(input: {
    readonly projectId: string
    readonly episodeId: string
    readonly locale: 'zh' | 'en'
    readonly assistantPermissionMode: 'ask' | 'auto'
    readonly visibleUserText: string
    readonly action: E2eChoiceAction
  }): Promise<void> {
    await this.http.postStream(
      `/api/projects/${encodeURIComponent(input.projectId)}/assistant/runs/${encodeURIComponent(input.action.runId)}/choice`,
      {
        context: { episodeId: input.episodeId },
        episodeId: input.episodeId,
        locale: input.locale,
        assistantPermissionMode: input.assistantPermissionMode,
        visibleUserText: input.visibleUserText,
        interruptionId: input.action.interruptionId,
        choiceType: input.action.choiceType,
        toolCallId: input.action.toolCallId,
        output: input.action.output,
      },
    )
  }

  async submitApproval(input: {
    readonly projectId: string
    readonly episodeId: string
    readonly locale: 'zh' | 'en'
    readonly assistantPermissionMode: 'ask' | 'auto'
    readonly action: E2eApprovalAction
  }): Promise<void> {
    await this.http.postStream(
      `/api/projects/${encodeURIComponent(input.projectId)}/assistant/runs/${encodeURIComponent(input.action.runId)}/approval`,
      {
        context: { episodeId: input.episodeId },
        episodeId: input.episodeId,
        locale: input.locale,
        assistantPermissionMode: input.assistantPermissionMode,
        interruptionId: input.action.interruptionId,
        approved: input.action.approved,
        reason: input.action.reason,
      },
    )
  }

}
