'use client'

import Image from 'next/image'
import { useState, type CSSProperties, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import {
  computeNavbarBalanceRatio,
  formatCreditAmount,
  type NavbarSettingsMenuItem,
  type NavbarUserBalance,
} from './account-menu-model'

// Raycast/Arc 风格账户菜单卡:头像 + 邮箱、余额进度、渐变升级 CTA、
// 图标菜单项与内嵌语言切换。能力可见性完全来自传入的 features 投影。

interface NavbarAccountMenuProps {
  menuId: string
  menuRef: RefObject<HTMLDivElement | null>
  style: CSSProperties | null
  userName: string
  userEmail: string | null
  userImage: string | null
  balance: NavbarUserBalance | null
  creditsUnit: string
  showBilling: boolean
  showRecharge: boolean
  showDownloadLogs: boolean
  showUpdateCheck: boolean
  manualChecking: boolean
  downloadLogsHref: string
  settingsMenuItems: readonly NavbarSettingsMenuItem[]
  onCheckUpdate: () => void
  onClose: () => void
  onSignOut: () => void
}

export function NavbarUserAvatar({
  name,
  image,
  size = 'sm',
}: {
  name: string
  image: string | null
  size?: 'sm' | 'md'
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const sizeClass = size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs'

  if (image && failedImage !== image) {
    const pixels = size === 'md' ? 36 : 28
    return (
      <Image
        aria-hidden="true"
        src={image}
        alt=""
        width={pixels}
        height={pixels}
        sizes={`${pixels}px`}
        className={`${sizeClass} shrink-0 rounded-full object-cover shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]`}
        onError={() => setFailedImage(image)}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${sizeClass} shrink-0 select-none items-center justify-center rounded-full bg-[image:var(--glass-cta-gradient)] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]`}
    >
      {name.trim().slice(0, 1)}
    </span>
  )
}

export default function NavbarAccountMenu({
  menuId,
  menuRef,
  style,
  userName,
  userEmail,
  userImage,
  balance,
  creditsUnit,
  showBilling,
  showRecharge,
  showDownloadLogs,
  showUpdateCheck,
  manualChecking,
  downloadLogsHref,
  settingsMenuItems,
  onCheckUpdate,
  onClose,
  onSignOut,
}: NavbarAccountMenuProps) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')

  return (
    <div
      id={menuId}
      ref={menuRef}
      role="menu"
      aria-label={t('profile')}
      style={style ?? undefined}
      className="glass-menu-card z-[1000] p-2"
    >
      {/* 账户头部:头像 + 名称 + 邮箱 */}
      <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
        <NavbarUserAvatar name={userName} image={userImage} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{userName}</div>
          {userEmail ? (
            <div className="truncate text-xs text-[var(--glass-text-tertiary)]">{userEmail}</div>
          ) : null}
        </div>
      </div>

      {/* 余额:大数字 + 进度条 + 升级 CTA */}
      {balance ? (
        <div className="mx-0.5 mb-1 rounded-xl border border-[var(--glass-stroke-soft)] bg-white/70 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
              <AppIcon name="coins" className="h-3.5 w-3.5" />
              {t('account.balance')}
            </span>
            {showRecharge ? (
              <Link
                href="/pricing"
                onClick={onClose}
                className="glass-btn-base glass-btn-cta rounded-full px-3 py-1 text-xs font-semibold"
              >
                <AppIcon name="sparkles" className="h-3 w-3" />
                {t('account.upgrade')}
              </Link>
            ) : null}
          </div>
          <div className="glass-num mt-1.5 text-xl font-bold tracking-tight text-[var(--glass-text-primary)]">
            {formatCreditAmount(balance.balance, creditsUnit)}
          </div>
          {/* A bought term simply stops when it runs out, so the reminder has
              to arrive before it does. */}
          {balance.plan?.expiringSoon ? (
            <div className="mt-1.5 text-[11px] font-medium text-[var(--glass-warning,#f5a524)]">
              {balance.plan.daysLeft > 0
                ? t('account.planExpiringSoon', { days: balance.plan.daysLeft })
                : t('account.planExpired')}
            </div>
          ) : null}
          {balance.health === 'ok' ? null : (
            <div
              className={`mt-1.5 text-[11px] font-medium ${
                balance.health === 'empty'
                  ? 'text-[var(--glass-danger,#e5484d)]'
                  : 'text-[var(--glass-warning,#f5a524)]'
              }`}
            >
              {balance.health === 'empty'
                ? t('account.emptyBalance')
                : t('account.lowBalance', { clips: balance.referenceClipsRemaining })}
            </div>
          )}
          {showBilling ? (
            <>
              <div className="glass-meter-track mt-2.5" aria-hidden="true">
                <div
                  className="glass-meter-fill"
                  style={{ width: `${Math.round(computeNavbarBalanceRatio(balance) * 100)}%` }}
                />
              </div>
              <div className="glass-num mt-2 flex items-center justify-between text-[11px] text-[var(--glass-text-tertiary)]">
                <span>{t('account.frozen')} {formatCreditAmount(balance.frozenAmount, creditsUnit)}</span>
                <span>{t('account.totalSpent')} {formatCreditAmount(balance.totalSpent, creditsUnit)}</span>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {settingsMenuItems.length > 0 || balance ? (
        <div className="mx-2 my-1.5 h-px bg-[var(--glass-stroke-base)]" />
      ) : null}

      {/* 个人中心 / API 配置(features 投影) */}
      {settingsMenuItems.map(item => (
        <Link
          key={item.section}
          href={{ pathname: '/profile', query: { section: item.section } }}
          target="_blank"
          rel="noopener noreferrer"
          role="menuitem"
          onClick={onClose}
          className="glass-menu-item"
        >
          <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
        </Link>
      ))}

      {/* 语言(唯一切换入口,内嵌展开) */}
      <LanguageSwitcher variant="menu-row" />

      {showDownloadLogs || showUpdateCheck ? (
        <div className="mx-2 my-1.5 h-px bg-[var(--glass-stroke-base)]" />
      ) : null}

      {showDownloadLogs ? (
        <a
          href={downloadLogsHref}
          download
          role="menuitem"
          className="glass-menu-item"
          title={t('downloadLogs')}
        >
          <AppIcon name="download" className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{t('downloadLogs')}</span>
        </a>
      ) : null}
      {showUpdateCheck ? (
        <button
          type="button"
          role="menuitem"
          onClick={onCheckUpdate}
          disabled={manualChecking}
          className="glass-menu-item disabled:opacity-50"
        >
          <AppIcon name="refresh" className={`h-4 w-4 shrink-0 ${manualChecking ? 'animate-spin' : ''}`} />
          <span className="flex-1 text-left">{tc('updateNotice.checkUpdate')}</span>
        </button>
      ) : null}

      <div className="mx-2 my-1.5 h-px bg-[var(--glass-stroke-base)]" />

      <button
        type="button"
        role="menuitem"
        onClick={onSignOut}
        className="glass-menu-item glass-menu-item-danger"
      >
        <AppIcon name="logout" className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{t('logout')}</span>
      </button>
    </div>
  )
}
