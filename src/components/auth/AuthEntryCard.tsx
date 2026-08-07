'use client'

import { useCallback, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import GoogleSignInButton from '@/components/auth/GoogleSignInButton'
import PasswordInput from '@/components/auth/PasswordInput'
import PhoneCaptchaDialog from '@/components/auth/PhoneCaptchaDialog'
import PhoneNumberInput from '@/components/auth/PhoneNumberInput'
import Navbar from '@/components/Navbar'
import { Link, useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import {
  PHONE_AUTH_RESULT_CODES,
  readPhoneAuthResultCode,
} from '@/lib/auth/phone-auth-contract'
import type { PasswordAuthMode } from '@/lib/auth/password-auth-contract'
import { AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth/password-policy'
import { normalizePhoneNumberForDestination } from '@/lib/auth/phone-number'
import type { SmsDestinationId } from '@/lib/auth/sms-destinations'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

interface AuthEntryCardProps {
  features: Pick<
    PublicDeploymentFeatures,
    | 'enablePhoneAuth'
    | 'enablePasswordAuth'
    | 'passwordAuthIdentity'
    | 'showGoogleOAuth'
  >
}

type PendingAction = 'send-code' | 'submit' | null

interface ImageCaptchaPayload {
  captchaId: string
  imageDataUrl: string
}

function readImageCaptchaPayload(payload: unknown): ImageCaptchaPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const captchaId = Reflect.get(payload, 'captchaId')
  const imageDataUrl = Reflect.get(payload, 'imageDataUrl')
  if (typeof captchaId !== 'string' || !captchaId) return null
  if (
    typeof imageDataUrl !== 'string'
    || !imageDataUrl.startsWith('data:image/svg+xml;base64,')
  ) {
    return null
  }
  return { captchaId, imageDataUrl }
}

export default function AuthEntryCard({ features }: AuthEntryCardProps) {
  const [destinationId, setDestinationId] = useState<SmsDestinationId>('CN')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaImageDataUrl, setCaptchaImageDataUrl] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [captchaDialogOpen, setCaptchaDialogOpen] = useState(false)
  const [captchaError, setCaptchaError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [authMode, setAuthMode] = useState<PasswordAuthMode>('login')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const router = useRouter()
  const t = useTranslations('auth')

  const resolvePhoneNumber = () => normalizePhoneNumberForDestination(
    phoneNumber,
    destinationId,
  )

  const loadImageCaptcha = useCallback(async (clearError: boolean) => {
    if (clearError) setCaptchaError('')
    setCaptchaId('')
    setCaptchaAnswer('')
    setCaptchaImageDataUrl('')
    setCaptchaLoading(true)
    try {
      const response = await apiFetch('/api/auth/phone/captcha', {
        method: 'POST',
      })
      const payload: unknown = await response.json()
      const captcha = response.ok ? readImageCaptchaPayload(payload) : null
      if (!captcha) {
        setCaptchaError(t('imageCaptchaUnavailable'))
        return
      }
      setCaptchaId(captcha.captchaId)
      setCaptchaImageDataUrl(captcha.imageDataUrl)
      setCaptchaAnswer('')
    } catch {
      setCaptchaError(t('imageCaptchaUnavailable'))
    } finally {
      setCaptchaLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  const finishAuthentication = () => {
    router.push(buildAuthenticatedHomeTarget())
    router.refresh()
  }

  const resolveSendCodeError = (payload: unknown): string => {
    const code = readPhoneAuthResultCode(payload)
    switch (code) {
      case PHONE_AUTH_RESULT_CODES.invalidPhone:
        return t('phoneInvalid')
      case PHONE_AUTH_RESULT_CODES.sendRateLimited:
        return t('sendRateLimited')
      case PHONE_AUTH_RESULT_CODES.providerRejected:
        return t('smsProviderRejected')
      case PHONE_AUTH_RESULT_CODES.destinationUnavailable:
        return t('smsDestinationUnavailable')
      case PHONE_AUTH_RESULT_CODES.providerUnavailable:
        return t('smsProviderUnavailable')
      case PHONE_AUTH_RESULT_CODES.humanVerificationInvalid:
        return t('imageCaptchaInvalid')
      case PHONE_AUTH_RESULT_CODES.humanVerificationUnavailable:
        return t('imageCaptchaUnavailable')
      case PHONE_AUTH_RESULT_CODES.featureDisabled:
        return t('authUnavailable')
      case PHONE_AUTH_RESULT_CODES.bodyParseFailed:
      case PHONE_AUTH_RESULT_CODES.verificationInvalid:
      case PHONE_AUTH_RESULT_CODES.codeSent:
      case null:
        return t('sendCodeFailed')
    }
  }

  const handleSendCode = async () => {
    if (pendingAction || resendSeconds > 0) return
    const normalizedPhoneNumber = resolvePhoneNumber()
    if (!normalizedPhoneNumber) {
      setCaptchaDialogOpen(false)
      setError(t('phoneInvalid'))
      return
    }
    if (!captchaId || captchaAnswer.length !== 4) {
      setCaptchaError(t('imageCaptchaRequired'))
      return
    }
    setPendingAction('send-code')
    setCaptchaError('')
    setNotice('')

    try {
      const response = await apiFetch('/api/auth/phone/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: normalizedPhoneNumber,
          captchaId,
          captchaAnswer,
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const code = readPhoneAuthResultCode(payload)
        const message = resolveSendCodeError(payload)
        if (
          code === PHONE_AUTH_RESULT_CODES.humanVerificationInvalid
          || code === PHONE_AUTH_RESULT_CODES.humanVerificationUnavailable
        ) {
          setCaptchaError(message)
          if (code === PHONE_AUTH_RESULT_CODES.humanVerificationInvalid) {
            void loadImageCaptcha(false)
          }
        } else {
          setCaptchaDialogOpen(false)
          setError(message)
        }
        return
      }

      const retryAfter = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Number(Reflect.get(payload, 'retryAfterSeconds'))
        : 0
      setResendSeconds(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60)
      setCaptchaDialogOpen(false)
      setCaptchaId('')
      setCaptchaAnswer('')
      setCaptchaImageDataUrl('')
      setNotice(t('codeSent'))
    } catch {
      setCaptchaDialogOpen(false)
      setError(t('sendCodeFailed'))
    } finally {
      setPendingAction(null)
    }
  }

  const handleOpenCaptchaDialog = () => {
    if (pendingAction || resendSeconds > 0) return
    if (!resolvePhoneNumber()) {
      setError(t('phoneInvalid'))
      return
    }
    setError('')
    setNotice('')
    setCaptchaDialogOpen(true)
    void loadImageCaptcha(true)
  }

  const handleCloseCaptchaDialog = () => {
    if (pendingAction === 'send-code') return
    setCaptchaDialogOpen(false)
    setCaptchaError('')
    setCaptchaId('')
    setCaptchaAnswer('')
    setCaptchaImageDataUrl('')
  }

  const handlePhoneSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedPhoneNumber = resolvePhoneNumber()
    if (!normalizedPhoneNumber) {
      setError(t('phoneInvalid'))
      return
    }

    setPendingAction('submit')
    setError('')
    setNotice('')
    try {
      const result = await signIn('phone', {
        phoneNumber: normalizedPhoneNumber,
        code: verificationCode,
        redirect: false,
      })
      if (result?.error === 'RateLimited') {
        setError(t('rateLimited'))
      } else if (result?.error) {
        setError(t('verificationFailed'))
      } else {
        finishAuthentication()
      }
    } catch {
      setError(t('authError'))
    } finally {
      setPendingAction(null)
    }
  }

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const identity = features.passwordAuthIdentity === 'phone'
      ? resolvePhoneNumber()
      : username.trim()
    if (!identity) {
      setError(features.passwordAuthIdentity === 'phone' ? t('phoneInvalid') : t('usernameRequired'))
      return
    }
    if (authMode === 'register' && password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(t('passwordTooShort', { minimum: AUTH_PASSWORD_MIN_LENGTH }))
      return
    }
    if (authMode === 'register' && password !== passwordConfirmation) {
      setError(t('passwordMismatch'))
      return
    }

    setPendingAction('submit')
    setError('')
    setNotice('')
    try {
      const result = await signIn('credentials', {
        identity,
        password,
        mode: authMode,
        redirect: false,
      })
      if (result?.error === 'RateLimited') {
        setError(t('rateLimited'))
      } else if (result?.error) {
        setError(authMode === 'register'
          ? t('passwordRegistrationFailed')
          : t('passwordAuthFailed'))
      } else {
        finishAuthentication()
      }
    } catch {
      setError(t('authError'))
    } finally {
      setPendingAction(null)
    }
  }

  const handleAuthModeChange = (mode: PasswordAuthMode) => {
    if (pendingAction || mode === authMode) return
    setAuthMode(mode)
    setPassword('')
    setPasswordConfirmation('')
    setError('')
    setNotice('')
  }
  const hasPrimaryAuth = features.enablePhoneAuth || features.enablePasswordAuth

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="flex min-h-[calc(100vh-4rem)] items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <section className="w-full max-w-[420px] rounded-[1.75rem] border border-white/80 bg-white/90 px-5 py-7 text-black shadow-[0_24px_72px_rgba(15,23,42,0.10)] backdrop-blur-xl sm:px-8 sm:py-8">
          <header className="mb-7 text-center">
            <h1 className="text-[1.75rem] font-bold tracking-[-0.025em] sm:text-[2rem]">
              {features.enablePasswordAuth
                ? authMode === 'login' ? t('loginTitle') : t('registerTitle')
                : t('title')}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
              {features.enablePasswordAuth
                ? authMode === 'login' ? t('loginSubtitle') : t('registerSubtitle')
                : t('subtitle')}
            </p>
          </header>

          {features.enablePasswordAuth ? (
            <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={t('authMode')}>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'login'}
                disabled={pendingAction !== null}
                onClick={() => handleAuthModeChange('login')}
                className={`h-10 rounded-lg text-sm font-medium transition ${authMode === 'login'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'}`}
              >
                {t('loginTab')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'register'}
                disabled={pendingAction !== null}
                onClick={() => handleAuthModeChange('register')}
                className={`h-10 rounded-lg text-sm font-medium transition ${authMode === 'register'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'}`}
              >
                {t('registerTab')}
              </button>
            </div>
          ) : null}

          {features.enablePhoneAuth ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <PhoneNumberInput
                inputId="phoneNumber"
                destinationSelectId="phoneDestination"
                destinationLabel={t('phoneDestination')}
                phoneLabel={t('phoneNumber')}
                destinationId={destinationId}
                phoneNumber={phoneNumber}
                disabled={pendingAction !== null}
                onDestinationChange={(nextDestinationId) => {
                  setDestinationId(nextDestinationId)
                  setPhoneNumber('')
                  setVerificationCode('')
                  setError('')
                  setNotice('')
                }}
                onPhoneNumberChange={setPhoneNumber}
              />

              <div>
                <label htmlFor="verificationCode" className="mb-2 block text-[13px] font-medium text-slate-700">
                  {t('verificationCode')}
                </label>
                <div className="flex gap-3">
                  <input
                    id="verificationCode"
                    name="verificationCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base tracking-[0.2em] text-black outline-none transition placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    placeholder={t('verificationCodePlaceholder')}
                  />
                  <button
                    type="button"
                    disabled={pendingAction !== null || resendSeconds > 0}
                    onClick={handleOpenCaptchaDialog}
                    className="h-12 shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === 'send-code'
                      ? t('sendingCode')
                      : resendSeconds > 0
                        ? t('resendCountdown', { seconds: resendSeconds })
                        : t('sendCode')}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={pendingAction !== null}
                className="h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.20)] transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === 'submit' ? t('continuing') : t('continue')}
              </button>
            </form>
          ) : null}

          {features.enablePasswordAuth ? (
            <form
              key={authMode}
              onSubmit={handlePasswordSubmit}
              autoComplete="on"
              className="space-y-4"
            >
              <div>
                {features.passwordAuthIdentity === 'phone' ? (
                  <PhoneNumberInput
                    inputId="passwordPhoneNumber"
                    inputName="username"
                    autoComplete="username"
                    destinationSelectId="passwordPhoneDestination"
                    destinationLabel={t('phoneDestination')}
                    phoneLabel={t('phoneNumber')}
                    destinationId={destinationId}
                    phoneNumber={phoneNumber}
                    disabled={pendingAction !== null}
                    onDestinationChange={(nextDestinationId) => {
                      setDestinationId(nextDestinationId)
                      setPhoneNumber('')
                      setError('')
                      setNotice('')
                    }}
                    onPhoneNumberChange={setPhoneNumber}
                  />
                ) : (
                  <>
                    <label htmlFor="username" className="mb-2 block text-[13px] font-medium text-slate-700">
                      {t('username')}
                    </label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                      className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      placeholder={t('usernamePlaceholder')}
                    />
                  </>
                )}
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-slate-700">
                  {t('password')}
                </label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={setPassword}
                  required
                  placeholder={authMode === 'register'
                    ? t('newPasswordPlaceholder', { minimum: AUTH_PASSWORD_MIN_LENGTH })
                    : t('passwordPlaceholder')}
                  showLabel={t('showPassword')}
                  hideLabel={t('hidePassword')}
                  inputClassName="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {authMode === 'register' ? (
                <div>
                  <label htmlFor="passwordConfirmation" className="mb-2 block text-[13px] font-medium text-slate-700">
                    {t('confirmPassword')}
                  </label>
                  <PasswordInput
                    id="passwordConfirmation"
                    name="passwordConfirmation"
                    autoComplete="new-password"
                    value={passwordConfirmation}
                    onChange={setPasswordConfirmation}
                    required
                    placeholder={t('confirmPasswordPlaceholder')}
                    showLabel={t('showPassword')}
                    hideLabel={t('hidePassword')}
                    inputClassName="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              ) : null}

              <button
                type="submit"
                disabled={pendingAction !== null}
                className="h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.20)] transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === 'submit'
                  ? authMode === 'login' ? t('signingIn') : t('registering')
                  : authMode === 'login' ? t('loginButton') : t('registerButton')}
              </button>
            </form>
          ) : null}

          {error ? (
            <p role="alert" className="mt-5 rounded-xl bg-[var(--glass-tone-surface)] px-4 py-3 text-sm text-[var(--glass-tone-danger-fg)] shadow-[var(--glass-tone-shadow)]">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-5 rounded-xl bg-[var(--glass-tone-surface)] px-4 py-3 text-sm text-[var(--glass-tone-success-fg)] shadow-[var(--glass-tone-shadow)]">
              {notice}
            </p>
          ) : null}

          {features.showGoogleOAuth ? (
            <>
              {hasPrimaryAuth ? (
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs text-slate-400">{t('or')}</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
              ) : null}
              <GoogleSignInButton
                label={t('continueWithGoogle')}
                loadingLabel={t('googleButtonLoading')}
                onError={() => setError(t('googleLoginError'))}
              />
            </>
          ) : null}

          <p className="mt-5 text-center text-xs leading-5 text-slate-500">
            {features.enablePasswordAuth
              ? authMode === 'login'
                ? t('passwordLoginHint')
                : features.passwordAuthIdentity === 'phone'
                  ? t('phoneRegistrationHint')
                  : t('usernameRegistrationHint')
              : t('autoCreateHint')}
          </p>
          <div className="mt-5 text-center">
            <Link
              href={{ pathname: '/' }}
              className="text-sm text-slate-500 transition hover:text-black"
            >
              {t('backToHome')}
            </Link>
          </div>
        </section>
      </main>
      <PhoneCaptchaDialog
        open={captchaDialogOpen}
        answer={captchaAnswer}
        imageDataUrl={captchaImageDataUrl}
        loading={captchaLoading}
        submitting={pendingAction === 'send-code'}
        error={captchaError}
        onAnswerChange={setCaptchaAnswer}
        onRefresh={() => void loadImageCaptcha(true)}
        onClose={handleCloseCaptchaDialog}
        onConfirm={() => void handleSendCode()}
      />
    </div>
  )
}
