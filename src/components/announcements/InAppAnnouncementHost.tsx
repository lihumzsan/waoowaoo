'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type { AnnouncementPlacement } from '@/lib/announcements/registry'

interface AnnouncementView {
  readonly id: string
  readonly version: number
  readonly surface: 'modal'
  readonly titleKey: string
  readonly bodyKey: string
  readonly actionKey: string
}

function readAnnouncementViews(payload: unknown): readonly AnnouncementView[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const announcements = (payload as Record<string, unknown>).announcements
  if (!Array.isArray(announcements)) return []
  return announcements.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (
      typeof row.id !== 'string'
      || typeof row.version !== 'number'
      || row.surface !== 'modal'
      || typeof row.titleKey !== 'string'
      || typeof row.bodyKey !== 'string'
      || typeof row.actionKey !== 'string'
    ) return []
    return [{
      id: row.id,
      version: row.version,
      surface: row.surface,
      titleKey: row.titleKey,
      bodyKey: row.bodyKey,
      actionKey: row.actionKey,
    }]
  })
}

export default function InAppAnnouncementHost({
  placement,
}: {
  readonly placement: AnnouncementPlacement
}) {
  const t = useTranslations('announcements')
  const [queue, setQueue] = useState<readonly AnnouncementView[]>([])
  const current = queue[0] ?? null

  useEffect(() => {
    let alive = true
    void apiFetch(`/api/announcements?placement=${encodeURIComponent(placement)}`)
      .then(async (response) => response.ok ? await response.json() : null)
      .then((payload: unknown) => {
        if (alive) setQueue(readAnnouncementViews(payload))
      })
      .catch(() => {
        // A missed announcement read does not block the canvas. Because no
        // receipt was written, a later visit can deliver it again.
      })
    return () => {
      alive = false
    }
  }, [placement])

  const acknowledgeCurrent = useCallback(() => {
    if (!current) return
    setQueue((existing) => existing.slice(1))
    void apiFetch(`/api/announcements/${encodeURIComponent(current.id)}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: current.version }),
    }).catch(() => {
      // The user may continue. Without a persisted receipt the announcement
      // intentionally remains eligible on the next canvas visit.
    })
  }, [current])

  return (
    <GlassModalShell
      open={current !== null}
      onClose={acknowledgeCurrent}
      size="sm"
      title={current ? t(current.titleKey) : undefined}
      showCloseButton={false}
      showDividers={false}
      closeOnBackdrop={false}
      closeOnEsc={false}
    >
      {current ? (
        <div className="py-2 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--glass-tone-info-bg)]">
            <AppIcon name="sparkles" className="h-7 w-7 text-[var(--glass-tone-info-fg)]" aria-hidden="true" />
          </span>
          <p className="mx-auto mt-4 max-w-sm text-[14px] leading-7 text-[var(--glass-text-secondary)]">
            {t(current.bodyKey)}
          </p>
          <button
            type="button"
            onClick={acknowledgeCurrent}
            className="glass-btn-base glass-btn-primary mt-6 h-10 w-full rounded-xl text-[13px] font-medium"
          >
            {t(current.actionKey)}
          </button>
        </div>
      ) : null}
    </GlassModalShell>
  )
}
