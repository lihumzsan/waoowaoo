'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import type { OperationPlanView } from '@/lib/operations/planning'
import {
  executePlannedCanvasOperation,
  fetchOperationPlanView,
} from '@/lib/query/operation-plan-client'
import { queryKeys } from '@/lib/query/keys'

export interface CanvasOperationRequest {
  readonly operationId: string
  readonly input: Readonly<Record<string, unknown>>
  readonly confirmation: 'none'
  readonly onAccepted?: (plan: OperationPlanView | null) => void
}

interface PendingCanvasOperation extends CanvasOperationRequest {
  readonly operationRequestId: string
  readonly plan: OperationPlanView
}

type CanvasOperationPhase = 'idle' | 'planning' | 'executing'

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
      if (!plan.planSnapshotId) throw new Error('OPERATION_PLAN_SNAPSHOT_ID_REQUIRED')
      setPending({ ...request, operationRequestId, plan })
      setPhase('executing')
      await executePlannedCanvasOperation({
        projectId: params.projectId,
        operationId: request.operationId,
        input: request.input,
        context,
        planSnapshotId: plan.planSnapshotId,
        operationRequestId,
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.workspaceResourcesAll(params.projectId),
      })
      request.onAccepted?.(plan)
      setPending(null)
      setPhase('idle')
      busyRef.current = false
    } catch (error) {
      setPending(null)
      setPhase('idle')
      busyRef.current = false
      showError(error, t('failed'))
    }
  }, [context, params.projectId, phase, queryClient, showError, t])

  const cancel = useCallback(() => {
    if (phase === 'executing') return
    setPending(null)
    setPhase('idle')
    busyRef.current = false
  }, [phase])

  return {
    begin,
    cancel,
    pending,
    phase,
    busy: phase !== 'idle',
  } as const
}
