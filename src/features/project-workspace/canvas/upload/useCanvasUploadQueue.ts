'use client'

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'
import {
  uploadProjectAssistantMediaAttachment,
  validateProjectAssistantMediaAttachmentFile,
} from '@/lib/project-agent/media-attachments/client'
import { requestOperationMutationWithError } from '@/lib/query/mutations/mutation-shared'

export type CanvasUploadStage =
  | 'uploading'
  | 'materializing'
  | 'ready'
  | 'failed_upload'
  | 'failed_materialize'

export interface CanvasUploadQueueItem {
  readonly id: string
  readonly file: File
  readonly position: { readonly x: number; readonly y: number }
  readonly stage: CanvasUploadStage
  readonly attachment: ProjectAssistantMediaAttachment | null
  readonly materializeRequestId: string | null
  readonly resourceId: string | null
  readonly error: unknown
}

function requireMaterializedResource(value: unknown): { readonly resourceId: string; readonly reused: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CANVAS_UPLOAD_MATERIALIZE_RESPONSE_INVALID')
  }
  const resources = (value as Record<string, unknown>).resources
  if (!Array.isArray(resources) || resources.length !== 1) {
    throw new Error('CANVAS_UPLOAD_MATERIALIZE_RESPONSE_INVALID')
  }
  const resource = resources[0]
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    throw new Error('CANVAS_UPLOAD_MATERIALIZE_RESPONSE_INVALID')
  }
  const resourceId = (resource as Record<string, unknown>).resourceId
  if (typeof resourceId !== 'string' || !resourceId) {
    throw new Error('CANVAS_UPLOAD_MATERIALIZE_RESPONSE_INVALID')
  }
  const reused = (value as Record<string, unknown>).reused
  if (typeof reused !== 'boolean') {
    throw new Error('CANVAS_UPLOAD_MATERIALIZE_RESPONSE_INVALID')
  }
  return { resourceId, reused }
}

export function useCanvasUploadQueue(params: {
  readonly projectId: string
  readonly parentFolderId: string | null
  readonly onMaterialized: (item: CanvasUploadQueueItem, resourceId: string, reused: boolean) => void
}) {
  const { projectId, parentFolderId, onMaterialized } = params
  const queryClient = useQueryClient()
  const [items, setItems] = useState<readonly CanvasUploadQueueItem[]>([])

  const updateItem = useCallback((
    id: string,
    update: (item: CanvasUploadQueueItem) => CanvasUploadQueueItem,
  ) => {
    setItems((current) => current.map((item) => item.id === id ? update(item) : item))
  }, [])

  const materialize = useCallback(async (item: CanvasUploadQueueItem) => {
    const attachmentToken = item.attachment?.attachmentToken
    if (!attachmentToken) throw new Error('CANVAS_UPLOAD_ATTACHMENT_TOKEN_REQUIRED')
    const operationRequestId = item.materializeRequestId ?? crypto.randomUUID()
    updateItem(item.id, (current) => ({
      ...current,
      stage: 'materializing',
      materializeRequestId: operationRequestId,
      error: null,
    }))
    try {
      const data = await requestOperationMutationWithError(
        `/api/projects/${encodeURIComponent(projectId)}/uploaded-media/materialize`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': operationRequestId,
          },
          body: JSON.stringify({
            attachmentToken,
            parentFolderId,
            name: item.file.name,
          }),
        },
        queryClient,
      )
      const { resourceId, reused } = requireMaterializedResource(data)
      const completed = { ...item, stage: 'ready' as const, resourceId, error: null }
      updateItem(item.id, (current) => ({ ...current, ...completed }))
      onMaterialized(completed, resourceId, reused)
    } catch (error) {
      updateItem(item.id, (current) => ({ ...current, stage: 'failed_materialize', error }))
    }
  }, [onMaterialized, parentFolderId, projectId, queryClient, updateItem])

  const upload = useCallback(async (item: CanvasUploadQueueItem) => {
    const validationCode = validateProjectAssistantMediaAttachmentFile(item.file)
    if (validationCode) {
      updateItem(item.id, (current) => ({ ...current, stage: 'failed_upload', error: new Error(validationCode) }))
      return
    }
    updateItem(item.id, (current) => ({ ...current, stage: 'uploading', error: null }))
    try {
      const attachment = await uploadProjectAssistantMediaAttachment({
        projectId,
        file: item.file,
      })
      if (attachment.href?.startsWith('blob:')) URL.revokeObjectURL(attachment.href)
      const uploaded: CanvasUploadQueueItem = {
        ...item,
        attachment: { ...attachment, href: null },
        materializeRequestId: crypto.randomUUID(),
        stage: 'materializing',
        error: null,
      }
      updateItem(item.id, () => uploaded)
      await materialize(uploaded)
    } catch (error) {
      updateItem(item.id, (current) => ({ ...current, stage: 'failed_upload', error }))
    }
  }, [materialize, projectId, updateItem])

  const addFiles = useCallback((
    files: readonly File[],
    position: { readonly x: number; readonly y: number },
  ) => {
    const added = files.map((file, index): CanvasUploadQueueItem => ({
      id: crypto.randomUUID(),
      file,
      position: {
        x: position.x + (index % 3) * 36,
        y: position.y + Math.floor(index / 3) * 36,
      },
      stage: 'uploading',
      attachment: null,
      materializeRequestId: null,
      resourceId: null,
      error: null,
    }))
    setItems((current) => [...current, ...added])
    added.forEach((item) => { void upload(item) })
  }, [upload])

  const retry = useCallback((item: CanvasUploadQueueItem) => {
    if (item.stage === 'failed_materialize' && item.attachment) {
      void materialize(item)
      return
    }
    void upload({
      ...item,
      attachment: null,
      materializeRequestId: null,
      resourceId: null,
    })
  }, [materialize, upload])

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  return { items, addFiles, retry, dismiss } as const
}
