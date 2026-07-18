'use client'

import { useEffect, useState } from "react"
import { signIn } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Navbar from "@/components/Navbar"
import GoogleSignInButton from "@/components/auth/GoogleSignInButton"
import PasswordInput from "@/components/auth/PasswordInput"
import PasswordStrengthIndicator from "@/components/auth/PasswordStrengthIndicator"
import { apiFetch } from '@/lib/api-fetch'
import { AUTH_REGISTER_RESULT_CODES, type AuthRegisterResultCode } from '@/lib/auth/register-result-codes'
import { readAuthRegisterResultCode } from '@/lib/auth/register-result-response'
import { isPublicDeploymentFeatures } from '@/lib/deployment/public-client'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'
import { Link, useRouter } from '@/i18n/navigation'
import { AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth/password-policy'

function readServerDetailCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const error = Reflect.get(value, 'error')
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const details = Reflect.get(error, 'details')
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const code = Reflect.get(details, 'code')
  return typeof code === 'string' ? code : null
}

export default function SignUp() {
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [showInviteCodeInput, setShowInviteCodeInput] = useState(false)
  const [inviteCodeRequired, setInviteCodeRequired] = useState(false)
  const [showGoogleOAuth, setShowGoogleOAuth] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const t = useTranslations('auth')

  useEffect(() => {
    let canceled = false

    const loadDeployment = async () => {
      const response = await apiFetch('/api/deployment')
      if (!response.ok) return
      const payload: unknown = await response.json()
      if (
        !canceled
        && payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
      ) {
        const features = Reflect.get(payload, 'features')
        if (isPublicDeploymentFeatures(features)) {
          setShowInviteCodeInput(features.showInviteCode || features.requireInviteCodeOnSignup)
          setInviteCodeRequired(features.requireInviteCodeOnSignup)
          setShowGoogleOAuth(features.showGoogleOAuth)
        }
      }
    }

    void loadDeployment()
    return () => {
      canceled = true
    }
  }, [])

  const resolveRegisterResultMessage = (code: AuthRegisterResultCode): string => {
    switch (code) {
      case AUTH_REGISTER_RESULT_CODES.invalidPayload:
        return t('serverErrors.invalidPayload')
      case AUTH_REGISTER_RESULT_CODES.missingName:
        return t('serverErrors.missingName')
      case AUTH_REGISTER_RESULT_CODES.missingPassword:
        return t('serverErrors.missingPassword')
      case AUTH_REGISTER_RESULT_CODES.passwordTooShort:
        return t('serverErrors.passwordTooShort')
      case AUTH_REGISTER_RESULT_CODES.userExists:
        return t('serverErrors.userExists')
      case AUTH_REGISTER_RESULT_CODES.bodyParseFailed:
        return t('serverErrors.bodyParseFailed')
      case AUTH_REGISTER_RESULT_CODES.rateLimited:
        return t('serverErrors.rateLimited')
      case AUTH_REGISTER_RESULT_CODES.success:
        return t('signupSuccess')
    }
  }

  const resolveSignupErrorMessage = (data: unknown): string => {
    const code = readAuthRegisterResultCode(data)
    if (!code) {
      const detailCode = readServerDetailCode(data)
      if (detailCode === 'INVITE_CODE_REQUIRED') return t('serverErrors.inviteCodeRequired')
      if (detailCode === 'INVITE_CODE_INVALID') return t('serverErrors.inviteCodeInvalid')
      if (detailCode === 'INVITE_CODE_DISABLED') return t('serverErrors.inviteCodeDisabled')
      if (detailCode === 'INVITE_CODE_EXPIRED') return t('serverErrors.inviteCodeExpired')
      if (detailCode === 'INVITE_CODE_EXHAUSTED') return t('serverErrors.inviteCodeExhausted')
      if (detailCode === 'INVITE_CODE_UNAVAILABLE') return t('serverErrors.inviteCodeUnavailable')
      return t('signupFailed')
    }
    return resolveRegisterResultMessage(code)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    if (password !== confirmPassword) {
      setError(t('passwordMismatch'))
      setLoading(false)
      return
    }

    if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(t('passwordTooShort'))
      setLoading(false)
      return
    }

    if (inviteCodeRequired && !inviteCode.trim()) {
      setError(t('serverErrors.inviteCodeRequired'))
      setLoading(false)
      return
    }

    try {
      const payload = {
        name,
        password,
        ...(showInviteCodeInput && inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
      }
      const response = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (response.ok) {
        const loginResult = await signIn('credentials', {
          username: name,
          password,
          redirect: false,
        })

        if (loginResult?.error) {
          setSuccess(t('signupSuccessLoginFallback'))
          setTimeout(() => {
            router.push({ pathname: '/auth/signin' })
          }, 1200)
          return
        }

        setSuccess(t('signupSuccessAutoLogin'))
        router.push(buildAuthenticatedHomeTarget())
        router.refresh()
      } else {
        setError(resolveSignupErrorMessage(data))
      }
    } catch {
      setError(t('signupError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <div className="flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full">
          <div className="glass-surface-modal p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-[var(--glass-text-primary)] mb-2">
                {t('createAccount')}
              </h1>
              <p className="text-[var(--glass-text-secondary)]">{t('joinPlatform')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="glass-field-label block mb-2">
                  {t('phoneNumber')}
                </label>
                <input
                  id="name"
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="glass-input-base w-full px-4 py-3"
                  placeholder={t('phoneNumberPlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="password" className="glass-field-label block mb-2">
                  {t('password')}
                </label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                  required
                  placeholder={t('passwordMinPlaceholder')}
                  showLabel={t('showPassword')}
                  hideLabel={t('hidePassword')}
                />
                <PasswordStrengthIndicator password={password} />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="glass-field-label block mb-2">
                  {t('confirmPassword')}
                </label>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  required
                  placeholder={t('confirmPasswordPlaceholder')}
                  showLabel={t('showPassword')}
                  hideLabel={t('hidePassword')}
                />
              </div>

              {showInviteCodeInput && (
                <div>
                  <label htmlFor="inviteCode" className="glass-field-label block mb-2">
                    {inviteCodeRequired ? t('inviteCode') : t('inviteCodeOptional')}
                  </label>
                  <input
                    id="inviteCode"
                    name="inviteCode"
                    type="text"
                    autoComplete="off"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    required={inviteCodeRequired}
                    className="glass-input-base w-full px-4 py-3"
                    placeholder={inviteCodeRequired ? t('inviteCodePlaceholder') : t('inviteCodeOptionalPlaceholder')}
                  />
                </div>
              )}

              {error && (
                <div className="bg-[var(--glass-tone-danger-bg)] border border-[color:color-mix(in_srgb,var(--glass-tone-danger-fg)_22%,transparent)] text-[var(--glass-tone-danger-fg)] px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {success && (
                <div className="bg-[var(--glass-tone-success-bg)] border border-[color:color-mix(in_srgb,var(--glass-tone-success-fg)_22%,transparent)] text-[var(--glass-tone-success-fg)] px-4 py-3 rounded-lg text-sm">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="glass-btn-base glass-btn-primary w-full py-3 px-4 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? t('signupButtonLoading') : t('signupButton')}
              </button>
            </form>

            {showGoogleOAuth ? (
              <>
                <div className="my-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--glass-border-subtle)]" />
                  <span className="text-xs text-[var(--glass-text-tertiary)]">{t('orContinueWith')}</span>
                  <div className="h-px flex-1 bg-[var(--glass-border-subtle)]" />
                </div>

                <GoogleSignInButton
                  label={t('continueWithGoogle')}
                  loadingLabel={t('googleButtonLoading')}
                  onError={() => setError(t('googleLoginError'))}
                />
              </>
            ) : null}

            <div className="mt-6 text-center">
              <p className="text-[var(--glass-text-secondary)]">
                {t('hasAccount')}{" "}
                <Link href={{ pathname: '/auth/signin' }} className="text-[var(--glass-tone-info-fg)] hover:underline font-medium">
                  {t('signinNow')}
                </Link>
              </p>
            </div>

            <div className="mt-6 text-center">
              <Link href={{ pathname: '/' }} className="text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)] text-sm">
                {t('backToHome')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
