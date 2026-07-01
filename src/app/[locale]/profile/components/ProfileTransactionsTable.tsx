'use client'

import { useTranslations } from 'next-intl'
import {
  buildProfileBillingDetailParts,
  getProfileTransactionActionTranslationKey,
  type ProfileTranslationParams,
} from '@/lib/profile/billing-transaction-display'

export type ProfileTransactionItem = {
  id: string
  type: string
  amount: number
  balanceAfter: number
  description?: string | null
  action?: string | null
  projectName?: string | null
  episodeNumber?: number | null
  episodeName?: string | null
  billingMeta?: Record<string, unknown> | null
  target?: {
    targetType: string
    targetId: string
    labelKey: string
    labelParams: ProfileTranslationParams
  } | null
  createdAt: string
}

function formatAmount(value: number | undefined, currency: string | undefined): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return `${amount.toFixed(2)} ${currency || 'CREDITS'}`
}

function formatCreditDelta(value: number, currency: string | undefined): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)} ${currency || 'CREDITS'}`
}

export default function ProfileTransactionsTable({
  items,
  currency,
}: {
  items: ProfileTransactionItem[]
  currency?: string
}) {
  const t = useTranslations('profile')

  const renderTransactionScope = (item: ProfileTransactionItem) => {
    const lines: string[] = []
    if (item.projectName) lines.push(item.projectName)
    if (typeof item.episodeNumber === 'number') {
      const episodeLabel = t('episodeLabel', { number: item.episodeNumber })
      lines.push(item.episodeName ? `${episodeLabel} · ${item.episodeName}` : episodeLabel)
    }
    if (item.target) {
      lines.push(t(item.target.labelKey, item.target.labelParams))
    }

    return lines.length > 0 ? (
      <div className="space-y-1">
        {lines.map((line, index) => (
          <p key={`${item.id}-scope-${index}`} className={index === 0 ? 'text-[var(--glass-text-primary)]' : 'text-[var(--glass-text-secondary)]'}>
            {line}
          </p>
        ))}
      </div>
    ) : (
      <span className="text-[var(--glass-text-tertiary)]">-</span>
    )
  }

  const renderBillingDetail = (item: ProfileTransactionItem) => {
    const parts = buildProfileBillingDetailParts(item.billingMeta)
    if (parts.length === 0) return <span className="text-[var(--glass-text-tertiary)]">-</span>

    return (
      <div className="flex max-w-[280px] flex-wrap gap-1.5">
        {parts.map((part, index) => (
          <span
            key={`${item.id}-detail-${index}`}
            className="rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-2 py-1 text-xs text-[var(--glass-text-secondary)]"
          >
            {part.kind === 'translation' ? t(part.key, part.params) : part.text}
          </span>
        ))}
      </div>
    )
  }

  return items.length === 0 ? (
    <div className="flex min-h-48 items-center justify-center text-sm text-[var(--glass-text-secondary)]">{t('noTransactions')}</div>
  ) : (
    <div className="overflow-x-auto rounded-xl border border-[var(--glass-stroke-base)]">
      <table className="min-w-[980px] w-full text-left text-sm">
        <thead className="bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]">
          <tr>
            <th className="px-4 py-3">{t('transactionOperation')}</th>
            <th className="px-4 py-3">{t('transactionSubject')}</th>
            <th className="px-4 py-3">{t('transactionBillingDetail')}</th>
            <th className="px-4 py-3">{t('amount')}</th>
            <th className="px-4 py-3">{t('balance')}</th>
            <th className="px-4 py-3">{t('createdAt')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-[var(--glass-stroke-base)] align-top">
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--glass-text-primary)]">
                  {t(getProfileTransactionActionTranslationKey(item.type, item.action))}
                </div>
                <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
                  {t(item.amount < 0 ? 'transactionKinds.consume' : 'transactionKinds.recharge')}
                </div>
              </td>
              <td className="px-4 py-3">{renderTransactionScope(item)}</td>
              <td className="px-4 py-3">{renderBillingDetail(item)}</td>
              <td className={`px-4 py-3 font-semibold ${item.amount < 0 ? 'text-[var(--glass-tone-danger-fg)]' : 'text-[var(--glass-tone-success-fg)]'}`}>
                {formatCreditDelta(item.amount, currency)}
              </td>
              <td className="px-4 py-3 text-[var(--glass-text-secondary)]">{formatAmount(item.balanceAfter, currency)}</td>
              <td className="px-4 py-3 text-[var(--glass-text-tertiary)]">{new Date(item.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
