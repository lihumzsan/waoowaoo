'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { signOut, useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-fetch'
import LanguageSwitcher from './LanguageSwitcher'
import { AppIcon } from '@/components/ui/icons'
import { BrandLogoShape } from '@/components/ui/icons/BrandLogoShape'
import UpdateNoticeModal from './UpdateNoticeModal'
import { useGithubReleaseUpdate } from '@/hooks/common/useGithubReleaseUpdate'
import { Link, useRouter } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'
import {
  fetchPublicDeploymentFeatures,
  type PublicDeploymentFeatures,
} from '@/lib/deployment/public-client'
import NavbarAccountMenu, { NavbarUserAvatar } from './navbar/NavbarAccountMenu'
import {
  buildNavbarSettingsMenuItems,
  isNavbarBalancePayload,
  readNavbarPlan,
  shouldCloseNavbarSettingsMenu,
  type NavbarUserBalance,
} from './navbar/account-menu-model'

// 单测/调用方契约:纯投影 helper 的权威实现在 navbar/account-menu-model.ts。
export {
  buildNavbarSettingsMenuItems,
  formatCompactCreditAmount,
  formatCreditAmount,
  shouldCloseNavbarSettingsMenu,
  type NavbarSettingsMenuItem,
} from './navbar/account-menu-model'

const ACCOUNT_MENU_WIDTH = 300

interface NavbarProps {
  reserveLayoutSpace?: boolean
  initialDeploymentFeatures?: PublicDeploymentFeatures | null
  /**
   * viewport(默认):dock 停靠视口右上角。
   * assistant-panel:画布页专用,dock 贴住助手玻璃塔左上外缘,
   * 通过面板写入的 --workspace-assistant-panel-width 跟随面板拖宽。
   */
  dockAnchor?: 'viewport' | 'assistant-panel'
}

function NavbarSessionLoadingSkeleton({ label }: { label: string }) {
  const skeletonClassName =
    'block rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-skeleton-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] motion-safe:animate-pulse'

  return (
    <div role="status" aria-label={label} className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`${skeletonClassName} h-9 w-9`} />
      <span aria-hidden="true" className={`${skeletonClassName} h-9 w-9`} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export default function Navbar({
  reserveLayoutSpace = true,
  initialDeploymentFeatures = null,
  dockAnchor = 'viewport',
}: NavbarProps) {
  const { data: session, status } = useSession()
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const router = useRouter()
  const logoUid = `navbar-logo-${useId().replace(/:/g, '')}`
  const [deploymentFeatures, setDeploymentFeatures] = useState<PublicDeploymentFeatures | null>(initialDeploymentFeatures)
  const showUpdateCheck = deploymentFeatures?.showUpdateCheck === true
  const showBetaBadge = deploymentFeatures?.showBetaBadge === true
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

  const showPricingLink = deploymentFeatures?.showPricingPage === true
  const showRecharge = deploymentFeatures?.showRecharge === true
  const showBilling = deploymentFeatures?.showBilling === true
  const showDownloadLogs = deploymentFeatures?.showDownloadLogs === true
  const userName = session?.user?.name ?? t('profile')
  const userEmail = session?.user?.email ?? null
  const userImage = session?.user?.image ?? null
  const creditsUnit = t('account.creditsUnit')
  const settingsMenuItems = buildNavbarSettingsMenuItems(deploymentFeatures, {
    apiConfig: t('settingsMenu.apiConfig'),
    personalCenter: t('settingsMenu.personalCenter'),
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

  const handleSignOut = useCallback(async () => {
    setSettingsOpen(false)
    await signOut({ redirect: false, callbackUrl: '/' })
    router.replace({ pathname: '/' })
    router.refresh()
  }, [router])

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
            health: payload.health,
            referenceClipsRemaining: payload.referenceClipsRemaining,
            plan: readNavbarPlan((payload as { subscription?: unknown }).subscription),
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
      const width = ACCOUNT_MENU_WIDTH
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

  const dockStyle: CSSProperties | undefined =
    dockAnchor === 'assistant-panel'
      ? {
          position: 'fixed',
          top: '0.75rem',
          right: 'calc(var(--workspace-assistant-panel-width, 0px) + 0.75rem)',
        }
      : undefined

  return (
    <>
      <nav className="pointer-events-none fixed inset-x-0 top-0 z-50 px-8 py-4 sm:px-10 lg:px-50">
        <div className="mx-auto flex max-w-none items-start justify-between gap-4">
          <div className="pointer-events-auto flex h-[52px] items-center gap-2">
            <Link
              href={session ? buildAuthenticatedHomeTarget() : { pathname: '/' }}
              target={session ? '_blank' : undefined}
              rel={session ? 'noopener noreferrer' : undefined}
              className="group flex h-[52px] items-center gap-2"
            >
              <BrandLogoShape
                uid={logoUid}
                size={48}
                title={tc('appName')}
                className="h-12 w-12 transition-transform group-hover:scale-105"
              />
              <span className="flex flex-col items-start leading-none">
                <span className="text-[15px] font-bold tracking-[-0.02em] text-[var(--glass-text-primary)]">
                  {tc('appName')}
                </span>
                {showBetaBadge ? (
                  <span className="mt-1 rounded-full bg-[var(--glass-tone-surface)] px-1.5 py-0.5 text-[8px] font-bold tracking-[0.18em] text-[var(--glass-tone-info-fg)] shadow-[var(--glass-tone-shadow)]">
                    {tc('betaBadge')}
                  </span>
                ) : null}
              </span>
            </Link>
            {showUpdateCheck && update ? (
              <button
                type="button"
                onClick={openModal}
                className="relative inline-flex items-center gap-1.5 rounded-full bg-[var(--glass-tone-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--glass-tone-warning-fg)] shadow-[var(--glass-tone-shadow)] transition-shadow hover:shadow-[var(--glass-tone-shadow-hover)]"
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
          <div className="glass-dock-capsule pointer-events-auto" style={dockStyle}>
            {status === 'loading' ? (
              <NavbarSessionLoadingSkeleton label={tc('loading')} />
            ) : session ? (
              <>
                <Link
                  href={{ pathname: '/workspace' }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass-dock-item"
                  title={t('workspace')}
                  aria-label={t('workspace')}
                >
                  <AppIcon name="monitor" className="h-[18px] w-[18px]" />
                </Link>
                <div ref={settingsTriggerRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={settingsOpen}
                    aria-controls={settingsMenuId}
                    onClick={() => setSettingsOpen(open => !open)}
                    className="glass-dock-item"
                    title={userName}
                    aria-label={userName}
                  >
                    <NavbarUserAvatar name={userName} image={userImage} />
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
                    {showDownloadLogs ? <a href={downloadLogsHref} download>{t('downloadLogs')}</a> : null}
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
                  className="glass-btn-base glass-btn-cta rounded-full px-4 py-2 text-sm font-medium"
                >
                  {t('authEntry')}
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
      {mounted && settingsOpen && settingsMenuStyle ? createPortal(
        <NavbarAccountMenu
          menuId={settingsMenuId}
          menuRef={settingsMenuRef}
          style={settingsMenuStyle}
          userName={userName}
          userEmail={userEmail}
          userImage={userImage}
          balance={balance}
          creditsUnit={creditsUnit}
          showBilling={showBilling}
          showRecharge={showRecharge}
          showDownloadLogs={showDownloadLogs}
          showUpdateCheck={showUpdateCheck}
          manualChecking={manualChecking}
          downloadLogsHref={downloadLogsHref}
          settingsMenuItems={settingsMenuItems}
          onCheckUpdate={() => void handleCheckUpdate()}
          onClose={() => setSettingsOpen(false)}
          onSignOut={() => void handleSignOut()}
        />,
        document.body,
      ) : null}
    </>
  )
}
