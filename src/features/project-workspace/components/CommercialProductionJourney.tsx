'use client'

import { useTranslations } from 'next-intl'
import type {
  ProductionJourneyStageView,
  ProductionJourneyView,
} from '@/lib/production-profile'

const COMMERCIAL_STAGE_IDS = [
  'brief',
  'script',
  'direction',
  'assets',
  'video',
  'audio',
  'final',
] as const

type CommercialStageId = (typeof COMMERCIAL_STAGE_IDS)[number]

function isCommercialStageId(value: string): value is CommercialStageId {
  return (COMMERCIAL_STAGE_IDS as readonly string[]).includes(value)
}

function stageTone(status: ProductionJourneyStageView['status']): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700'
    case 'in_progress':
      return 'border-blue-300 bg-blue-50 text-blue-700'
    case 'needs_attention':
      return 'border-amber-300 bg-amber-50 text-amber-700'
    case 'not_started':
      return 'border-[var(--glass-stroke-base)] bg-white/75 text-[var(--glass-text-secondary)]'
  }
}

export default function CommercialProductionJourney({
  journey,
}: {
  readonly journey: ProductionJourneyView | null
}) {
  const t = useTranslations('projectWorkflow.commercialJourney')
  if (!journey || journey.profileId !== 'commercial_video') return null

  return (
    <section className="relative z-20 shrink-0 border-b border-[var(--glass-stroke-base)] bg-white/80 px-4 py-3 backdrop-blur-xl">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
        <p className="text-[10px] text-[var(--glass-text-tertiary)]">{t('description')}</p>
      </div>
      <ol className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {journey.stages.map((stage, index) => {
          if (!isCommercialStageId(stage.id)) return null
          return (
            <li key={stage.id} className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className={`min-w-[84px] flex-1 rounded-xl border px-2.5 py-2 ${stageTone(stage.status)}`}>
                <div className="truncate text-[11px] font-semibold">{t(`stages.${stage.id}`)}</div>
                <div className="mt-0.5 truncate text-[9px] opacity-75">{t(`status.${stage.status}`)}</div>
              </div>
              {index < journey.stages.length - 1 ? (
                <span aria-hidden="true" className="text-[10px] text-[var(--glass-text-tertiary)]">→</span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
