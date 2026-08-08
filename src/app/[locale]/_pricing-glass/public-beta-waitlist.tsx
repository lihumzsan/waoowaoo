'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-fetch'
import { normalizePhoneNumberForDestination } from '@/lib/auth/phone-number'
import {
  getSmsDestination,
  isSmsDestinationId,
  SMS_DESTINATIONS,
  type SmsDestinationId,
} from '@/lib/auth/sms-destinations'
import { readClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

type WaitlistState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'success'; readonly maskedPhone: string }

function readMaskedPhone(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const maskedPhone = Reflect.get(payload, 'maskedPhone')
  return typeof maskedPhone === 'string' && maskedPhone.trim()
    ? maskedPhone.trim()
    : null
}

export function PublicBetaWaitlistForm() {
  const t = useTranslations('pricing.glass')
  const locale = useLocale()
  const resolveClientError = useClientErrorMessage()
  const [destinationId, setDestinationId] = useState<SmsDestinationId>('CN')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<WaitlistState>({ kind: 'idle' })
  const destination = getSmsDestination(destinationId)

  if (state.kind === 'success') {
    return (
      <div
        role="status"
        className="mt-4 rounded-2xl bg-[var(--glass-tone-success-bg)] px-4 py-3 text-sm leading-6 text-[var(--glass-tone-success-fg)] shadow-[var(--glass-tone-shadow)]"
      >
        {t('waitlistSuccess', { phone: state.maskedPhone })}
      </div>
    )
  }

  const pending = state.kind === 'pending'

  return (
    <form
      className="mt-4 rounded-2xl border border-[var(--glass-stroke-base)] bg-white/70 p-4 shadow-[var(--glass-tone-shadow)]"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending) return

        const normalizedPhone = normalizePhoneNumberForDestination(
          phoneNumber,
          destinationId,
        )
        if (!normalizedPhone) {
          setState({ kind: 'error', message: t('waitlistInvalidPhone') })
          return
        }
        if (!consent) {
          setState({ kind: 'error', message: t('waitlistConsentRequired') })
          return
        }

        setState({ kind: 'pending' })
        try {
          const response = await apiFetch('/api/public-beta/waitlist', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              destinationId,
              phoneNumber: normalizedPhone,
              locale,
              consent: true,
            }),
          })
          if (!response.ok) throw await readClientApiError(response)
          const payload: unknown = await response.json()
          const maskedPhone = readMaskedPhone(payload)
          if (!maskedPhone) throw new Error('PUBLIC_BETA_WAITLIST_RECEIPT_INVALID')
          setState({ kind: 'success', maskedPhone })
        } catch (error) {
          setState({
            kind: 'error',
            message: resolveClientError(error, t('waitlistFailed')),
          })
        }
      }}
    >
      <div>
        <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">
          {t('waitlistTitle')}
        </h3>
        <p className="mt-1 text-xs leading-5 text-[var(--glass-text-secondary)]">
          {t('waitlistDescription')}
        </p>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--glass-text-secondary)]">
          {t('waitlistPhoneLabel')}
        </span>
        <span className="flex h-11 overflow-hidden rounded-xl border border-[var(--glass-stroke-base)] bg-white focus-within:border-[var(--glass-accent-from)]">
          <span className="relative flex w-[74px] shrink-0 items-center justify-center border-r border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)]">
            <span aria-hidden="true" className="text-xs font-medium text-[var(--glass-text-secondary)]">
              +{destination.callingCode}
            </span>
            <select
              aria-label={t('waitlistDestinationLabel')}
              value={destinationId}
              disabled={pending}
              onChange={(event) => {
                if (!isSmsDestinationId(event.target.value)) return
                setDestinationId(event.target.value)
                setPhoneNumber('')
                setState({ kind: 'idle' })
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            >
              {SMS_DESTINATIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  +{option.callingCode}
                </option>
              ))}
            </select>
          </span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phoneNumber}
            disabled={pending}
            required
            onChange={(event) => {
              setPhoneNumber(event.target.value)
              if (state.kind === 'error') setState({ kind: 'idle' })
            }}
            placeholder={t('waitlistPhonePlaceholder')}
            className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[var(--glass-text-primary)] outline-none placeholder:text-[var(--glass-text-tertiary)] disabled:cursor-wait disabled:opacity-60"
          />
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[var(--glass-text-secondary)]">
        <input
          type="checkbox"
          checked={consent}
          disabled={pending}
          required
          onChange={(event) => {
            setConsent(event.target.checked)
            if (state.kind === 'error') setState({ kind: 'idle' })
          }}
          className="mt-1 h-3.5 w-3.5 rounded border-[var(--glass-stroke-base)] text-[var(--glass-accent-from)]"
        />
        <span>{t('waitlistConsent')}</span>
      </label>

      {state.kind === 'error' ? (
        <p role="alert" className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="glass-btn-base glass-btn-primary mt-3 h-10 w-full rounded-xl text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? t('waitlistSubmitting') : t('waitlistSubmit')}
      </button>
    </form>
  )
}
