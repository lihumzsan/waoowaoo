import { readApiErrorMessage } from '@/lib/api/read-error-message'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY,
  readProjectAssistantTextAttachmentsFromMetadata,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'

export const HOME_ASSISTANT_AUTOSTART_QUERY = 'assistantAutoStart' as const
export const HOME_ASSISTANT_AUTOSTART_VALUE = 'home-input' as const

const HOME_ASSISTANT_AUTOSTART_STORAGE_PREFIX = 'waoowaoo:home-assistant-autostart' as const

interface ProjectCreationPayload {
  project?: {
    id?: string | null
  } | null
}

interface EpisodeCreationPayload {
  episode?: {
    id?: string | null
  } | null
}

interface ApiFetchLike {
  (input: string, init?: RequestInit): Promise<Response>
}

export interface HomeWorkspaceLaunchTarget {
  pathname: string
  query: {
    episode: string
    [HOME_ASSISTANT_AUTOSTART_QUERY]: typeof HOME_ASSISTANT_AUTOSTART_VALUE
  }
}

export interface CreateHomeProjectLaunchParams {
  apiFetch: ApiFetchLike
  projectName: string
  storyText: string
  episodeName: string
  hasAssistantDraftContent?: boolean
}

export interface CreateHomeProjectLaunchResult {
  projectId: string
  episodeId: string
  target: HomeWorkspaceLaunchTarget
}

export interface HomeAssistantAutoStartDraft {
  readonly message: string
  readonly attachments: readonly ProjectAssistantTextAttachment[]
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readNestedString(
  source: Record<string, unknown> | null,
  outerKey: string,
  innerKey: string,
): string | null {
  const outer = readObject(source?.[outerKey])
  const value = outer?.[innerKey]
  return typeof value === 'string' && value.trim() ? value : null
}

async function readProjectId(response: Response): Promise<string> {
  const payload = await response.json() as ProjectCreationPayload
  const projectId = readNestedString(readObject(payload), 'project', 'id')
  if (!projectId) {
    throw new Error('Project creation response missing project id')
  }
  return projectId
}

async function readEpisodeId(response: Response): Promise<string> {
  const payload = await response.json() as EpisodeCreationPayload
  const episodeId = readNestedString(readObject(payload), 'episode', 'id')
  if (!episodeId) {
    throw new Error('Episode creation response missing episode id')
  }
  return episodeId
}

export function buildHomeWorkspaceLaunchTarget(projectId: string, episodeId: string): HomeWorkspaceLaunchTarget {
  return {
    pathname: `/workspace/${projectId}`,
    query: {
      episode: episodeId,
      [HOME_ASSISTANT_AUTOSTART_QUERY]: HOME_ASSISTANT_AUTOSTART_VALUE,
    },
  }
}

export function buildHomeAssistantAutoStartStorageKey(projectId: string, episodeId: string): string {
  return `${HOME_ASSISTANT_AUTOSTART_STORAGE_PREFIX}:${projectId}:${episodeId}`
}

export function writeHomeAssistantAutoStartDraft(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly message: string
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
}): void {
  if (typeof window === 'undefined') {
    throw new Error('HOME_ASSISTANT_AUTOSTART_STORAGE_UNAVAILABLE')
  }
  const message = input.message.trim()
  const attachments = input.attachments ?? []
  if (!message && attachments.length === 0) {
    throw new Error('HOME_ASSISTANT_AUTOSTART_DRAFT_EMPTY')
  }
  window.sessionStorage.setItem(
    buildHomeAssistantAutoStartStorageKey(input.projectId, input.episodeId),
    JSON.stringify({
      message,
      attachments,
    } satisfies HomeAssistantAutoStartDraft),
  )
}

function parseHomeAssistantAutoStartDraft(rawValue: string | null): HomeAssistantAutoStartDraft | null {
  if (!rawValue) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawValue)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const message = typeof record.message === 'string' ? record.message.trim() : ''
  const rawAttachments = record.attachments
  const attachments = rawAttachments === undefined
    ? []
    : readProjectAssistantTextAttachmentsFromMetadata({
        custom: {
          [PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY]: rawAttachments,
        },
      })
  return message || attachments.length > 0
    ? { message, attachments }
    : null
}

export function readHomeAssistantAutoStartDraft(projectId: string, episodeId: string): HomeAssistantAutoStartDraft | null {
  if (typeof window === 'undefined') return null
  return parseHomeAssistantAutoStartDraft(
    window.sessionStorage.getItem(buildHomeAssistantAutoStartStorageKey(projectId, episodeId)),
  )
}

export function removeHomeAssistantAutoStartDraft(projectId: string, episodeId: string): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(buildHomeAssistantAutoStartStorageKey(projectId, episodeId))
}

export async function createHomeProjectLaunch({
  apiFetch,
  projectName,
  storyText,
  episodeName,
  hasAssistantDraftContent = false,
}: CreateHomeProjectLaunchParams): Promise<CreateHomeProjectLaunchResult> {
  if (!storyText.trim() && !hasAssistantDraftContent) {
    throw new Error('HOME_ASSISTANT_DRAFT_EMPTY')
  }

  const projectResponse = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
    }),
  })

  if (!projectResponse.ok) {
    throw new Error(await readApiErrorMessage(projectResponse, 'Failed to create project'))
  }

  const projectId = await readProjectId(projectResponse)

  const episodeResponse = await apiFetch(`/api/projects/${projectId}/episodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: episodeName,
    }),
  })

  if (!episodeResponse.ok) {
    throw new Error(await readApiErrorMessage(episodeResponse, 'Failed to create first episode'))
  }

  const episodeId = await readEpisodeId(episodeResponse)

  return {
    projectId,
    episodeId,
    target: buildHomeWorkspaceLaunchTarget(projectId, episodeId),
  }
}
