'use client'

import { useTranslations } from 'next-intl'
import { NovelPromotionClip } from '@/types/project'
import { AppIcon } from '@/components/ui/icons'

interface StoryboardGroupHeaderProps {
  clip: NovelPromotionClip | undefined
  sbIndex: number
  totalStoryboards: number
  movingClipId: string | null
  storyboardClipId: string
  dialogueCompliance: {
    label: string
    title: string
    tone: 'pass' | 'warning' | 'neutral'
  }
  formatClipTitle: (clip: NovelPromotionClip | undefined) => string
  onMoveUp: () => void
  onMoveDown: () => void
}

export default function StoryboardGroupHeader({
  clip,
  sbIndex,
  totalStoryboards,
  movingClipId,
  storyboardClipId,
  dialogueCompliance,
  formatClipTitle,
  onMoveUp,
  onMoveDown,
}: StoryboardGroupHeaderProps) {
  const t = useTranslations('storyboard')
  const dialogueComplianceClass =
    dialogueCompliance.tone === 'pass'
      ? 'border-[var(--glass-stroke-success)] bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
      : dialogueCompliance.tone === 'warning'
        ? 'border-[var(--glass-stroke-warning)] bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
        : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]'

  return (
    <div className="flex items-center gap-4">
      <div className="flex flex-col gap-1">
        <button
          onClick={onMoveUp}
          disabled={sbIndex === 0 || movingClipId === storyboardClipId}
          className={`rounded p-1 transition-colors ${sbIndex === 0 || movingClipId === storyboardClipId
            ? 'cursor-not-allowed text-[var(--glass-text-tertiary)]'
            : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-tone-info-bg)] hover:text-[var(--glass-tone-info-fg)]'
            }`}
          title={t('panel.moveUp')}
        >
          <AppIcon name="chevronUp" className="w-4 h-4" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={sbIndex === totalStoryboards - 1 || movingClipId === storyboardClipId}
          className={`rounded p-1 transition-colors ${sbIndex === totalStoryboards - 1 || movingClipId === storyboardClipId
            ? 'cursor-not-allowed text-[var(--glass-text-tertiary)]'
            : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-tone-info-bg)] hover:text-[var(--glass-tone-info-fg)]'
            }`}
          title={t('panel.moveDown')}
        >
          <AppIcon name="chevronDown" className="w-4 h-4" />
        </button>
      </div>
      <div className="glass-surface-soft flex h-12 w-12 items-center justify-center rounded-2xl text-2xl font-bold text-[var(--glass-tone-info-fg)]">
        {sbIndex + 1}
      </div>
      <div>
        <h3 className="text-sm font-medium text-[var(--glass-text-secondary)]">
          {t('group.segment')}【{formatClipTitle(clip)}】
        </h3>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="line-clamp-1 min-w-0 text-xs text-[var(--glass-text-tertiary)]">{clip?.summary}</p>
          <span
            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] leading-4 ${dialogueComplianceClass}`}
            title={dialogueCompliance.title}
          >
            {dialogueCompliance.label}
          </span>
        </div>
      </div>
    </div>
  )
}
