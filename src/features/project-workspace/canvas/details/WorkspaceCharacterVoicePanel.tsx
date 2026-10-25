'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'

export function WorkspaceCharacterVoicePanel({
  selection,
  busy,
  onDesignVoice,
}: {
  readonly selection: NonNullable<WorkspaceResourceView['characterVoiceSelection']>
  readonly busy: boolean
  readonly onDesignVoice: (text: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.characterVoice')
  const voiceLabels = useTranslations('projectWorkflow.canvas.workspace.voiceDesign')
  const voice = selection.selectedVoice
  return (
    <section className="min-w-0 space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('title')}</h3>
        <button
          type="button"
          disabled={busy}
          className="glass-btn-base glass-btn-secondary h-8 gap-1.5 px-2.5 text-xs disabled:opacity-50"
          onClick={() => onDesignVoice(t('designRequest'))}
        >
          <AppIcon name="sparkles" className="h-3.5 w-3.5" />
          {t('designVoice')}
        </button>
      </div>
      {voice ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <p className="min-w-0 break-words font-medium text-[var(--glass-text-primary)]">{voice.name}</p>
            {voice.language ? <span className="text-[var(--glass-text-tertiary)]">{voiceLabels(`languages.${voice.language}`)}</span> : null}
          </div>
          {voice.available && voice.url ? (
            <audio src={voice.url} controls preload="metadata" aria-label={voiceLabels('audioLabel', { name: voice.name })} className="nodrag nowheel h-10 w-full min-w-0" />
          ) : null}
          {voice.description ? <p className="whitespace-pre-wrap break-words text-xs leading-5 text-[var(--glass-text-secondary)]">{voice.description}</p> : null}
          <p className={`text-[11px] leading-5 ${voice.available ? 'text-[var(--glass-text-tertiary)]' : 'text-[var(--glass-tone-warning-fg)]'}`}>
            {voice.available ? t('reuseHint') : t('unavailable')}
          </p>
        </>
      ) : (
        <p className="text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('empty')}</p>
      )}
    </section>
  )
}
