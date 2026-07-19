'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { getCreativeSkillDefinition } from '@/lib/creative-skills/registry'
import type {
  ProjectAgentSubagentEventPartData,
  ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'

type AssistantAgentTranslator = ReturnType<typeof useTranslations<'assistantAgent'>>

function localizeOutputKind(
  outputKind: ProjectAgentSubagentView['outputKind'],
  t: AssistantAgentTranslator,
): string {
  switch (outputKind) {
    case 'screenplay_draft': return t('subagents.outputKinds.screenplayDraft')
    case 'story_analysis': return t('subagents.outputKinds.storyAnalysis')
    case 'continuity_analysis': return t('subagents.outputKinds.continuityAnalysis')
    case 'asset_prompt_set': return t('subagents.outputKinds.assetPromptSet')
    case 'video_prompt_set': return t('subagents.outputKinds.videoPromptSet')
    case 'music_direction': return t('subagents.outputKinds.musicDirection')
    case 'creative_review': return t('subagents.outputKinds.creativeReview')
  }
}

function localizeEvent(
  part: ProjectAgentSubagentEventPartData,
  locale: 'zh' | 'en',
  t: AssistantAgentTranslator,
): string {
  const event = part.event
  switch (event.kind) {
    case 'started':
      return t('subagents.events.started')
    case 'skills_discovered':
      return t('subagents.events.skillsDiscovered', { count: event.skillIds.length })
    case 'skill_read':
      return t('subagents.events.skillRead', {
        skill: getCreativeSkillDefinition(event.trace.skillId).title[locale],
      })
    case 'completed':
      return t('subagents.events.completed')
    case 'failed':
      return t('subagents.events.failed')
    case 'cancelled':
      return t('subagents.events.cancelled')
  }
}

export function WorkspaceAssistantSubagentDock(props: {
  subagents: readonly ProjectAgentSubagentView[]
  selectedSubagentId: string | null
  onSelect: (subagentId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const selected = props.subagents.find((subagent) => subagent.subagentId === props.selectedSubagentId)
    ?? props.subagents[0]
    ?? null
  if (!selected) return null

  return (
    <section className="shrink-0 border-b border-[var(--glass-stroke-base)] bg-white/72 px-4 pb-3 pt-3 pr-14 backdrop-blur-xl">
      <div
        role="tablist"
        aria-label={t('subagents.tabsLabel')}
        className="flex min-w-0 items-end gap-1 overflow-x-auto"
      >
        {props.subagents.map((subagent) => {
          const active = subagent.subagentId === selected.subagentId
          const title = localizeOutputKind(subagent.outputKind, t)
          return (
            <button
              key={subagent.subagentId}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => props.onSelect(subagent.subagentId)}
              className={`flex min-w-0 max-w-[220px] items-center gap-2 rounded-t-xl border px-3 py-2 text-left transition-colors ${active
                ? 'border-[var(--glass-stroke-base)] border-b-white bg-white text-[var(--glass-text-primary)]'
                : 'border-transparent bg-transparent text-[var(--glass-text-tertiary)] hover:bg-white/70 hover:text-[var(--glass-text-secondary)]'}`}
            >
              <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              <span className="min-w-0 truncate text-[12px] font-medium">{title}</span>
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        className="-mt-px rounded-b-2xl rounded-tr-2xl border border-[var(--glass-stroke-base)] bg-white px-3.5 py-3 shadow-[0_3px_12px_rgba(15,23,42,0.035)]"
      >
        <div className="flex items-start gap-2.5">
          <AppIcon name="brain" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--glass-text-secondary)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12px] font-semibold text-[var(--glass-text-primary)]">
                {localizeOutputKind(selected.outputKind, t)}
              </span>
              <span className="shrink-0 text-[10px] text-[var(--glass-text-tertiary)]">Subagent</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--glass-text-secondary)]">
              {selected.goal}
            </div>
          </div>
        </div>

        <div className="mt-3 max-h-36 space-y-2 overflow-y-auto" aria-live="polite">
          {selected.events.map((event) => {
            return (
              <div key={`${event.subagentId}:${String(event.sequence)}`} className="flex items-start gap-2 text-[11px] leading-4 text-[var(--glass-text-tertiary)]">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                <span className="min-w-0 break-words">{localizeEvent(event, locale, t)}</span>
              </div>
            )
          })}
          <div className="flex items-start gap-2 text-[11px] leading-4 text-[var(--glass-text-secondary)]">
            <AppIcon name="loader" className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
            <span>{t('subagents.events.composing')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function WorkspaceAssistantSubagentSummary(props: {
  subagents: readonly ProjectAgentSubagentView[]
  onSelect: (subagentId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  if (props.subagents.length === 0) return null
  const skillCount = props.subagents.reduce((total, subagent) => total + subagent.skillReads.length, 0)
  return (
    <button
      type="button"
      onClick={() => {
        const first = props.subagents[0]
        if (first) props.onSelect(first.subagentId)
      }}
      className="flex w-full items-center gap-2 rounded-xl border border-[var(--glass-stroke-base)] bg-white/88 px-3 py-2 text-left text-[11px] text-[var(--glass-text-secondary)] shadow-[0_2px_8px_rgba(15,23,42,0.025)] transition-colors hover:bg-white"
    >
      <AppIcon name="usersRound" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t('subagents.runningSummary', { count: props.subagents.length, skills: skillCount })}
      </span>
      <AppIcon name="chevronUp" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
    </button>
  )
}
