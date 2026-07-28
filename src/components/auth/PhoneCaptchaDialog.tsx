'use client'

import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'

interface PhoneCaptchaDialogProps {
  open: boolean
  answer: string
  imageDataUrl: string
  loading: boolean
  submitting: boolean
  error: string
  onAnswerChange: (value: string) => void
  onRefresh: () => void
  onClose: () => void
  onConfirm: () => void
}

export default function PhoneCaptchaDialog({
  open,
  answer,
  imageDataUrl,
  loading,
  submitting,
  error,
  onAnswerChange,
  onRefresh,
  onClose,
  onConfirm,
}: PhoneCaptchaDialogProps) {
  const t = useTranslations('auth')

  return (
    <GlassModalShell
      open={open}
      onClose={onClose}
      title={t('imageCaptchaDialogTitle')}
      description={t('imageCaptchaDialogDescription')}
      size="sm"
      closeOnBackdrop={!submitting}
      closeOnEsc={!submitting}
      showCloseButton={false}
      showDividers={false}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <div>
          <label
            htmlFor="imageCaptcha"
            className="mb-2 block text-sm font-semibold text-[var(--glass-text-primary)]"
          >
            {t('imageCaptcha')}
          </label>
          <div className="flex gap-3">
            <input
              id="imageCaptcha"
              name="imageCaptcha"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={4}
              value={answer}
              onChange={(event) => {
                onAnswerChange(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4),
                )
              }}
              autoFocus
              required
              className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base uppercase tracking-[0.18em] text-black outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
              placeholder={t('imageCaptchaPlaceholder')}
            />
            <button
              type="button"
              disabled={loading || submitting}
              onClick={onRefresh}
              aria-label={t('refreshImageCaptcha')}
              title={t('refreshImageCaptcha')}
              className="h-12 w-[140px] shrink-0 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-sm transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {imageDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the API returns a short-lived inline challenge.
                <img
                  src={imageDataUrl}
                  alt={t('imageCaptchaAlt')}
                  width={140}
                  height={48}
                  className="h-full w-full"
                />
              ) : (
                <span className="text-xs font-medium text-slate-500">
                  {loading ? t('imageCaptchaLoading') : t('refreshImageCaptcha')}
                </span>
              )}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-[var(--glass-text-secondary)]">
            {t('imageCaptchaHint')}
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-black transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || submitting || !imageDataUrl || answer.length !== 4}
            className="h-11 flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] transition hover:from-blue-700 hover:to-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t('sendingCode') : t('confirmAndSendCode')}
          </button>
        </div>
      </form>
    </GlassModalShell>
  )
}
