'use client'

import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import type { OperationPlanView } from '@/lib/operations/planning'

export function CanvasOperationConfirmationModal({
  plan,
  destructive,
  destructiveTarget,
  executing,
  onConfirm,
  onCancel,
}: {
  readonly plan: OperationPlanView | null
  readonly destructive: boolean
  readonly destructiveTarget?: string | null
  readonly executing: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.operationConfirm')
  const cost = plan?.quote.showCredits ? plan.quote.totalMaxFrozenCost ?? 0 : null

  return (
    <GlassModalShell
      open
      onClose={onCancel}
      title={destructive ? t('destructiveTitle') : t('title')}
      description={destructive ? t('destructiveDescription') : t('description')}
      size="sm"
      closeOnBackdrop={!executing}
      closeOnEsc={!executing}
      footer={(
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={executing}
            className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
            onClick={onCancel}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={executing}
            className={`glass-btn-base inline-flex items-center gap-2 px-4 py-2 text-sm ${destructive ? 'bg-red-600 text-white hover:bg-red-700' : 'glass-btn-primary'}`}
            onClick={onConfirm}
          >
            {executing ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : null}
            {destructive && executing ? t('deleting') : null}
            {destructive && !executing ? t('confirmDelete') : null}
            {!destructive && executing ? t('executing') : null}
            {!destructive && !executing ? t('confirm') : null}
          </button>
        </div>
      )}
    >
      {plan ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
            <span className="text-sm text-[var(--glass-text-secondary)]">
              {t('taskCount', { count: plan.taskCount })}
            </span>
            <span className="text-sm font-semibold tabular-nums text-[var(--glass-text-primary)]">
              {cost === null ? t('priceHidden') : t('priceCredits', { cost })}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-6 text-[var(--glass-text-secondary)]">
          {t('destructiveBody', { target: destructiveTarget ?? '' })}
        </p>
      )}
    </GlassModalShell>
  )
}
