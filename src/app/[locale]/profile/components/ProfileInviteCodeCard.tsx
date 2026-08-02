'use client'

import { FormEvent, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

// 邀请码兑换:常驻卡片(原充值弹窗右栏)。充值本身已收敛到套餐页,
// 这里只保留兑换;成功后由 page 刷新余额与流水(唯一数据 owner)。

interface ProfileInviteCodeCardProps {
  onCreditsChanged: () => Promise<void>
}

export default function ProfileInviteCodeCard({ onCreditsChanged }: ProfileInviteCodeCardProps) {
  const t = useTranslations('profile')
  const resolveClientError = useClientErrorMessage()
  const [inviteCode, setInviteCode] = useState('')
  const [redeemStatus, setRedeemStatus] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)

  const handleRedeemSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!inviteCode.trim()) return
    setRedeeming(true)
    setRedeemStatus(null)
    void apiFetch('/api/user/invite-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: inviteCode }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw await readClientApiError(response)
        }
        setInviteCode('')
        setRedeemStatus(t('inviteCode.redeemSuccess'))
        await onCreditsChanged()
      })
      .catch((error: unknown) => {
        setRedeemStatus(resolveClientError(error, t('inviteCode.redeemFailed')))
      })
      .finally(() => setRedeeming(false))
  }

  return (
    <section className="glass-surface-elevated p-6">
      <div className="flex items-center gap-2">
        <AppIcon name="badgeCheck" className="h-4 w-4 text-[var(--glass-text-secondary)]" />
        <h2 className="text-base font-semibold tracking-tight text-[var(--glass-text-primary)]">
          {t('inviteCode.title')}
        </h2>
      </div>
      <p className="mt-1.5 text-sm text-[var(--glass-text-tertiary)]">{t('inviteCode.description')}</p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={handleRedeemSubmit}>
        <input
          className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-white px-4 py-3 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-slate-400"
          value={inviteCode}
          onChange={(event) => { setInviteCode(event.target.value); setRedeemStatus(null) }}
          placeholder={t('inviteCode.placeholder')}
        />
        <button
          type="submit"
          disabled={redeeming || !inviteCode.trim()}
          className="glass-btn-base glass-btn-soft rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {redeeming ? t('inviteCode.redeeming') : t('inviteCode.redeem')}
        </button>
      </form>
      {redeemStatus ? (
        <p className="mt-3 text-sm text-[var(--glass-text-secondary)]">{redeemStatus}</p>
      ) : null}
    </section>
  )
}
