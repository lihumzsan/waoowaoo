'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import { requestOperationMutationVoidWithError } from '@/lib/query/mutations/mutation-shared'
import type { WorkspaceCanvasDeleteOperationView } from '../contracts/workspace-canvas-interactions'

interface PendingCanvasResourceDelete {
  readonly operation: WorkspaceCanvasDeleteOperationView
  readonly targetLabel: string
  readonly requestId: string
}

type CanvasResourceDeletePhase = 'idle' | 'confirming' | 'executing'

/**
 * UI owner for the existing delete_resource Operation. The selected target is
 * frozen when confirmation opens; retry keeps the same Resource identity and
 * request identity, while the mutation receipt owns the Query handoff.
 */
export function useCanvasResourceDeleteAction(params: {
  readonly projectId: string
  readonly onDeleted: (resourceId: string) => void
}) {
  const { projectId, onDeleted } = params
  const t = useTranslations('projectWorkflow.canvas.workspace.operationConfirm')
  const { showError } = useToast()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<CanvasResourceDeletePhase>('idle')
  const [pending, setPending] = useState<PendingCanvasResourceDelete | null>(null)
  const busyRef = useRef(false)

  const begin = useCallback((
    operation: WorkspaceCanvasDeleteOperationView,
    targetLabel: string,
  ) => {
    if (busyRef.current) return
    busyRef.current = true
    setPending({
      operation,
      targetLabel,
      requestId: `delete_resource:${operation.approvalInputHash}:${crypto.randomUUID()}`,
    })
    setPhase('confirming')
  }, [])

  const confirm = useCallback(async () => {
    if (!pending || phase !== 'confirming') return
    try {
      setPhase('executing')
      if (pending.operation.operationId !== 'delete_resource') {
        throw new Error('WORKSPACE_CANVAS_DELETE_OPERATION_INVALID')
      }
      const resourceId = pending.operation.input.resourceId
      await requestOperationMutationVoidWithError(
        `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`,
        {
          method: 'DELETE',
          headers: { 'Idempotency-Key': pending.requestId },
        },
        queryClient,
      )
      onDeleted(resourceId)
      setPending(null)
      setPhase('idle')
      busyRef.current = false
    } catch (error) {
      setPhase('confirming')
      showError(error, t('failed'))
    }
  }, [onDeleted, pending, phase, projectId, queryClient, showError, t])

  const cancel = useCallback(() => {
    if (phase === 'executing') return
    setPending(null)
    setPhase('idle')
    busyRef.current = false
  }, [phase])

  return {
    begin,
    confirm,
    cancel,
    pending,
    phase,
    busy: phase !== 'idle',
  } as const
}
