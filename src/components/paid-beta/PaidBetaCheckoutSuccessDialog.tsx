'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import PaidBetaGroupAccess from './PaidBetaGroupAccess'

type AccessState = 'not_found' | 'pending' | 'paid'

function readAccessState(payload: unknown): AccessState | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const state = (payload as Record<string, unknown>).state
  return state === 'not_found' || state === 'pending' || state === 'paid' ? state : null
}

export default function PaidBetaCheckoutSuccessDialog({
  providerObjectId,
  onClose,
}: {
  readonly providerObjectId: string | null
  readonly onClose: () => void
}) {
  const t = useTranslations('paidBeta')
  const [state, setState] = useState<AccessState>('pending')

  useEffect(() => {
    if (!providerObjectId) return
    let alive = true
    let timer: number | null = null

    const readStatus = () => {
      void apiFetch(`/api/paid-beta/payment-status?providerObjectId=${encodeURIComponent(providerObjectId)}`)
        .then(async (response) => response.ok ? await response.json() : null)
        .then((payload: unknown) => {
          if (!alive) return
          const next = readAccessState(payload)
          if (next) setState(next)
          if (next !== 'paid') {
            timer = window.setTimeout(readStatus, 2_000)
          }
        })
        .catch(() => {
          if (alive) timer = window.setTimeout(readStatus, 2_000)
        })
    }

    readStatus()
    return () => {
      alive = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [providerObjectId])

  return (
    <GlassModalShell
      open={providerObjectId !== null}
      onClose={onClose}
      size="sm"
      title={state === 'paid' ? undefined : t('confirmingTitle')}
      description={state === 'paid' ? undefined : t('confirmingDescription')}
    >
      {state === 'paid' ? (
        <PaidBetaGroupAccess onDone={onClose} />
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AppIcon name="loader" className="h-8 w-8 animate-spin text-[var(--glass-accent-from)]" aria-hidden="true" />
          <p className="text-[13px] leading-6 text-[var(--glass-text-secondary)]">
            {state === 'not_found' ? t('confirmingNotFound') : t('confirmingBody')}
          </p>
        </div>
      )}
    </GlassModalShell>
  )
}
