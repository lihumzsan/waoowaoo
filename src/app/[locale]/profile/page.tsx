'use client'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import AccountSecurityTab from './components/AccountSecurityTab'
import ApiConfigTab from './components/ApiConfigTab'
import ProfileTransactionsTable, { type ProfileTransactionItem } from './components/ProfileTransactionsTable'
import { BrandPageLoading } from '@/components/ui/BrandLoading'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { useRouter } from '@/i18n/navigation'
import { readProfileSectionParam, type ProfileSection } from '@/lib/profile/sections'
import { apiFetch } from '@/lib/api-fetch'
import { parseApiErrorPayload } from '@/lib/api-error-payload'
import {
  isPublicDeploymentFeatures,
  type PublicDeploymentFeatures,
} from '@/lib/deployment/public-client'

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

type TransactionsPayload = {
  transactions?: ProfileTransactionItem[]
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

const RECHARGE_PRESETS = [50, 100, 200, 500] as const

function getDefaultProfileSection(features: PublicDeploymentFeatures): ProfileSection {
  if (features.showBilling) return 'overview'
  if (features.showAccountSecurity) return 'security'
  if (features.showApiConfig) return 'apiConfig'
  return 'overview'
}

function isProfileSectionEnabled(section: ProfileSection, features: PublicDeploymentFeatures): boolean {
  if (section === 'security') return features.showAccountSecurity
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

  const [deploymentFeatures, setDeploymentFeatures] = useState<PublicDeploymentFeatures | null>(null)
  const [deploymentLoadFailed, setDeploymentLoadFailed] = useState(false)
  const [balance, setBalance] = useState<BalancePayload | null>(null)
  const [transactions, setTransactions] = useState<ProfileTransactionItem[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [redeemStatus, setRedeemStatus] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [rechargeConfig, setRechargeConfig] = useState<RechargeConfig | null>(null)
  const [rechargeConfigError, setRechargeConfigError] = useState<string | null>(null)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [rechargeStatus, setRechargeStatus] = useState<string | null>(null)
  const [recharging, setRecharging] = useState(false)
  const [creditsModalOpen, setCreditsModalOpen] = useState(false)
  const isSigningOutRef = useRef(false)
  const activeSection = deploymentFeatures
    && !isProfileSectionEnabled(urlSection, deploymentFeatures)
    ? getDefaultProfileSection(deploymentFeatures)
    : urlSection

  const handleSignOut = useCallback(async () => {
    isSigningOutRef.current = true
    try {
      await signOut({ redirect: false, callbackUrl: '/' })
      router.replace({ pathname: '/' })
      router.refresh()
    } catch (error) {
      isSigningOutRef.current = false
      throw error
    }
  }, [router])

  useEffect(() => {
    if (status === 'loading' || isSigningOutRef.current) return
    if (!session) { router.push({ pathname: '/auth/signin' }); return }
  }, [router, session, status])

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
    if (isProfileSectionEnabled(urlSection, deploymentFeatures)) return

    const nextSection = getDefaultProfileSection(deploymentFeatures)
    router.replace(
      { pathname: '/profile', query: { section: nextSection } },
      { scroll: false },
    )
  }, [deploymentFeatures, router, urlSection])

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

  useEffect(() => {
    if (searchParams.get('recharge') === 'open') setCreditsModalOpen(true)
  }, [searchParams])

  if (deploymentLoadFailed) {
    throw new Error('PROFILE_DEPLOYMENT_FEATURES_UNAVAILABLE')
  }

  if (status === 'loading' || !session) {
    return <BrandPageLoading />
  }

  const noBillingText = t('openSourceNoBilling')
  const showBilling = deploymentFeatures?.showBilling === true
  const showRecharge = deploymentFeatures?.showRecharge === true
  const showInviteCode = deploymentFeatures?.showInviteCode === true
  const canManageCredits = showRecharge || showInviteCode
  const parsedRechargeAmount = Number(rechargeAmount)
  const estimatedPaymentAmount = rechargeConfig?.enabled === true && Number.isFinite(parsedRechargeAmount)
    ? parsedRechargeAmount
    : 0
  const sectionItems: Array<{
    section: ProfileSection
    icon: AppIconName
    label: string
  }> = [
    ...(deploymentFeatures?.showBilling === true
      ? [{ section: 'overview' as const, icon: 'user' as const, label: t('accountOverview') }]
      : []),
    ...(deploymentFeatures?.showAccountSecurity === true
      ? [{ section: 'security' as const, icon: 'lock' as const, label: t('accountSecurity.title') }]
      : []),
    ...(deploymentFeatures?.showApiConfig === true
      ? [{ section: 'apiConfig' as const, icon: 'settingsHexAlt' as const, label: t('apiConfig') }]
      : []),
    ...(deploymentFeatures?.showBilling === true
      ? [{ section: 'billing' as const, icon: 'receipt' as const, label: t('accountTransactions') }]
      : []),
  ]

  const handleSectionChange = (section: ProfileSection) => {
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
              <div className="mb-6 flex min-w-0 items-center gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white">
                  {(session.user?.name || t('user')).slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{session.user?.name || t('user')}</p>
                  <p className="truncate text-xs text-[var(--glass-text-tertiary)]">{t('personalAccount')}</p>
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
                type="button"
                onClick={() => { void handleSignOut() }}
                className="mt-auto flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--glass-tone-danger-fg)] transition hover:bg-[var(--glass-tone-danger-bg)]"
              >
                <AppIcon name="logout" className="h-4 w-4" />
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
              ) : activeSection === 'security' ? (
                <AccountSecurityTab
                  enablePasswordAuth={deploymentFeatures.enablePasswordAuth}
                  showGoogleOAuth={deploymentFeatures.showGoogleOAuth}
                />
              ) : activeSection === 'apiConfig' && deploymentFeatures.showApiConfig ? (
                <ApiConfigTab />
              ) : activeSection === 'overview' && showBilling ? (
                <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
                  {/* 可用额度概览 */}
                  <section className="glass-surface-soft rounded-2xl border border-[var(--glass-stroke-base)] p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('availableBalance')}</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-4xl font-bold tracking-tight text-[var(--glass-text-primary)]">
                            {(balance?.balance ?? 0).toFixed(2)}
                          </span>
                          <span className="text-sm text-[var(--glass-text-tertiary)]">{balance?.currency || 'CREDITS'}</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('recharge.unitValue')}</div>
                      </div>
                      {canManageCredits ? (
                        <button
                          type="button"
                          onClick={() => setCreditsModalOpen(true)}
                          className="glass-btn-base glass-btn-primary flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                        >
                          <AppIcon name="coins" className="h-4 w-4" />
                          {t('topUpOrRedeem')}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-4 py-3">
                        <p className="text-xs text-[var(--glass-text-tertiary)]">{t('frozen')}</p>
                        <p className="mt-0.5 text-lg font-semibold text-[var(--glass-text-primary)]">{formatAmount(balance?.frozenAmount, balance?.currency)}</p>
                      </div>
                      <div className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-4 py-3">
                        <p className="text-xs text-[var(--glass-text-tertiary)]">{t('totalSpent')}</p>
                        <p className="mt-0.5 text-lg font-semibold text-[var(--glass-text-primary)]">{formatAmount(balance?.totalSpent, balance?.currency)}</p>
                      </div>
                    </div>
                  </section>

                  {/* 最近账户流水 */}
                  <section className="glass-surface-soft flex-none rounded-2xl border border-[var(--glass-stroke-base)] p-5">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('recentTransactions')}</h2>
                      <button
                        type="button"
                        className="glass-btn-secondary rounded-xl px-4 py-2 text-sm"
                        onClick={() => handleSectionChange('billing')}
                      >
                        {t('viewAll')}
                      </button>
                    </div>
                    <ProfileTransactionsTable items={transactions.slice(0, 5)} currency={balance?.currency} />
                  </section>
                </div>
              ) : activeSection === 'billing' && showBilling ? (
                <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
                  <section className="glass-surface-soft flex-none rounded-2xl border border-[var(--glass-stroke-base)] p-5">
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
                    <ProfileTransactionsTable items={transactions} currency={balance?.currency} />
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

      {/* 充值与兑换 浮层弹窗（从可用额度打开） */}
      <GlassModalShell
        open={creditsModalOpen}
        onClose={() => setCreditsModalOpen(false)}
        title={t('manageCredits')}
        size="md"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {showRecharge ? (
            <section className="space-y-4 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-5 shadow-[var(--glass-shadow-sm)]">
              <div className="flex items-center gap-2">
                <AppIcon name="coins" className="h-4 w-4 text-[var(--glass-text-secondary)]" />
                <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('recharge.title')}</h3>
              </div>
              <p className="text-sm text-[var(--glass-text-tertiary)]">{t('recharge.description')}</p>
              {rechargeConfig?.enabled === true ? (
                <form
                  className="space-y-4"
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
                  <div className="flex flex-wrap gap-2">
                    {RECHARGE_PRESETS.filter((preset) => preset >= rechargeConfig.minCredits && preset <= rechargeConfig.maxCredits).map((preset) => {
                      const on = rechargeAmount === String(preset)
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setRechargeAmount(String(preset))}
                          className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${on ? 'border-[var(--glass-accent-from)] bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]' : 'border-[var(--glass-stroke-base)] bg-white text-[var(--glass-text-secondary)] hover:border-slate-300'}`}
                        >
                          {preset}
                        </button>
                      )
                    })}
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('recharge.customAmount')}</span>
                    <input
                      className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-4 py-3 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-slate-400"
                      type="number"
                      min={rechargeConfig.minCredits}
                      max={rechargeConfig.maxCredits}
                      step="0.01"
                      value={rechargeAmount}
                      onChange={(event) => setRechargeAmount(event.target.value)}
                      placeholder={t('recharge.placeholder')}
                    />
                  </label>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-xs text-[var(--glass-text-tertiary)]">{t('recharge.estimatedLabel')}</span>
                    <span className="text-lg font-semibold text-[var(--glass-text-primary)]">
                      {formatCurrencyAmount(estimatedPaymentAmount, rechargeConfig.paymentCurrency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--glass-text-tertiary)]">
                    <span>{t('recharge.range', { min: rechargeConfig.minCredits, max: rechargeConfig.maxCredits })}</span>
                    <span>{t('recharge.unitValue')}</span>
                  </div>
                  <button
                    type="submit"
                    disabled={recharging || !rechargeAmount.trim()}
                    className="glass-btn-base glass-btn-primary flex w-full items-center justify-center gap-1.5 rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon name="arrowRight" className="h-4 w-4" />
                    {recharging ? t('recharge.processing') : t('recharge.submit')}
                  </button>
                </form>
              ) : rechargeConfigError ? (
                <p className="text-sm text-[var(--glass-tone-danger-fg)]">{rechargeConfigError}</p>
              ) : (
                <p className="text-sm text-[var(--glass-text-secondary)]">{t('recharge.unavailable')}</p>
              )}
              {rechargeStatus ? (
                <p className="text-sm text-[var(--glass-text-secondary)]">{rechargeStatus}</p>
              ) : null}
            </section>
          ) : null}

          {showInviteCode ? (
            <section className="space-y-4 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-5 shadow-[var(--glass-shadow-sm)]">
              <div className="flex items-center gap-2">
                <AppIcon name="badgeCheck" className="h-4 w-4 text-[var(--glass-text-secondary)]" />
                <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('inviteCode.title')}</h3>
              </div>
              <p className="text-sm text-[var(--glass-text-tertiary)]">{t('inviteCode.description')}</p>
              <form
                className="flex flex-col gap-2 sm:flex-row"
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
                  className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-white px-4 py-3 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-slate-400"
                  value={inviteCode}
                  onChange={(event) => { setInviteCode(event.target.value); setRedeemStatus(null) }}
                  placeholder={t('inviteCode.placeholder')}
                />
                <button
                  type="submit"
                  disabled={redeeming || !inviteCode.trim()}
                  className="glass-btn-base glass-btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {redeeming ? t('inviteCode.redeeming') : t('inviteCode.redeem')}
                </button>
              </form>
              {redeemStatus ? (
                <p className="text-sm text-[var(--glass-text-secondary)]">{redeemStatus}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </GlassModalShell>
    </div >
  )
}
