'use client'

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { getProfileBillingServiceTranslationKey } from '@/lib/profile/billing-transaction-display'
import ProfileTransactionsTable, { type ProfileTransactionItem } from './ProfileTransactionsTable'

export type ProfileProjectCostSummary = {
  projectId: string
  projectName: string | null
  totalCost: number
  recordCount: number
}

export type ProfileProjectCostDetail = {
  id: string
  action: string
  apiType: string
  quantity: number
  unit: string
  cost: number
  createdAt: string
}

interface ProfileBillingSectionProps {
  transactions: readonly ProfileTransactionItem[]
  projectCosts: readonly ProfileProjectCostSummary[]
  totalProjectCost: number
  timeZone: string
  currency?: string
  onRefresh: () => void
  onLoadProjectDetails: (projectId: string) => Promise<readonly ProfileProjectCostDetail[]>
}

export default function ProfileBillingSection({
  transactions,
  projectCosts,
  totalProjectCost,
  timeZone,
  currency,
  onRefresh,
  onLoadProjectDetails,
}: ProfileBillingSectionProps) {
  const t = useTranslations('profile')
  const format = useFormatter()
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null)
  const [detailsByProject, setDetailsByProject] = useState<
    Record<string, readonly ProfileProjectCostDetail[]>
  >({})

  const formatUsageCredits = (value: number): string => format.number(value, {
    maximumFractionDigits: 6,
  })

  const toggleProject = async (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null)
      return
    }
    setExpandedProjectId(projectId)
    if (detailsByProject[projectId]) return
    setLoadingProjectId(projectId)
    try {
      const details = await onLoadProjectDetails(projectId)
      setDetailsByProject((current) => ({ ...current, [projectId]: details }))
    } finally {
      setLoadingProjectId((current) => current === projectId ? null : current)
    }
  }

  const renderAction = (action: string): string => {
    const key = `actionTypes.${action.replaceAll('.', '_')}`
    return t.has(key) ? t(key) : action
  }

  const renderServiceType = (apiType: string, unit: string): string => {
    const key = getProfileBillingServiceTranslationKey(apiType, unit) ?? 'apiTypes.other'
    return t(key)
  }

  const refresh = () => {
    setExpandedProjectId(null)
    setDetailsByProject({})
    onRefresh()
  }

  return (
    <div className="space-y-5">
      <section className="glass-surface-elevated p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--glass-text-primary)]">
              {t('projectUsage')}
            </h2>
            <p className="mt-1 text-sm text-[var(--glass-text-tertiary)]">
              {t('totalCost', { amount: formatUsageCredits(totalProjectCost) })}
            </p>
          </div>
          <button
            type="button"
            className="glass-btn-base glass-btn-soft rounded-xl px-3.5 py-2 text-sm"
            onClick={refresh}
          >
            <AppIcon name="refresh" className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
        </div>

        {projectCosts.length === 0 ? (
          <div className="glass-table-card flex min-h-40 items-center justify-center text-sm text-[var(--glass-text-tertiary)]">
            {t('noProjectCosts')}
          </div>
        ) : (
          <div className="space-y-2">
            {projectCosts.map((project) => {
              const expanded = expandedProjectId === project.projectId
              const details = detailsByProject[project.projectId]
              return (
                <div key={project.projectId} className="glass-table-card overflow-hidden">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-tone-surface)]"
                    aria-expanded={expanded}
                    onClick={() => { void toggleProject(project.projectId) }}
                  >
                    <AppIcon
                      name="chevronDown"
                      className={`h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)] transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--glass-text-primary)]">
                        {project.projectName ?? t('unknownProject')}
                      </p>
                      <p className="text-xs text-[var(--glass-text-tertiary)]">
                        {t('recordCount', { count: project.recordCount })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="glass-num font-semibold text-[var(--glass-text-primary)]">
                        {formatUsageCredits(project.totalCost)}
                      </p>
                      <p className="text-xs text-[var(--glass-text-tertiary)]">{t('userCharge')}</p>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="border-t border-[var(--glass-border-subtle)] px-4 py-3">
                      {loadingProjectId === project.projectId ? (
                        <p className="py-5 text-center text-sm text-[var(--glass-text-tertiary)]">
                          {t('loadingDetails')}
                        </p>
                      ) : !details || details.length === 0 ? (
                        <p className="py-5 text-center text-sm text-[var(--glass-text-tertiary)]">
                          {t('noDetails')}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="glass-table w-full min-w-[700px]">
                            <thead>
                              <tr>
                                <th>{t('transactionOperation')}</th>
                                <th>{t('generationType')}</th>
                                <th>{t('usage')}</th>
                                <th className="text-right">{t('userCharge')}</th>
                                <th className="text-right">{t('createdAt')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {details.map((detail) => (
                                <tr key={detail.id}>
                                  <td>{renderAction(detail.action)}</td>
                                  <td>{renderServiceType(detail.apiType, detail.unit)}</td>
                                  <td className="glass-num">
                                    {detail.unit === 'token'
                                      ? t('billingDetail.tokens', { count: detail.quantity })
                                      : `${String(detail.quantity)} ${detail.unit}`}
                                  </td>
                                  <td className="glass-num text-right font-semibold">
                                    {formatUsageCredits(detail.cost)}
                                  </td>
                                  <td className="glass-num whitespace-nowrap text-right text-[var(--glass-text-tertiary)]">
                                    {format.dateTime(new Date(detail.createdAt), {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      timeZone,
                                    })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="glass-surface-elevated p-6">
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-[var(--glass-text-primary)]">
          {t('accountTransactions')}
        </h2>
        <ProfileTransactionsTable
          items={transactions}
          currency={currency}
          timeZone={timeZone}
        />
      </section>
    </div>
  )
}
