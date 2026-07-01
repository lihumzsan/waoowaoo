'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-fetch'
import LanguageSwitcher from './LanguageSwitcher'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { BrandLogoShape } from '@/components/ui/icons/BrandLogoShape'
import UpdateNoticeModal from './UpdateNoticeModal'
import { useGithubReleaseUpdate } from '@/hooks/common/useGithubReleaseUpdate'
import { Link } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'
import {
  fetchPublicDeploymentFeatures,
  type PublicDeploymentFeatures,
} from '@/lib/deployment/public-client'
import type { ProfileSection } from '@/lib/profile/sections'

interface NavbarSettingsBoundary {
  contains(target: Node | null): boolean
}

interface NavbarProps {
  reserveLayoutSpace?: boolean
  initialDeploymentFeatures?: PublicDeploymentFeatures | null
}

interface NavbarSettingsLabels {
  apiConfig: string
  billingRecords: string
}

export interface NavbarSettingsMenuItem {
  section: ProfileSection
  icon: AppIconName
  label: string
}

export function shouldCloseNavbarSettingsMenu(
  target: Node | null,
  trigger: NavbarSettingsBoundary | null | undefined,
  menu: NavbarSettingsBoundary | null | undefined,
) {
  if (target === null) return false
  if (trigger?.contains(target)) return false
  if (menu?.contains(target)) return false
  return true
}

interface NavbarUserBalance {
  currency: string
  balance: number
  frozenAmount: number
  totalSpent: number
}

function isNavbarBalancePayload(value: unknown): value is { success: boolean } & NavbarUserBalance {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.success === true &&
    typeof record.balance === 'number' &&
    typeof record.frozenAmount === 'number' &&
    typeof record.totalSpent === 'number'
  )
}

export function formatCreditAmount(value: number, unit: string): string {
  const amount = Number.isFinite(value) ? value : 0
  const normalizedUnit = unit.trim()
  if (normalizedUnit.length === 0) return amount.toFixed(2)
  return `${amount.toFixed(2)} ${normalizedUnit}`
}

export function formatCompactCreditAmount(value: number): string {
  return formatCreditAmount(value, '')
}

export function buildNavbarSettingsMenuItems(
  features: PublicDeploymentFeatures | null,
  labels: NavbarSettingsLabels,
): NavbarSettingsMenuItem[] {
  return [
    ...(features?.showApiConfig === true
      ? [{ section: 'apiConfig' as const, icon: 'settingsHexAlt' as const, label: labels.apiConfig }]
      : []),
    ...(features?.showBilling === true
      ? [{ section: 'billing' as const, icon: 'receipt' as const, label: labels.billingRecords }]
      : []),
  ]
}

function NavbarSessionLoadingSkeleton({ label }: { label: string }) {
  const skeletonClassName =
    'block rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-tone-neutral-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] motion-safe:animate-pulse'

  return (
    <div role="status" aria-label={label} className="flex items-center gap-2.5">
      <span aria-hidden="true" className={`${skeletonClassName} h-8 w-20`} />
      <span aria-hidden="true" className={`${skeletonClassName} h-8 w-24`} />
      <span aria-hidden="true" className={`${skeletonClassName} h-8 w-10`} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export default function Navbar({
  reserveLayoutSpace = true,
  initialDeploymentFeatures = null,
}: NavbarProps) {
  const { data: session, status } = useSession()
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const logoUid = `navbar-logo-${useId().replace(/:/g, '')}`
  const [deploymentFeatures, setDeploymentFeatures] = useState<PublicDeploymentFeatures | null>(initialDeploymentFeatures)
  const showUpdateCheck = deploymentFeatures?.showUpdateCheck === true
  const { currentVersion, update, shouldPulse, showModal, openModal, dismissCurrentUpdate, checkNow } = useGithubReleaseUpdate({
    enabled: showUpdateCheck,
  })
  const [checkMsg, setCheckMsg] = useState<string | null>(null)
  const [checkMsgFading, setCheckMsgFading] = useState(false)
  const [manualChecking, setManualChecking] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMenuStyle, setSettingsMenuStyle] = useState<CSSProperties | null>(null)
  const [balance, setBalance] = useState<NavbarUserBalance | null>(null)
  const settingsTriggerRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const downloadLogsHref = '/api/admin/download-logs'
  const settingsMenuId = 'navbar-settings-menu'
  const navControlClass = 'glass-selection-control inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium'

  const showPricingLink = deploymentFeatures?.showPricingPage === true
  const showRecharge = deploymentFeatures?.showRecharge === true
  const showBilling = deploymentFeatures?.showBilling === true
  const userName = session?.user?.name ?? t('profile')
  const creditsUnit = t('account.creditsUnit')
  const settingsMenuItems = buildNavbarSettingsMenuItems(deploymentFeatures, {
    apiConfig: t('settingsMenu.apiConfig'),
    billingRecords: t('settingsMenu.billingRecords'),
  })

  const handleCheckUpdate = async () => {
    setCheckMsg(null)
    setCheckMsgFading(false)
    setManualChecking(true)
    const minSpin = new Promise(r => setTimeout(r, 1000))
    await Promise.all([checkNow(), minSpin])
    setManualChecking(false)
    setTimeout(() => {
      setCheckMsg('upToDate')
      setTimeout(() => setCheckMsgFading(true), 2000)
      setTimeout(() => { setCheckMsg(null); setCheckMsgFading(false) }, 3000)
    }, 100)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchPublicDeploymentFeatures().then((features) => {
      if (!cancelled) setDeploymentFeatures(features)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 仅在计费已启用（cloud 版 showBilling=true）时拉取余额；
    // 本地/自托管版计费整体关闭，无余额概念，不显示。
    if (!session || !showBilling) {
      setBalance(null)
      return
    }
    let cancelled = false
    apiFetch('/api/user/balance')
      .then(async (response) => {
        if (!response.ok) return
        const payload: unknown = await response.json()
        if (!cancelled && isNavbarBalancePayload(payload)) {
          setBalance({
            currency: payload.currency,
            balance: payload.balance,
            frozenAmount: payload.frozenAmount,
            totalSpent: payload.totalSpent,
          })
        }
      })
      .catch(() => {
        /* 余额获取失败时静默降级，不阻塞导航栏 */
      })
    return () => {
      cancelled = true
    }
  }, [session, showBilling])

  useEffect(() => {
    if (!settingsOpen) return

    const updatePosition = () => {
      const trigger = settingsTriggerRef.current
      if (!trigger) return

      const rect = trigger.getBoundingClientRect()
      const width = 280
      const viewportPadding = 16
      const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
      const left = Math.min(Math.max(viewportPadding, rect.right - width), maxLeft)

      setSettingsMenuStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left,
        width,
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return

      if (shouldCloseNavbarSettingsMenu(event.target, settingsTriggerRef.current, settingsMenuRef.current)) {
        setSettingsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsOpen])

  const settingsMenu = (
    <div
      id={settingsMenuId}
      ref={settingsMenuRef}
      role="menu"
      aria-label={t('profile')}
      style={settingsMenuStyle ?? undefined}
      className="z-[1000] rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] p-2 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      {/* 账户头部：仅用户名 */}
      <div className="rounded-lg px-3 py-2">
        <div className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{userName}</div>
      </div>

      {/* 余额信息 */}
      {balance ? (
        <div className="mt-1 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-muted)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-[var(--glass-text-secondary)]">
              <AppIcon name="coins" className="h-3.5 w-3.5" />
              {t('account.balance')}
            </span>
            {showRecharge ? (
              <Link
                href={{ pathname: '/profile', query: { section: 'overview', recharge: 'open' } }}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSettingsOpen(false)}
                className="glass-btn-base glass-btn-primary px-2.5 py-1 text-xs font-medium"
              >
                {t('account.recharge')}
              </Link>
            ) : null}
          </div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">
            {formatCreditAmount(balance.balance, creditsUnit)}
          </div>
          {showBilling ? (
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--glass-text-tertiary)]">
              <span>{t('account.frozen')}: {formatCreditAmount(balance.frozenAmount, creditsUnit)}</span>
              <span>{t('account.totalSpent')}: {formatCreditAmount(balance.totalSpent, creditsUnit)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {settingsMenuItems.length > 0 || balance ? <div className="my-2 h-px bg-[var(--glass-stroke-base)]" /> : null}

      {settingsMenuItems.map(item => (
        <Link
          key={item.section}
          href={{ pathname: '/profile', query: { section: item.section } }}
          target="_blank"
          rel="noopener noreferrer"
          role="menuitem"
          onClick={() => setSettingsOpen(false)}
          className="glass-selection-control group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <AppIcon name={item.icon} className="h-4 w-4 transition-transform group-hover:scale-110" />
          <span>{item.label}</span>
        </Link>
      ))}
      <div className="my-2 h-px bg-[var(--glass-stroke-base)]" />
      <div className="rounded-lg px-1 py-1">
        <LanguageSwitcher />
      </div>
      <a
        href={downloadLogsHref}
        download
        role="menuitem"
        className="glass-selection-control group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
        title={t('downloadLogs')}
      >
        <AppIcon name="download" className="h-4 w-4 transition-transform group-hover:scale-110" />
        <span>{t('downloadLogs')}</span>
      </a>
      {showUpdateCheck ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => void handleCheckUpdate()}
          disabled={manualChecking}
          className="glass-selection-control group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium disabled:opacity-50"
        >
          <AppIcon name="refresh" className={`h-4 w-4 transition-transform group-hover:scale-110 ${manualChecking ? 'animate-spin' : ''}`} />
          <span>{tc('updateNotice.checkUpdate')}</span>
        </button>
      ) : null}
      <div className="my-2 h-px bg-[var(--glass-stroke-base)]" />
      <button
        type="button"
        role="menuitem"
        onClick={() => { setSettingsOpen(false); void signOut({ callbackUrl: '/' }) }}
        className="glass-selection-control group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--glass-tone-danger-fg)]"
      >
        <AppIcon name="logout" className="h-4 w-4 transition-transform group-hover:scale-110" />
        <span>{t('logout')}</span>
      </button>
    </div>
  )

  return (
    <>
      <nav className="pointer-events-none fixed inset-x-0 top-0 z-50 px-8 py-4 sm:px-10 lg:px-50">
        <div className="mx-auto flex max-w-none items-start justify-between gap-4">
          <div className="pointer-events-auto flex h-[52px] items-center gap-2">
            <Link
              href={session ? buildAuthenticatedHomeTarget() : { pathname: '/' }}
              target={session ? '_blank' : undefined}
              rel={session ? 'noopener noreferrer' : undefined}
              className="group flex h-[52px] w-[52px] items-center justify-center"
            >
              <BrandLogoShape
                uid={logoUid}
                size={52}
                title={tc('appName')}
                className="h-[52px] w-[52px] transition-transform group-hover:scale-105"
              />
            </Link>
            {showUpdateCheck && update ? (
              <button
                type="button"
                onClick={openModal}
                className="relative inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-tone-warning-fg)]/40 bg-[linear-gradient(135deg,var(--glass-tone-warning-bg),var(--glass-bg-surface-strong))] px-2.5 py-1 text-[11px] font-semibold text-[var(--glass-tone-warning-fg)] shadow-[0_8px_24px_-16px_rgba(245,158,11,0.9)] transition-all hover:brightness-105"
                aria-label={tc('updateNotice.openDialog')}
              >
                {shouldPulse ? <span className="absolute -inset-1 animate-ping rounded-full bg-[var(--glass-tone-warning-fg)] opacity-20" /> : null}
                <AppIcon name="upload" className="h-3.5 w-3.5" />
                {tc('updateNotice.updateTag')}
              </button>
            ) : showUpdateCheck && checkMsg === 'upToDate' ? (
              <span
                className="text-[11px] font-medium text-[var(--glass-tone-success-fg)] transition-opacity duration-1000"
                style={{ opacity: checkMsgFading ? 0 : 1 }}
              >
                ✓ {tc('updateNotice.upToDate')}
              </span>
            ) : null}
            <span className="sr-only">{tc('betaVersion', { version: currentVersion })}</span>
          </div>
          <div className="glass-surface-nav pointer-events-auto flex min-h-[52px] items-center gap-2 px-2 py-2">
            {status === 'loading' ? (
              <NavbarSessionLoadingSkeleton label={tc('loading')} />
            ) : session ? (
              <>
                {showPricingLink ? (
                  <Link
                    href={{ pathname: '/pricing' }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={navControlClass}
                  >
                    {t('pricing')}
                  </Link>
                ) : null}
                <Link
                  href={{ pathname: '/workspace' }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={navControlClass}
                >
                  <AppIcon name="monitor" className="w-4 h-4" />
                  {t('workspace')}
                </Link>
                <Link
                  href={{ pathname: '/workspace/asset-hub' }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={navControlClass}
                >
                  <AppIcon name="folderHeart" className="w-4 h-4" />
                  {t('assetHub')}
                </Link>
                <div ref={settingsTriggerRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={settingsOpen}
                    aria-controls={settingsMenuId}
                    onClick={() => setSettingsOpen(open => !open)}
                    className={navControlClass}
                    title={userName}
                  >
                    <span className="max-w-[10rem] truncate">{userName}</span>
                    {balance ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--glass-tone-info-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--glass-tone-info-fg)]">
                        <AppIcon name="coins" className="h-3 w-3" />
                        {formatCompactCreditAmount(balance.balance)}
                      </span>
                    ) : null}
                    <AppIcon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {!mounted ? (
                  <div className="hidden" aria-hidden="true">
                    {settingsMenuItems.map(item => (
                      <Link
                        key={item.section}
                        href={{ pathname: '/profile', query: { section: item.section } }}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.label}
                      </Link>
                    ))}
                    <a href={downloadLogsHref} download>{t('downloadLogs')}</a>
                    {showUpdateCheck ? <span>{tc('updateNotice.checkUpdate')}</span> : null}
                  </div>
                ) : null}
              </>

            ) : (
              <>
                {showPricingLink ? (
                  <Link
                    href={{ pathname: '/pricing' }}
                    className="glass-selection-control rounded-full px-2.5 py-1.5 text-sm font-medium"
                  >
                    {t('pricing')}
                  </Link>
                ) : null}
                <Link
                  href={{ pathname: '/auth/signin' }}
                  className="glass-selection-control rounded-full px-2.5 py-1.5 text-sm font-medium"
                >
                  {t('signin')}
                </Link>
                <Link
                  href={{ pathname: '/auth/signup' }}
                  className="glass-btn-base glass-btn-primary px-4 py-2 text-sm font-medium"
                >
                  {t('signup')}
                </Link>
                <LanguageSwitcher />
              </>
            )}
          </div>
        </div>
      </nav>
      {reserveLayoutSpace ? <div aria-hidden="true" className="h-16" /> : null}
      {showUpdateCheck && update ? (
        <UpdateNoticeModal
          show={showModal}
          currentVersion={currentVersion}
          latestVersion={update.latestVersion}
          releaseUrl={update.releaseUrl}
          releaseName={update.releaseName}
          publishedAt={update.publishedAt}
          onDismiss={dismissCurrentUpdate}
        />
      ) : null}
      {mounted && settingsOpen && settingsMenuStyle ? createPortal(settingsMenu, document.body) : null}
    </>
  )
}
