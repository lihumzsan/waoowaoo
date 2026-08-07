'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { WeChatIcon } from '@/components/ui/icons/WeChatIcon'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { apiFetch } from '@/lib/api-fetch'

type AttemptMode = 'login' | 'bind'

interface WechatOfficialAuthButtonProps {
  mode: AttemptMode
  onAuthenticated: () => void | Promise<void>
  disabled?: boolean
  presentation?: 'button' | 'panel'
}

interface AttemptPayload {
  attemptId: string
  browserToken: string
  qrImageUrl: string
  expiresAt: string
}

type AttemptView =
  | { state: 'pending' }
  | { state: 'ready'; mode: AttemptMode }
  | { state: 'failed'; code: string }
  | { state: 'expired'; code: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAttemptPayload(value: unknown): AttemptPayload | null {
  if (!isRecord(value) || !isRecord(value.attempt)) return null
  const attempt = value.attempt
  if (
    typeof attempt.attemptId !== 'string'
    || typeof attempt.browserToken !== 'string'
    || typeof attempt.qrImageUrl !== 'string'
    || !attempt.qrImageUrl.startsWith('data:image/jpeg;base64,')
    || typeof attempt.expiresAt !== 'string'
  ) {
    return null
  }
  return {
    attemptId: attempt.attemptId,
    browserToken: attempt.browserToken,
    qrImageUrl: attempt.qrImageUrl,
    expiresAt: attempt.expiresAt,
  }
}

function readAttemptView(value: unknown): AttemptView | null {
  if (!isRecord(value) || typeof value.state !== 'string') return null
  if (value.state === 'pending') return { state: 'pending' }
  if (
    value.state === 'ready'
    && (value.mode === 'login' || value.mode === 'bind')
  ) {
    return { state: 'ready', mode: value.mode }
  }
  if (
    (value.state === 'failed' || value.state === 'expired')
    && typeof value.code === 'string'
  ) {
    return { state: value.state, code: value.code }
  }
  return null
}

async function readStreamEvents(
  response: Response,
  onView: (view: AttemptView) => Promise<boolean>,
): Promise<boolean> {
  if (!response.body) throw new Error('WECHAT_OFFICIAL_STREAM_MISSING')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) return false
      buffer += decoder.decode(result.value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const dataLine = frame
          .split('\n')
          .find((line) => line.startsWith('data: '))
        if (dataLine) {
          let payload: unknown
          try {
            payload = JSON.parse(dataLine.slice('data: '.length))
          } catch {
            payload = null
          }
          const view = readAttemptView(payload)
          if (view && await onView(view)) return true
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export default function WechatOfficialAuthButton({
  mode,
  onAuthenticated,
  disabled = false,
  presentation = 'button',
}: WechatOfficialAuthButtonProps) {
  const t = useTranslations('auth')
  const locale = useLocale()
  const abortRef = useRef<AbortController | null>(null)
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoStartedRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState<AttemptPayload | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)

  const clearExpiryTimer = useCallback(() => {
    if (!expiryTimerRef.current) return
    clearTimeout(expiryTimerRef.current)
    expiryTimerRef.current = null
  }, [])

  const close = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    clearExpiryTimer()
    setOpen(false)
    setLoading(false)
    setAttempt(null)
    setStatus(null)
    setHasError(false)
  }, [clearExpiryTimer])

  const completeAuthentication = useCallback(async (current: AttemptPayload) => {
    setStatus(t('wechatCompleting'))
    setHasError(false)
    const result = await signIn('wechat-official', {
      attemptId: current.attemptId,
      browserToken: current.browserToken,
      redirect: false,
    })
    if (result?.error) throw new Error(result.error)
    setStatus(t('wechatSuccess'))
    await onAuthenticated()
    close()
  }, [close, onAuthenticated, t])

  const listenForApproval = useCallback(async (
    current: AttemptPayload,
    signal: AbortSignal,
  ) => {
    const response = await apiFetch('/api/auth/wechat/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attemptId: current.attemptId,
        browserToken: current.browserToken,
      }),
      signal,
    })
    if (!response.ok) throw new Error('WECHAT_OFFICIAL_STREAM_FAILED')
    const reachedTerminalState = await readStreamEvents(response, async (view) => {
      if (view.state === 'pending') return false
      clearExpiryTimer()
      if (view.state === 'ready') {
        await completeAuthentication(current)
        return true
      }
      setStatus(
        view.state === 'expired'
          ? t('wechatExpired')
          : view.code === 'WECHAT_OFFICIAL_IDENTITY_CONFLICT'
            ? t('wechatIdentityConflict')
            : t('wechatFailed'),
      )
      setHasError(true)
      return true
    })
    if (!reachedTerminalState) throw new Error('WECHAT_OFFICIAL_STREAM_ENDED')
  }, [clearExpiryTimer, completeAuthentication, t])

  const start = useCallback(async () => {
    if (loading || disabled) return
    abortRef.current?.abort()
    clearExpiryTimer()
    const controller = new AbortController()
    abortRef.current = controller
    setOpen(true)
    setLoading(true)
    setAttempt(null)
    setStatus(null)
    setHasError(false)
    try {
      const response = await apiFetch('/api/auth/wechat/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, locale }),
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => null)
      const created = response.ok ? readAttemptPayload(payload) : null
      if (!created) throw new Error('WECHAT_OFFICIAL_ATTEMPT_FAILED')
      setAttempt(created)
      setStatus(t('wechatWaiting'))
      setLoading(false)
      const expiresAtMs = Date.parse(created.expiresAt)
      if (Number.isFinite(expiresAtMs)) {
        const expiryGraceMs = 15_000
        expiryTimerRef.current = setTimeout(() => {
          if (controller.signal.aborted) return
          controller.abort()
          setStatus(t('wechatExpired'))
          setHasError(true)
        }, Math.max(0, expiresAtMs + expiryGraceMs - Date.now()))
      }
      await listenForApproval(created, controller.signal)
    } catch {
      if (controller.signal.aborted) return
      setLoading(false)
      setStatus(t('wechatUnavailable'))
      setHasError(true)
    }
  }, [clearExpiryTimer, disabled, listenForApproval, loading, locale, mode, t])

  useEffect(() => () => {
    abortRef.current?.abort()
    clearExpiryTimer()
  }, [clearExpiryTimer])

  useEffect(() => {
    if (presentation !== 'panel' || disabled || autoStartedRef.current) return
    autoStartedRef.current = true
    void start()
  }, [disabled, presentation, start])

  const qrContent = (
    <div className="flex min-h-72 flex-col items-center justify-center text-center">
      {attempt ? (
        // eslint-disable-next-line @next/next/no-img-element -- The API returns a short-lived validated QR data URL.
        <img
          src={attempt.qrImageUrl}
          alt={t('wechatQrAlt')}
          width={240}
          height={240}
          className="h-60 w-60 rounded-2xl bg-white p-2 shadow-sm"
        />
      ) : (
        <div className="flex h-60 w-60 items-center justify-center rounded-2xl bg-[var(--glass-bg-muted)] px-6 text-sm text-[var(--glass-text-secondary)]">
          {loading ? t('wechatLoading') : t('wechatUnavailable')}
        </div>
      )}
      <p
        role={hasError ? 'alert' : 'status'}
        className={`mt-4 w-full rounded-xl px-4 py-3 text-sm ${hasError
          ? 'bg-[var(--glass-tone-surface)] text-[var(--glass-tone-danger-fg)]'
          : 'bg-emerald-50 text-emerald-800'}`}
      >
        {status || t('wechatLoading')}
      </p>
      {hasError ? (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => { void start() }}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#07C160] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('wechatRetry')}
        </button>
      ) : null}
    </div>
  )

  if (presentation === 'panel') {
    return (
      <section aria-labelledby="wechat-login-panel-title" className="flex h-full flex-col">
        <header className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#07C160]/10 text-[#07C160]">
            <WeChatIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 id="wechat-login-panel-title" className="text-xl font-bold tracking-[-0.02em] text-slate-950">
            {t('wechatDialogTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {t('wechatDialogDescription')}
          </p>
        </header>
        {qrContent}
      </section>
    )
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => { void start() }}
        className={mode === 'login'
          ? 'flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#07C160] px-4 font-semibold text-white shadow-[0_10px_24px_rgba(7,193,96,0.22)] transition hover:bg-[#06ad56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#07C160] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
          : 'glass-btn-secondary mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'}
      >
        <WeChatIcon className="h-5 w-5" aria-hidden="true" />
        {mode === 'login' ? t('continueWithWechat') : t('bindWechat')}
      </button>

      <GlassModalShell
        open={open}
        onClose={close}
        title={mode === 'login' ? t('wechatDialogTitle') : t('wechatBindDialogTitle')}
        description={t('wechatDialogDescription')}
        size="sm"
        closeOnBackdrop
        closeOnEsc
        showDividers={false}
      >
        {qrContent}
      </GlassModalShell>
    </>
  )
}
