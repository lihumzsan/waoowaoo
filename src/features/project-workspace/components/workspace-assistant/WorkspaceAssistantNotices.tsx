import { useTranslations } from 'next-intl'
import type { DataMessagePartProps } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentContextCompactedPartData } from '@/lib/project-agent/types'

type RuntimeGoalPartData = { readonly goal: unknown }
type RuntimeSkillsPartData = {
  readonly changed: boolean
  readonly skills: readonly {
    readonly name: string
    readonly description: string
    readonly enabled: boolean
    readonly scope: 'user' | 'repo' | 'system' | 'admin'
  }[]
  readonly errorCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readGoalStatus(
  status: unknown,
  t: ReturnType<typeof useTranslations<'assistantAgent'>>,
): string | null {
  switch (status) {
    case 'active': return t('runtime.goalStatus.active')
    case 'paused': return t('runtime.goalStatus.paused')
    case 'blocked': return t('runtime.goalStatus.blocked')
    case 'usageLimited': return t('runtime.goalStatus.usageLimited')
    case 'budgetLimited': return t('runtime.goalStatus.budgetLimited')
    case 'complete': return t('runtime.goalStatus.complete')
    default: return null
  }
}

export function AssistantContextCompactedDataCard({
  data,
}: DataMessagePartProps<ProjectAgentContextCompactedPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="flex items-center gap-1.5 border-l-2 border-[var(--glass-text-tertiary)]/30 pl-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      <AppIcon name="alert" className="h-3 w-3 shrink-0 opacity-60" />
      <span className="min-w-0 truncate">
        {data.replacedItemCount > 0
          ? t('cards.contextCompacted', { count: data.replacedItemCount })
          : t('cards.contextCompactedUnknown')}
      </span>
    </div>
  )
}

export function AssistantRuntimeGoalDataCard({ data }: DataMessagePartProps<RuntimeGoalPartData>) {
  const t = useTranslations('assistantAgent')
  if (data.goal === null) return null
  const goal = isRecord(data.goal) ? data.goal : null
  const objective = goal && typeof goal.objective === 'string' ? goal.objective : null
  const status = readGoalStatus(goal?.status, t)
  const tokens = goal && typeof goal.tokensUsed === 'number' ? goal.tokensUsed : null
  const seconds = goal && typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : null
  if (!objective || !status) return null
  return (
    <div className="rounded-xl border border-[var(--glass-stroke-base)] bg-white/70 px-3 py-2 text-xs">
      <div className="font-medium text-[var(--glass-text-secondary)]">{t('runtime.goal')} · {status}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-[var(--glass-text-primary)]">{objective}</div>
      {tokens !== null && seconds !== null ? (
        <div className="mt-1 text-[11px] tabular-nums text-[var(--glass-text-tertiary)]">
          {t('runtime.goalUsage', { tokens, seconds })}
        </div>
      ) : null}
    </div>
  )
}

export function AssistantRuntimeSkillsDataCard({ data }: DataMessagePartProps<RuntimeSkillsPartData>) {
  const t = useTranslations('assistantAgent')
  if (data.errorCount === 0) return null
  return (
    <details className="rounded-xl border border-[var(--glass-stroke-base)] bg-white/70 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-[var(--glass-text-secondary)]">
        {t('runtime.skills.title')} · {t('runtime.skills.count', { count: data.skills.length })}
      </summary>
      {data.changed ? (
        <div className="mt-2 text-[11px] text-[var(--glass-text-tertiary)]">
          {t('runtime.skills.changed')}
        </div>
      ) : null}
      <div className="mt-2 space-y-2">
        {data.skills.map((skill: RuntimeSkillsPartData['skills'][number]) => (
          <div key={`${skill.scope}:${skill.name}`} className={skill.enabled ? '' : 'opacity-55'}>
            <div className="font-medium text-[var(--glass-text-primary)]">
              {skill.name}{skill.enabled ? '' : ` · ${t('runtime.skills.disabled')}`}
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-4 text-[var(--glass-text-tertiary)]">
              {skill.description}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-[var(--glass-tone-warning-fg)]">
        {t('runtime.skills.errors', { count: data.errorCount })}
      </div>
    </details>
  )
}

/** Legacy runtime progress parts can exist in persisted messages, but they are internal telemetry. */
export function AssistantRuntimeProgressDataCard() {
  return null
}

/**
 * Parts the runtime needs in the stream but the reader never should see:
 * approval bookkeeping, runtime context snapshots and already-resolved
 * interruptions. Rendering nothing is the intended behaviour, not a stub.
 */
export function HiddenApprovalRequestDataCard() {
  return null
}

export function HiddenRuntimeContextDataCard() {
  return null
}
