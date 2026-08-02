'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import type { OperationPlanView } from '@/lib/operations/planning'
import {
  executeApprovedCanvasOperation,
  fetchOperationPlanView,
  issueOperationApprovalGrant,
} from '@/lib/query/operation-plan-client'
import { queryKeys } from '@/lib/query/keys'

export interface CanvasOperationRequest {
  readonly operationId: string
  readonly input: Readonly<Record<string, unknown>>
  readonly confirmation: 'billable_media'
  readonly onAccepted?: (plan: OperationPlanView | null) => void
}

interface PendingCanvasOperation extends CanvasOperationRequest {
  readonly operationRequestId: string
  readonly plan: OperationPlanView
}

type CanvasOperationPhase = 'idle' | 'planning' | 'confirming' | 'executing'

export function useCanvasOperationAction(params: {
  readonly projectId: string
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.operationConfirm')
  const { showError } = useToast()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<CanvasOperationPhase>('idle')
  const [pending, setPending] = useState<PendingCanvasOperation | null>(null)
  const busyRef = useRef(false)

  const context = useMemo(() => ({}), [])

  const begin = useCallback(async (request: CanvasOperationRequest) => {
    if (phase !== 'idle' || busyRef.current) return
    busyRef.current = true
    const operationRequestId = crypto.randomUUID()
    try {
      setPhase('planning')
      const plan = await fetchOperationPlanView({
        projectId: params.projectId,
        operationId: request.operationId,
        input: { ...request.input },
        context,
        operationRequestId,
      })
      setPending({ ...request, operationRequestId, plan })
      setPhase('confirming')
    } catch (error) {
      setPending(null)
      setPhase('idle')
      busyRef.current = false
      showError(error, t('failed'))
    }
  }, [context, params.projectId, phase, showError, t])

  const confirm = useCallback(async () => {
    if (!pending || phase !== 'confirming') return
    try {
      setPhase('executing')
      const grant = await issueOperationApprovalGrant(
        pending.plan,
        pending.operationRequestId,
      )
      await executeApprovedCanvasOperation({
        projectId: params.projectId,
        operationId: pending.operationId,
        input: pending.input,
        context,
        approvalGrantId: grant.approvalGrantId,
        operationRequestId: grant.operationRequestId,
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.workspaceResourcesAll(params.projectId),
      })
      pending.onAccepted?.(pending.plan)
      setPending(null)
      setPhase('idle')
      busyRef.current = false
    } catch (error) {
      // Keep the immutable plan and request identity so a user retry cannot
      // silently approve or execute a different plan.
      setPhase('confirming')
      showError(error, t('failed'))
    }
  }, [context, params.projectId, pending, phase, queryClient, showError, t])

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
