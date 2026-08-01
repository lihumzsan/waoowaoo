'use client'

import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useToast } from '@/contexts/ToastContext'
import { requestOperationMutationWithError } from '@/lib/query/mutations/mutation-shared'

interface PendingArchiveRequest {
  readonly resourceId: string
  readonly operationRequestId: string
}

export function useCanvasResourceArchive(params: { readonly projectId: string }) {
  const queryClient = useQueryClient()
  const t = useTranslations('projectWorkflow.canvas.workspace.operationConfirm')
  const { showError } = useToast()
  const [pending, setPending] = useState<PendingArchiveRequest | null>(null)
  const [executing, setExecuting] = useState(false)
  const activeRef = useRef(false)

  const execute = useCallback(async (
    resourceId: string,
    archived: boolean,
    operationRequestId: string,
  ) => {
    await requestOperationMutationWithError(
      `/api/projects/${params.projectId}/resources/${resourceId}/archive`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': operationRequestId,
        },
        body: JSON.stringify({ archived }),
      },
      queryClient,
    )
  }, [params.projectId, queryClient])

  const request = useCallback(async (resourceId: string, archived: boolean) => {
    if (activeRef.current) return
    activeRef.current = true
    const operationRequestId = crypto.randomUUID()
    if (archived) {
      setPending({ resourceId, operationRequestId })
      return
    }
    setExecuting(true)
    try {
      await execute(resourceId, false, operationRequestId)
    } catch (error) {
      showError(error, t('failed'))
    } finally {
      setExecuting(false)
      activeRef.current = false
    }
  }, [execute, showError, t])

  const confirm = useCallback(async () => {
    if (!pending || executing) return
    setExecuting(true)
    try {
      await execute(pending.resourceId, true, pending.operationRequestId)
      setPending(null)
      activeRef.current = false
    } catch (error) {
      showError(error, t('failed'))
    } finally {
      setExecuting(false)
    }
  }, [execute, executing, pending, showError, t])

  const cancel = useCallback(() => {
    if (!executing) {
      setPending(null)
      activeRef.current = false
    }
  }, [executing])

  return {
    request,
    confirm,
    cancel,
    pending,
    executing,
    busy: executing || pending !== null,
  } as const
}
