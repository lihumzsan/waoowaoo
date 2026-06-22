'use client'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import ApiConfigTab from './components/ApiConfigTab'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { readProfileSectionParam, type ProfileSection } from '@/lib/profile/sections'
import { apiFetch } from '@/lib/api-fetch'
import { parseApiErrorPayload } from '@/lib/api-error-payload'
import {
  isPublicDeploymentFeatures,
  type PublicDeploymentFeatures,
} from '@/lib/deployment/public-client'
import { getProfileTransactionKindTranslationKey } from '@/lib/profile/transaction-labels'

type DeploymentPayload = {
  features?: PublicDeploymentFeatures
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

type RechargeConfig = {
  enabled: boolean
  creditValueCurrency: string
  paymentCurrency: string
  minCredits: number
  maxCredits: number
}

type RechargeConfigPayload = {
  recharge?: RechargeConfig
}

type CheckoutPayload = {
  url?: string
}

function readApiFailureReason(payload: unknown, fallback: string): string {
  const parsed = parseApiErrorPayload(payload)
  return parsed.code || parsed.message || fallback
}

function formatAmount(value: number | undefined, currency: string | undefined): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return `${amount.toFixed(2)} ${currency || 'CREDITS'}`
}

function formatCurrencyAmount(value: number | undefined, currency: string | undefined): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (currency === 'CNY') return `¥${amount.toFixed(2)}`
  return `${currency || ''} ${amount.toFixed(2)}`.trim()
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

function isRechargeConfigPayload(value: unknown): value is RechargeConfigPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCheckoutPayload(value: unknown): value is CheckoutPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getDefaultProfileSection(features: PublicDeploymentFeatures): ProfileSection {
  return features.showApiConfig ? 'apiConfig' : 'billing'
}

function isProfileSectionEnabled(section: ProfileSection, features: PublicDeploymentFeatures): boolean {
  if (section === 'apiConfig') return features.showApiConfig
  return features.showBilling
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
  const [deploymentFeatures, setDeploymentFeatures] = useState<PublicDeploymentFeatures | null>(null)
  const [deploymentLoadFailed, setDeploymentLoadFailed] = useState(false)
  const [balance, setBalance] = useState<BalancePayload | null>(null)
  const [transactions, setTransactions] = useState<TransactionItem[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [redeemStatus, setRedeemStatus] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [rechargeConfig, setRechargeConfig] = useState<RechargeConfig | null>(null)
  const [rechargeConfigError, setRechargeConfigError] = useState<string | null>(null)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [rechargeStatus, setRechargeStatus] = useState<string | null>(null)
  const [recharging, setRecharging] = useState(false)

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
      if (!response.ok) {
        if (!canceled) setDeploymentLoadFailed(true)
        return
      }
      const payload: unknown = await response.json()
      if (!canceled && isDeploymentPayload(payload) && isPublicDeploymentFeatures(payload.features)) {
        setDeploymentFeatures(payload.features)
        setDeploymentLoadFailed(false)
      } else if (!canceled) {
        setDeploymentLoadFailed(true)
      }
    }

    void loadDeployment()
    return () => {
      canceled = true
    }
  }, [session])

  useEffect(() => {
    if (!deploymentFeatures) return
    if (isProfileSectionEnabled(activeSection, deploymentFeatures)) return

    const nextSection = getDefaultProfileSection(deploymentFeatures)
    setActiveSection(nextSection)
    router.replace(
      { pathname: '/profile', query: { section: nextSection } },
      { scroll: false },
    )
  }, [activeSection, deploymentFeatures, router])

  const loadBalance = useCallback(async () => {
    const response = await apiFetch('/api/user/balance')
    if (!response.ok) return
    const payload: unknown = await response.json()
    if (isBalancePayload(payload)) setBalance(payload)
  }, [])

  const loadTransactions = useCallback(async () => {
    const response = await apiFetch('/api/user/transactions?pageSize=20')
    if (!response.ok) return
    const payload: unknown = await response.json()
    if (isTransactionsPayload(payload) && Array.isArray(payload.transactions)) {
      setTransactions(payload.transactions)
    }
  }, [])

  const loadRechargeConfig = useCallback(async () => {
    const response = await apiFetch('/api/payments/recharge/config')
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      setRechargeConfig(null)
      setRechargeConfigError(t('recharge.configLoadFailed', {
        reason: readApiFailureReason(payload, `HTTP_${response.status}`),
      }))
      return
    }
    if (isRechargeConfigPayload(payload) && payload.recharge) {
      setRechargeConfig(payload.recharge)
      setRechargeConfigError(null)
      return
    }
    setRechargeConfig(null)
    setRechargeConfigError(t('recharge.configLoadFailed', {
      reason: 'PAYMENT_RECHARGE_CONFIG_INVALID',
    }))
  }, [t])

  useEffect(() => {
    if (!session || deploymentFeatures?.showBilling !== true) return
    void loadBalance()
    void loadTransactions()
    if (deploymentFeatures.showRecharge) {
      void loadRechargeConfig()
    }
  }, [session, deploymentFeatures, loadBalance, loadTransactions, loadRechargeConfig])

  useEffect(() => {
    const paymentStatus = searchParams.get('payment')
    if (paymentStatus === 'success') {
      setRechargeStatus(t('recharge.successNotice'))
    } else if (paymentStatus === 'cancel') {
      setRechargeStatus(t('recharge.cancelNotice'))
    }
  }, [searchParams, t])

  if (deploymentLoadFailed) {
    throw new Error('PROFILE_DEPLOYMENT_FEATURES_UNAVAILABLE')
  }

  if (status === 'loading' || !session) {
    return (
      <div className="glass-page flex min-h-screen items-center justify-center">
        <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
      </div>
    )
  }

  const noBillingText = t('openSourceNoBilling')
  const showBilling = deploymentFeatures?.showBilling === true
  const showRecharge = deploymentFeatures?.showRecharge === true
  const showInviteCode = deploymentFeatures?.showInviteCode === true
  const balanceText = showBilling ? formatAmount(balance?.balance, balance?.currency) : noBillingText
  const parsedRechargeAmount = Number(rechargeAmount)
  const estimatedPaymentAmount = rechargeConfig?.enabled === true && Number.isFinite(parsedRechargeAmount)
    ? parsedRechargeAmount
    : 0
  const sectionItems: Array<{
    section: ProfileSection
    icon: AppIconName
    label: string
  }> = [
    ...(deploymentFeatures?.showApiConfig === true
      ? [{ section: 'apiConfig' as const, icon: 'settingsHexAlt' as const, label: t('apiConfig') }]
      : []),
    ...(deploymentFeatures?.showBilling === true
      ? [{ section: 'billing' as const, icon: 'receipt' as const, label: t('billingRecords') }]
      : []),
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
                  {showBilling ? (
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

              {deploymentFeatures === null ? (
                <div className="flex h-full items-center justify-center text-sm text-[var(--glass-text-secondary)]">
                  {tc('loading')}
                </div>
              ) : activeSection === 'apiConfig' && deploymentFeatures.showApiConfig ? (
                <ApiConfigTab />
              ) : activeSection === 'billing' && showBilling ? (
                <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
                  {showRecharge ? (
                    <section className="glass-surface-soft rounded-2xl border border-[var(--glass-stroke-base)] p-5">
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('recharge.title')}</h2>
                          <p className="mt-1 text-sm text-[var(--glass-text-secondary)]">{t('recharge.description')}</p>
                        </div>
                      </div>
                      {rechargeConfig?.enabled === true ? (
                        <form
                          className="space-y-3"
                          onSubmit={(event: FormEvent<HTMLFormElement>) => {
                            event.preventDefault()
                            if (!Number.isFinite(parsedRechargeAmount)) {
                              setRechargeStatus(t('recharge.invalidAmount'))
                              return
                            }
                            if (
                              parsedRechargeAmount < rechargeConfig.minCredits ||
                              parsedRechargeAmount > rechargeConfig.maxCredits
                            ) {
                              setRechargeStatus(t('recharge.invalidAmount'))
                              return
                            }
                            setRecharging(true)
                            setRechargeStatus(null)
                            void apiFetch('/api/payments/stripe/checkout', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ credits: parsedRechargeAmount }),
                            })
                              .then(async (response) => {
                                const payload: unknown = await response.json()
                                if (!response.ok || !isCheckoutPayload(payload) || !payload.url) {
                                  throw new Error(t('recharge.checkoutFailedWithReason', {
                                    reason: readApiFailureReason(payload, `HTTP_${response.status}`),
                                  }))
                                }
                                window.location.assign(payload.url)
                              })
                              .catch((error: unknown) => {
                                setRechargeStatus(error instanceof Error ? error.message : t('recharge.checkoutFailed'))
                              })
                              .finally(() => setRecharging(false))
                          }}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <label className="flex-1">
                              <span className="mb-2 block text-sm font-medium text-[var(--glass-text-primary)]">
                                {t('recharge.amountLabel')}
                              </span>
                              <input
                                className="glass-input w-full rounded-xl px-4 py-3 text-sm"
                                type="number"
                                min={rechargeConfig.minCredits}
                                max={rechargeConfig.maxCredits}
                                step="0.01"
                                value={rechargeAmount}
                                onChange={(event) => setRechargeAmount(event.target.value)}
                                placeholder={t('recharge.placeholder')}
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={recharging || !rechargeAmount.trim()}
                              className="glass-btn-primary self-end rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {recharging ? t('recharge.processing') : t('recharge.submit')}
                            </button>
                          </div>
                          <div className="grid gap-2 text-xs text-[var(--glass-text-tertiary)] sm:grid-cols-3">
                            <div>{t('recharge.range', { min: rechargeConfig.minCredits, max: rechargeConfig.maxCredits })}</div>
                            <div>{t('recharge.unitValue')}</div>
                            <div>
                              {t('recharge.estimatedCharge', {
                                amount: formatCurrencyAmount(estimatedPaymentAmount, rechargeConfig.paymentCurrency),
                              })}
                            </div>
                          </div>
                        </form>
                      ) : rechargeConfigError ? (
                        <p className="text-sm text-[var(--glass-tone-danger-fg)]">{rechargeConfigError}</p>
                      ) : (
                        <p className="text-sm text-[var(--glass-text-secondary)]">{t('recharge.unavailable')}</p>
                      )}
                      {rechargeStatus ? (
                        <p className="mt-3 text-sm text-[var(--glass-text-secondary)]">{rechargeStatus}</p>
                      ) : null}
                    </section>
                  ) : null}

                  {showInviteCode ? (
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
                  ) : null}

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
                                <td className="px-4 py-3 text-[var(--glass-text-primary)]">{t(getProfileTransactionKindTranslationKey(item.type))}</td>
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
