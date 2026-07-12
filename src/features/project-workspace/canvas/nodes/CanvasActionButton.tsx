'use client'

import { useState, type ButtonHTMLAttributes } from 'react'
import { useTranslations } from 'next-intl'
import BillingActionButton from '@/components/billing/BillingActionButton'
import type { AppIconName } from '@/components/ui/icons'
import { useWorkspaceCanvasBilling } from '../WorkspaceCanvasBillingContext'
import {
  isWorkspaceCanvasBillableAction,
  useWorkspaceCanvasBillableAction,
} from '../hooks/useWorkspaceCanvasBillableAction'
import type { WorkspaceCanvasNodeAction } from '../node-canvas-types'

interface CanvasActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> {
  readonly action: WorkspaceCanvasNodeAction
  readonly nodeId: string
  readonly icon: AppIconName
  readonly label: string
  readonly tone?: 'primary' | 'secondary'
  readonly loading?: boolean
  readonly onDirectAction: () => Promise<void> | void
}

export function CanvasActionButton({
  action,
  nodeId,
  icon,
  label,
  tone,
  loading = false,
  disabled,
  title,
  onDirectAction,
  ...buttonProps
}: CanvasActionButtonProps) {
  const billing = useWorkspaceCanvasBilling()
  const billingT = useTranslations('assistantAgent')
  const [executing, setExecuting] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const planned = useWorkspaceCanvasBillableAction({
    projectId: billing.projectId,
    episodeId: billing.episodeId,
    action,
    withCredits: (values) => billingT('cards.billingQuoteWithCredits', values),
    withoutCredits: (values) => billingT('cards.billingQuoteWithoutCredits', values),
  })
  const billable = isWorkspaceCanvasBillableAction(action)
  const unavailable = billable && (!planned.plan || !planned.quote || planned.loading || Boolean(planned.error))
  const resolvedTitle = executionError ?? planned.error?.message ?? title

  return (
    <BillingActionButton
      {...buttonProps}
      icon={icon}
      label={label}
      tone={tone}
      quote={planned.quote}
      loading={loading || executing || planned.loading}
      disabled={disabled || executing || unavailable}
      title={resolvedTitle}
      onClick={() => {
        if (!billable) {
          void onDirectAction()
          return
        }
        if (!planned.request || !planned.plan) return
        setExecutionError(null)
        setExecuting(true)
        void billing.execute({
          request: planned.request,
          plan: planned.plan,
          nodeId,
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setExecutionError(message)
          window.alert(message)
        }).finally(() => setExecuting(false))
      }}
    />
  )
}
