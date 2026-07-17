'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  ProjectAgentPlanItem,
  ProjectAgentPlanSnapshot,
} from '@/lib/project-agent/plan'

function PlanStatusIcon({ item }: { item: ProjectAgentPlanItem }) {
  if (item.status === 'completed') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--glass-text-primary)] text-white">
        <AppIcon name="check" className="h-2.5 w-2.5" aria-hidden="true" />
      </span>
    )
  }
  if (item.status === 'in_progress') {
    return (
      <AppIcon
        name="loader"
        className="h-4 w-4 shrink-0 animate-spin text-[var(--glass-tone-info-fg)]"
        aria-hidden="true"
      />
    )
  }
  return <span className="h-4 w-4 shrink-0 rounded-full border border-[var(--glass-stroke-strong)]" />
}

export function WorkspaceAssistantPlanCard({
  plan,
}: {
  plan: ProjectAgentPlanSnapshot
}) {
  const t = useTranslations('assistantAgent')
  const completedCount = plan.plan.filter((item) => item.status === 'completed').length

  return (
    <section className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/65 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-primary)]">
          <AppIcon name="clipboardCheck" className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('plan.title')}</span>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">
          {t('plan.progress', { completed: completedCount, total: plan.plan.length })}
        </span>
      </div>
      {plan.explanation ? (
        <p className="mt-2 text-[11px] leading-4 text-[var(--glass-text-tertiary)]">
          {plan.explanation}
        </p>
      ) : null}
      <ol className="mt-2.5 space-y-2">
        {plan.plan.map((item, index) => (
          <li
            key={`${index}:${item.step}`}
            className="flex items-start gap-2 text-[12px] leading-4 text-[var(--glass-text-secondary)]"
          >
            <PlanStatusIcon item={item} />
            <span className={item.status === 'completed' ? 'text-[var(--glass-text-tertiary)] line-through' : ''}>
              {item.step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
