'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  buildProfileBillingDetailParts,
  buildProfileTransactionScopeLines,
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
  transactionCount?: number
  createdAt: string
}

function formatAmount(value: number | undefined): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return amount.toFixed(2)
}

function formatCreditDelta(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

export default function ProfileTransactionsTable({
  items,
  currency,
}: {
  items: readonly ProfileTransactionItem[]
  currency?: string
}) {
  const t = useTranslations('profile')
  const format = useFormatter()
  const unitLabel = currency || 'CREDITS'

  // 关联内容:首行是主体,其余行降级为一行摘要,避免行高失控。
  const renderTransactionScope = (item: ProfileTransactionItem) => {
    const lines = buildProfileTransactionScopeLines(item)
    if (lines.length === 0) return null

    const [primary, ...rest] = lines
    const secondary = rest.join(' · ')
    return (
      <div className="mt-0.5 text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
        <p className="truncate" title={lines.join(' · ')}>
          {primary}
        </p>
        {secondary ? <p className="truncate">{secondary}</p> : null}
      </div>
    )
  }

  // 计费明细:次要信息,窄视口下隐藏,宽视口最多 3 枚 chip,其余折叠为计数。
  const renderBillingDetail = (item: ProfileTransactionItem) => {
    const parts = buildProfileBillingDetailParts(item.billingMeta)
    if (parts.length === 0) return <span className="text-[var(--glass-text-tertiary)]">-</span>

    const visible = parts.slice(0, 3)
    const hidden = parts.length - visible.length
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((part, index) => (
          <span
            key={`${item.id}-detail-${index}`}
            className="glass-num inline-flex items-center rounded-full bg-[var(--glass-tone-neutral-bg)]/50 px-2 py-0.5 text-[11px] font-medium text-[var(--glass-text-secondary)]"
          >
            {part.kind === 'translation' ? t(part.key, part.params) : part.text}
          </span>
        ))}
        {hidden > 0 ? (
          <span className="glass-num inline-flex items-center px-1 py-0.5 text-[11px] text-[var(--glass-text-tertiary)]">
            +{hidden}
          </span>
        ) : null}
      </div>
    )
  }

  return items.length === 0 ? (
    <div className="glass-table-card flex min-h-48 flex-col items-center justify-center gap-2 text-sm text-[var(--glass-text-tertiary)]">
      <AppIcon name="receipt" className="h-7 w-7 opacity-50" />
      {t('noTransactions')}
    </div>
  ) : (
    <div className="glass-table-card">
      {/* 列按重要性收敛:操作(含关联内容)· 额度 · 剩余 · 时间,计费明细仅在宽视口出现,
          表格自适应容器宽度,不再强制 980px 横向溢出。 */}
      <table className="glass-table w-full table-fixed">
        <thead>
          <tr>
            <th>{t('transactionOperation')}</th>
            <th className="hidden w-[220px] xl:table-cell">{t('transactionBillingDetail')}</th>
            <th className="w-[104px] text-right">
              {t('amount')}
              <span className="ml-1 font-normal normal-case tracking-normal opacity-70">{unitLabel}</span>
            </th>
            <th className="hidden w-[116px] text-right sm:table-cell">{t('balance')}</th>
            <th className="w-[112px] text-right">{t('createdAt')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="truncate font-medium text-[var(--glass-text-primary)]">
                  {t(getProfileTransactionActionTranslationKey(item.type, item.action))}
                </div>
                {renderTransactionScope(item)}
              </td>
              <td className="hidden align-middle xl:table-cell">{renderBillingDetail(item)}</td>
              <td className="text-right align-middle">
                <span
                  className={`glass-num inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${item.amount < 0
                    ? 'bg-[var(--glass-tone-danger-bg)]/60 text-[var(--glass-tone-danger-fg)]'
                    : 'bg-[var(--glass-tone-success-bg)]/60 text-[var(--glass-tone-success-fg)]'}`}
                >
                  {formatCreditDelta(item.amount)}
                </span>
              </td>
              <td className="glass-num hidden whitespace-nowrap text-right align-middle text-[var(--glass-text-secondary)] sm:table-cell">
                {formatAmount(item.balanceAfter)}
              </td>
              <td className="glass-num whitespace-nowrap text-right align-middle text-[var(--glass-text-tertiary)]">
                {format.dateTime(new Date(item.createdAt), {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
