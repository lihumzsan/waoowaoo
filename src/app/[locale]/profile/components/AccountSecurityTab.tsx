'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { parseApiErrorPayload } from '@/lib/api-error-payload'
import { getPathname } from '@/i18n/navigation'

type AccountSecuritySnapshot = {
  email: string | null
  displayName: string
  hasPassword: boolean
  providers: {
    google: {
      linked: boolean
    }
  }
}

type AccountSecurityPayload = {
  security?: AccountSecuritySnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isGoogleProviderState(value: unknown): value is { linked: boolean } {
  return isRecord(value) && typeof value.linked === 'boolean'
}

function isAccountSecuritySnapshot(value: unknown): value is AccountSecuritySnapshot {
  if (!isRecord(value)) return false
  const providers = value.providers
  if (!isRecord(providers)) return false
  return (
    (typeof value.email === 'string' || value.email === null)
    && typeof value.displayName === 'string'
    && typeof value.hasPassword === 'boolean'
    && isGoogleProviderState(providers.google)
  )
}

function isAccountSecurityPayload(value: unknown): value is AccountSecurityPayload {
  return isRecord(value) && (
    value.security === undefined || isAccountSecuritySnapshot(value.security)
  )
}

function readApiFailureReason(payload: unknown, fallback: string): string {
  const parsed = parseApiErrorPayload(payload)
  return parsed.code || parsed.message || fallback
}

export default function AccountSecurityTab() {
  const t = useTranslations('profile.accountSecurity')
  const locale = useLocale()
  const [security, setSecurity] = useState<AccountSecuritySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
  const [bindingGoogle, setBindingGoogle] = useState(false)

  const loadSecurity = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await apiFetch('/api/user/security')
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isAccountSecurityPayload(payload) || !payload.security) {
        throw new Error(readApiFailureReason(payload, `HTTP_${response.status}`))
      }
      setSecurity(payload.security)
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadSecurity()
  }, [loadSecurity])

  const resetPasswordForm = () => {
    setCurrentPassword('')
    setPassword('')
    setPasswordConfirm('')
    setPasswordStatus(null)
  }

  const handleSavePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordStatus(null)

    if (security?.hasPassword && !currentPassword) {
      setPasswordStatus(t('currentPasswordRequired'))
      return
    }
    if (password.length < 6) {
      setPasswordStatus(t('passwordTooShort'))
      return
    }
    if (password !== passwordConfirm) {
      setPasswordStatus(t('passwordMismatch'))
      return
    }

    setSavingPassword(true)
    try {
      const response = await apiFetch('/api/user/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(security?.hasPassword ? { currentPassword } : {}),
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isAccountSecurityPayload(payload) || !payload.security) {
        throw new Error(readApiFailureReason(payload, `HTTP_${response.status}`))
      }
      setSecurity(payload.security)
      resetPasswordForm()
      setPasswordFormOpen(false)
      setPasswordStatus(security?.hasPassword ? t('passwordChanged') : t('passwordSet'))
    } catch (error: unknown) {
      setPasswordStatus(error instanceof Error ? error.message : t('passwordSetFailed'))
    } finally {
      setSavingPassword(false)
    }
  }

  const handleBindGoogle = async () => {
    setBindingGoogle(true)
    try {
      const callbackUrl = getPathname({
        locale,
        href: {
          pathname: '/profile',
          query: { section: 'security' },
        },
      })
      await signIn('google', { callbackUrl })
    } catch {
      setBindingGoogle(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--glass-text-secondary)]">
        {t('loading')}
      </div>
    )
  }

  if (loadError || !security) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <AppIcon name="alert" className="h-10 w-10 text-[var(--glass-tone-danger-fg)]" />
        <p className="text-sm font-medium text-[var(--glass-text-primary)]">{loadError || t('loadFailed')}</p>
        <button
          type="button"
          onClick={() => void loadSecurity()}
          className="glass-btn-secondary rounded-xl px-4 py-2 text-sm"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  const googleLinked = security.providers.google.linked

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
      <section className="glass-surface-soft rounded-2xl border border-[var(--glass-stroke-base)] p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
            <AppIcon name="lock" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
            <p className="text-sm text-[var(--glass-text-tertiary)]">{security.displayName}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--glass-text-primary)]">
              <AppIcon name="user" className="h-4 w-4" />
              {t('email')}
            </div>
            <p className="truncate text-sm text-[var(--glass-text-secondary)]">
              {security.email || t('emailNotBound')}
            </p>
            <span className="mt-3 inline-flex rounded-full bg-[var(--glass-tone-info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--glass-tone-info-fg)]">
              {security.email ? t('bound') : t('notBound')}
            </span>
          </div>

          <div className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--glass-text-primary)]">
              <AppIcon name="chrome" className="h-4 w-4" />
              {t('google')}
            </div>
            <p className="text-sm text-[var(--glass-text-secondary)]">
              {googleLinked ? t('googleBound') : t('googleNotBound')}
            </p>
            {googleLinked ? (
              <span className="mt-3 inline-flex rounded-full bg-[var(--glass-tone-success-bg)] px-2.5 py-1 text-xs font-medium text-[var(--glass-tone-success-fg)]">
                {t('bound')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleBindGoogle()}
                disabled={bindingGoogle}
                className="glass-btn-secondary mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="link" className="h-4 w-4" />
                {bindingGoogle ? t('binding') : t('bindGoogle')}
              </button>
            )}
          </div>

          <div className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--glass-text-primary)]">
              <AppIcon name="lock" className="h-4 w-4" />
              {t('password')}
            </div>
            <p className="text-sm text-[var(--glass-text-secondary)]">
              {security.hasPassword ? t('passwordBound') : t('passwordNotSet')}
            </p>
            <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${security.hasPassword ? 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]' : 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'}`}>
              {security.hasPassword ? t('set') : t('notSet')}
            </span>
            <button
              type="button"
              onClick={() => {
                resetPasswordForm()
                setPasswordFormOpen((open) => !open)
              }}
              className="glass-btn-secondary mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
            >
              <AppIcon name="lock" className="h-4 w-4" />
              {security.hasPassword ? t('changePassword') : t('setLoginPassword')}
            </button>
          </div>
        </div>
      </section>

      {passwordFormOpen ? (
        <section className="glass-surface-soft rounded-2xl border border-[var(--glass-stroke-base)] p-6">
          <h3 className="mb-4 text-base font-semibold text-[var(--glass-text-primary)]">
            {security.hasPassword ? t('changePasswordTitle') : t('setPasswordTitle')}
          </h3>
          <form className="grid gap-4 md:max-w-xl" onSubmit={handleSavePassword}>
            {security.hasPassword ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('currentPassword')}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value)
                    setPasswordStatus(null)
                  }}
                  className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-4 py-3 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-slate-400"
                  placeholder={t('currentPasswordPlaceholder')}
                />
              </label>
            ) : null}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('newPassword')}</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setPasswordStatus(null)
                }}
                className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-4 py-3 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-slate-400"
                placeholder={t('newPasswordPlaceholder')}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('confirmPassword')}</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(event) => {
                  setPasswordConfirm(event.target.value)
                  setPasswordStatus(null)
                }}
                className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-4 py-3 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-slate-400"
                placeholder={t('confirmPasswordPlaceholder')}
              />
            </label>
            <button
              type="submit"
              disabled={savingPassword || !password || !passwordConfirm || (security.hasPassword && !currentPassword)}
              className="glass-btn-base glass-btn-primary inline-flex w-fit items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="lock" className="h-4 w-4" />
              {savingPassword ? t('savingPassword') : security.hasPassword ? t('changePassword') : t('setPassword')}
            </button>
            {passwordStatus ? (
              <p className="text-sm text-[var(--glass-text-secondary)]">{passwordStatus}</p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  )
}
