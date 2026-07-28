'use client'

import { useCallback, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import GoogleSignInButton from '@/components/auth/GoogleSignInButton'
import PasswordInput from '@/components/auth/PasswordInput'
import PhoneCaptchaDialog from '@/components/auth/PhoneCaptchaDialog'
import Navbar from '@/components/Navbar'
import { Link, useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import {
  PHONE_AUTH_RESULT_CODES,
  readPhoneAuthResultCode,
} from '@/lib/auth/phone-auth-contract'
import { normalizePhoneNumber } from '@/lib/auth/phone-number'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

interface AuthEntryCardProps {
  features: Pick<
    PublicDeploymentFeatures,
    | 'enablePhoneAuth'
    | 'enablePasswordAuth'
    | 'showGoogleOAuth'
    | 'showInviteCode'
    | 'requireInviteCodeOnSignup'
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
  const [inviteCode, setInviteCode] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const router = useRouter()
  const t = useTranslations('auth')

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
          phoneNumber,
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
    if (!normalizePhoneNumber(phoneNumber)) {
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
    if (features.requireInviteCodeOnSignup && !inviteCode.trim()) {
      setError(t('inviteCodeRequired'))
      return
    }

    setPendingAction('submit')
    setError('')
    setNotice('')
    try {
      const result = await signIn('phone', {
        phoneNumber,
        code: verificationCode,
        inviteCode: inviteCode.trim(),
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
    setPendingAction('submit')
    setError('')
    setNotice('')
    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      })
      if (result?.error === 'RateLimited') {
        setError(t('rateLimited'))
      } else if (result?.error) {
        setError(t('passwordAuthFailed'))
      } else {
        finishAuthentication()
      }
    } catch {
      setError(t('authError'))
    } finally {
      setPendingAction(null)
    }
  }

  const showInviteCode = features.enablePhoneAuth
    && (features.showInviteCode || features.requireInviteCodeOnSignup)
  const hasPrimaryAuth = features.enablePhoneAuth || features.enablePasswordAuth

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="flex items-center justify-center px-4 py-10 sm:py-14">
        <section className="w-full max-w-[460px] rounded-[2rem] border border-black/8 bg-white px-6 py-8 text-black shadow-[0_24px_80px_rgba(15,23,42,0.12)] sm:px-10 sm:py-10">
          <header className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t('title')}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {t('subtitle')}
            </p>
          </header>

          {features.enablePhoneAuth ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-5">
              <div>
                <label htmlFor="phoneNumber" className="mb-2 block text-sm font-semibold text-slate-900">
                  {t('phoneNumber')}
                </label>
                <input
                  id="phoneNumber"
                  name="phoneNumber"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  required
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                  placeholder={t('phoneNumberPlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="verificationCode" className="mb-2 block text-sm font-semibold text-slate-900">
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
                    className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base tracking-[0.2em] text-black outline-none transition placeholder:tracking-normal placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                    placeholder={t('verificationCodePlaceholder')}
                  />
                  <button
                    type="button"
                    disabled={pendingAction !== null || resendSeconds > 0}
                    onClick={handleOpenCaptchaDialog}
                    className="h-12 shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-black shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === 'send-code'
                      ? t('sendingCode')
                      : resendSeconds > 0
                        ? t('resendCountdown', { seconds: resendSeconds })
                        : t('sendCode')}
                  </button>
                </div>
              </div>

              {showInviteCode ? (
                <div>
                  <label htmlFor="inviteCode" className="mb-2 block text-sm font-semibold text-slate-900">
                    {features.requireInviteCodeOnSignup ? t('inviteCode') : t('inviteCodeOptional')}
                  </label>
                  <input
                    id="inviteCode"
                    name="inviteCode"
                    type="text"
                    autoComplete="off"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    required={features.requireInviteCodeOnSignup}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                    placeholder={t('inviteCodePlaceholder')}
                  />
                </div>
              ) : null}

              <button
                type="submit"
                disabled={pendingAction !== null}
                className="h-12 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)] transition hover:from-blue-700 hover:to-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === 'submit' ? t('continuing') : t('continue')}
              </button>
            </form>
          ) : null}

          {features.enablePasswordAuth ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              <div>
                <label htmlFor="username" className="mb-2 block text-sm font-semibold text-slate-900">
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
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                  placeholder={t('usernamePlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-900">
                  {t('password')}
                </label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                  required
                  placeholder={t('passwordPlaceholder')}
                  showLabel={t('showPassword')}
                  hideLabel={t('hidePassword')}
                  inputClassName="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-base text-black outline-none transition placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <button
                type="submit"
                disabled={pendingAction !== null}
                className="h-12 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)] transition hover:from-blue-700 hover:to-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === 'submit' ? t('continuing') : t('continue')}
              </button>
            </form>
          ) : null}

          {error ? (
            <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </p>
          ) : null}

          {features.showGoogleOAuth ? (
            <>
              {hasPrimaryAuth ? (
                <div className="my-6 flex items-center gap-3">
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

          <p className="mt-6 text-center text-xs leading-5 text-slate-500">
            {t('autoCreateHint')}
          </p>
          <div className="mt-6 text-center">
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
