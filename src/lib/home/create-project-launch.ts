import { readClientApiError } from '@/lib/errors/client'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY,
  readProjectAssistantTextAttachmentsFromMetadata,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY,
  readProjectAssistantMediaAttachmentsFromMetadata,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import type { ProjectVideoRatio } from '@/lib/projects/video-ratio'

export const HOME_ASSISTANT_AUTOSTART_QUERY = 'assistantAutoStart' as const
export const HOME_ASSISTANT_AUTOSTART_VALUE = 'home-input' as const

const HOME_ASSISTANT_AUTOSTART_STORAGE_PREFIX = 'waoowaoo:home-assistant-autostart' as const

interface ProjectCreationPayload {
  project?: {
    id?: string | null
  } | null
}

interface ApiFetchLike {
  (input: string, init?: RequestInit): Promise<Response>
}

export type HomeWorkspaceLaunchTarget = string

export interface CreateHomeProjectLaunchParams {
  apiFetch: ApiFetchLike
  projectName: string
  storyText: string
  videoRatio: ProjectVideoRatio
  hasAssistantDraftContent?: boolean
}

export interface CreateHomeProjectLaunchResult {
  projectId: string
  target: HomeWorkspaceLaunchTarget
}

export interface HomeAssistantAutoStartDraft {
  readonly message: string
  readonly attachments: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments: readonly ProjectAssistantMediaAttachment[]
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

async function readHomeProjectLaunchId(response: Response): Promise<string> {
  const payload = await response.json() as ProjectCreationPayload
  const projectId = readNestedString(readObject(payload), 'project', 'id')
  if (!projectId) {
    throw new Error('Project creation response missing project id')
  }
  return projectId
}

export function buildHomeWorkspaceLaunchTarget(projectId: string): HomeWorkspaceLaunchTarget {
  const params = new URLSearchParams({
    [HOME_ASSISTANT_AUTOSTART_QUERY]: HOME_ASSISTANT_AUTOSTART_VALUE,
  })
  return `/workspace/${encodeURIComponent(projectId)}?${params.toString()}`
}

export function buildHomeAssistantAutoStartStorageKey(projectId: string): string {
  return `${HOME_ASSISTANT_AUTOSTART_STORAGE_PREFIX}:${projectId}`
}

export function writeHomeAssistantAutoStartDraft(input: {
  readonly projectId: string
  readonly message: string
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments?: readonly ProjectAssistantMediaAttachment[]
}): void {
  if (typeof window === 'undefined') {
    throw new Error('HOME_ASSISTANT_AUTOSTART_STORAGE_UNAVAILABLE')
  }
  const message = input.message.trim()
  const attachments = input.attachments ?? []
  const mediaAttachments = input.mediaAttachments ?? []
  if (!message && attachments.length === 0 && mediaAttachments.length === 0) {
    throw new Error('HOME_ASSISTANT_AUTOSTART_DRAFT_EMPTY')
  }
  window.sessionStorage.setItem(
    buildHomeAssistantAutoStartStorageKey(input.projectId),
    JSON.stringify({
      message,
      attachments,
      mediaAttachments,
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
  const rawMediaAttachments = record.mediaAttachments
  const mediaAttachments = rawMediaAttachments === undefined
    ? []
    : readProjectAssistantMediaAttachmentsFromMetadata({
        custom: {
          [PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY]: rawMediaAttachments,
        },
      })
  return message || attachments.length > 0 || mediaAttachments.length > 0
    ? { message, attachments, mediaAttachments }
    : null
}

export function readHomeAssistantAutoStartDraft(projectId: string): HomeAssistantAutoStartDraft | null {
  if (typeof window === 'undefined') return null
  return parseHomeAssistantAutoStartDraft(
    window.sessionStorage.getItem(buildHomeAssistantAutoStartStorageKey(projectId)),
  )
}

export function removeHomeAssistantAutoStartDraft(projectId: string): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(buildHomeAssistantAutoStartStorageKey(projectId))
}

export async function createHomeProjectLaunch({
  apiFetch,
  projectName,
  storyText,
  videoRatio,
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
      videoRatio,
    }),
  })

  if (!projectResponse.ok) {
    throw await readClientApiError(projectResponse)
  }

  const projectId = await readHomeProjectLaunchId(projectResponse)

  return {
    projectId,
    target: buildHomeWorkspaceLaunchTarget(projectId),
  }
}
