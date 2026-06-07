'use client'
import { FormEvent, useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import ApiConfigTab from './components/ApiConfigTab'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { readProfileSectionParam, type ProfileSection } from '@/lib/profile/sections'
import { apiFetch } from '@/lib/api-fetch'

type DeploymentPayload = {
  deployment?: {
    isCloud?: boolean
    usesPlatformProviderKeys?: boolean
  }
  billingMode?: string
}

type BalancePayload = {
  success?: boolean
  currency?: string
  balance?: number
  frozenAmount?: number
  totalSpent?: number
}

type TransactionItem = {
  id: string
  type: string
  amount: number
  balanceAfter: number
  description?: string | null
  action?: string | null
  createdAt: string
}

type TransactionsPayload = {
  transactions?: TransactionItem[]
}

function formatAmount(value: number | undefined, currency: string | undefined): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return `${amount.toFixed(2)} ${currency || 'CREDITS'}`
}

function isDeploymentPayload(value: unknown): value is DeploymentPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isBalancePayload(value: unknown): value is BalancePayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTransactionsPayload(value: unknown): value is TransactionsPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export default function ProfilePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('profile')
  const tc = useTranslations('common')
  if (!searchParams) {
    throw new Error('ProfilePage requires searchParams')
  }

  const urlSection = readProfileSectionParam(searchParams.get('section'))

  const [activeSection, setActiveSection] = useState<ProfileSection>(urlSection)
  const [isCloud, setIsCloud] = useState(false)
  const [balance, setBalance] = useState<BalancePayload | null>(null)
  const [transactions, setTransactions] = useState<TransactionItem[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [redeemStatus, setRedeemStatus] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) { router.push({ pathname: '/auth/signin' }); return }
  }, [router, session, status])

  useEffect(() => {
    setActiveSection(urlSection)
  }, [urlSection])

  useEffect(() => {
    if (!session) return
    let canceled = false

    const loadDeployment = async () => {
      const response = await apiFetch('/api/deployment')
      if (!response.ok) return
      const payload: unknown = await response.json()
      if (!canceled && isDeploymentPayload(payload)) {
        setIsCloud(payload.deployment?.isCloud === true)
      }
    }

    void loadDeployment()
    return () => {
      canceled = true
    }
  }, [session])

  const loadBalance = async () => {
    const response = await apiFetch('/api/user/balance')
    if (!response.ok) return
    const payload: unknown = await response.json()
    if (isBalancePayload(payload)) setBalance(payload)
  }

  const loadTransactions = async () => {
    const response = await apiFetch('/api/user/transactions?pageSize=20')
    if (!response.ok) return
    const payload: unknown = await response.json()
    if (isTransactionsPayload(payload) && Array.isArray(payload.transactions)) {
      setTransactions(payload.transactions)
    }
  }

  useEffect(() => {
    if (!session || !isCloud) return
    void loadBalance()
    void loadTransactions()
  }, [session, isCloud])

  if (status === 'loading' || !session) {
    return (
      <div className="glass-page flex min-h-screen items-center justify-center">
        <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
      </div>
    )
  }

  const noBillingText = t('openSourceNoBilling')
  const balanceText = isCloud ? formatAmount(balance?.balance, balance?.currency) : noBillingText
  const sectionItems: Array<{
    section: ProfileSection
    icon: AppIconName
    label: string
  }> = [
    { section: 'apiConfig', icon: 'settingsHexAlt', label: t('apiConfig') },
    { section: 'billing', icon: 'receipt', label: t('billingRecords') },
  ]

  const handleSectionChange = (section: ProfileSection) => {
    setActiveSection(section)
    router.replace(
      { pathname: '/profile', query: { section } },
      { scroll: false },
    )
  }

  return (
    <div className="glass-page min-h-screen">
      <Navbar />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex gap-6 h-[calc(100vh-140px)]">

          {/* 左侧侧边栏 */}
          <div className="w-64 flex-shrink-0">
            <div className="glass-surface-elevated h-full flex flex-col p-5">

              {/* 用户信息 */}
              <div className="mb-6">
                <div className="mb-4">
                  <h2 className="font-semibold text-[var(--glass-text-primary)]">{session.user?.name || t('user')}</h2>
                  <p className="text-xs text-[var(--glass-text-tertiary)]">{t('personalAccount')}</p>
                </div>

                {/* 余额卡片 */}
                <div className="glass-surface-soft rounded-2xl border border-[var(--glass-stroke-base)] p-4">
                  <div className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('availableBalance')}</div>
                  <div className="mt-2 text-base font-semibold text-[var(--glass-text-primary)]">{balanceText}</div>
                  {isCloud ? (
                    <div className="mt-2 space-y-1 text-xs text-[var(--glass-text-tertiary)]">
                      <div>{t('frozen')}: {formatAmount(balance?.frozenAmount, balance?.currency)}</div>
                      <div>{t('totalSpent')}: {formatAmount(balance?.totalSpent, balance?.currency)}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* 导航菜单 */}
              <nav className="flex-1 space-y-2">
                {sectionItems.map(item => (
                  <button
                    key={item.section}
                    type="button"
                    data-active={activeSection === item.section}
                    onClick={() => handleSectionChange(item.section)}
                    className="glass-selection-control w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                  >
                    <AppIcon name={item.icon} className="w-5 h-5" />
                    <span className="font-medium">{item.label}</span>
                  </button>
                ))}
              </nav>
              {/* 退出登录 */}
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="glass-btn-base glass-btn-tone-danger mt-auto flex items-center gap-2 px-4 py-3 text-sm rounded-xl transition-all cursor-pointer"
              >
                <AppIcon name="logout" className="w-4 h-4" />
                {t('logout')}
              </button>
            </div>
          </div>

          {/* 右侧内容区 */}
          <div className="flex-1 min-w-0">
            <div className="glass-surface-elevated h-full flex flex-col">

              {activeSection === 'apiConfig' ? (
                <ApiConfigTab />
              ) : isCloud ? (
                <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
                  <section className="glass-surface-soft rounded-2xl border border-[var(--glass-stroke-base)] p-5">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('inviteCode.title')}</h2>
                        <p className="mt-1 text-sm text-[var(--glass-text-secondary)]">{t('inviteCode.description')}</p>
                      </div>
                    </div>
                    <form
                      className="flex flex-col gap-3 sm:flex-row"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
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
                              throw new Error(t('inviteCode.redeemFailed'))
                            }
                            setInviteCode('')
                            setRedeemStatus(t('inviteCode.redeemSuccess'))
                            await loadBalance()
                            await loadTransactions()
                          })
                          .catch((error: unknown) => {
                            setRedeemStatus(error instanceof Error ? error.message : t('inviteCode.redeemFailed'))
                          })
                          .finally(() => setRedeeming(false))
                      }}
                    >
                      <input
                        className="glass-input flex-1 rounded-xl px-4 py-3 text-sm"
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                        placeholder={t('inviteCode.placeholder')}
                      />
                      <button
                        type="submit"
                        disabled={redeeming || !inviteCode.trim()}
                        className="glass-btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {redeeming ? t('inviteCode.redeeming') : t('inviteCode.redeem')}
                      </button>
                    </form>
                    {redeemStatus ? (
                      <p className="mt-3 text-sm text-[var(--glass-text-secondary)]">{redeemStatus}</p>
                    ) : null}
                  </section>

                  <section className="glass-surface-soft min-h-0 flex-1 rounded-2xl border border-[var(--glass-stroke-base)] p-5">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('accountTransactions')}</h2>
                      <button
                        type="button"
                        className="glass-btn-secondary rounded-xl px-4 py-2 text-sm"
                        onClick={() => {
                          void loadBalance()
                          void loadTransactions()
                        }}
                      >
                        {t('refresh')}
                      </button>
                    </div>
                    {transactions.length === 0 ? (
                      <div className="flex min-h-48 items-center justify-center text-sm text-[var(--glass-text-secondary)]">{t('noTransactions')}</div>
                    ) : (
                      <div className="overflow-hidden rounded-xl border border-[var(--glass-stroke-base)]">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]">
                            <tr>
                              <th className="px-4 py-3">{t('transactionType')}</th>
                              <th className="px-4 py-3">{t('amount')}</th>
                              <th className="px-4 py-3">{t('balance')}</th>
                              <th className="px-4 py-3">{t('createdAt')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.map((item) => (
                              <tr key={item.id} className="border-t border-[var(--glass-stroke-base)]">
                                <td className="px-4 py-3 text-[var(--glass-text-primary)]">{t(item.type === 'consume' ? 'consume' : 'recharge')}</td>
                                <td className="px-4 py-3 text-[var(--glass-text-primary)]">{item.amount.toFixed(2)}</td>
                                <td className="px-4 py-3 text-[var(--glass-text-secondary)]">{item.balanceAfter.toFixed(2)}</td>
                                <td className="px-4 py-3 text-[var(--glass-text-tertiary)]">{new Date(item.createdAt).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <AppIcon name="receipt" className="mb-4 h-12 w-12 text-[var(--glass-text-tertiary)]" />
                  <p className="text-base font-semibold text-[var(--glass-text-primary)]">{noBillingText}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main >
    </div >
  )
}
