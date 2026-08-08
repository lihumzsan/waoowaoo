'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { ProfileSection } from '@/lib/profile/sections'

// 个人中心左侧导航:用户卡 + section 切换 + 退出。纯投影,不发起数据请求。

export interface ProfileSectionItem {
  section: ProfileSection
  icon: AppIconName
  label: string
}

interface ProfileSidebarProps {
  userName: string
  userEmail: string | null
  sectionItems: readonly ProfileSectionItem[]
  activeSection: ProfileSection
  onSectionChange: (section: ProfileSection) => void
  onSignOut: () => void
}

export default function ProfileSidebar({
  userName,
  userEmail,
  sectionItems,
  activeSection,
  onSectionChange,
  onSignOut,
}: ProfileSidebarProps) {
  const t = useTranslations('profile')

  return (
    <aside className="glass-surface-elevated sticky top-24 flex w-64 flex-shrink-0 flex-col p-4">
      {/* 用户信息 */}
      <div className="mb-4 flex min-w-0 items-center gap-3 rounded-xl px-2 py-2">
        <span className="inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full bg-[image:var(--glass-cta-gradient)] text-base font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
          {(userName || t('user')).trim().slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{userName || t('user')}</p>
          <p className="truncate text-xs text-[var(--glass-text-tertiary)]">{userEmail ?? t('personalAccount')}</p>
        </div>
      </div>

      <div className="mb-3 h-px bg-[var(--glass-stroke-base)]" />

      {/* section 导航 */}
      <nav className="space-y-1">
        {sectionItems.map(item => (
          <button
            key={item.section}
            type="button"
            data-active={activeSection === item.section}
            onClick={() => onSectionChange(item.section)}
            className="glass-selection-control flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium"
          >
            <AppIcon name={item.icon} className="h-[18px] w-[18px]" />
            <span>{item.label}</span>
            {activeSection === item.section ? (
              <span aria-hidden="true" className="ml-auto h-4 w-1 rounded-full bg-[image:var(--glass-cta-gradient)]" />
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mt-4 h-px bg-[var(--glass-stroke-base)]" />

      {/* 退出登录 */}
      <button
        type="button"
        onClick={onSignOut}
        className="mt-3 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--glass-tone-danger-fg)] transition-colors duration-150 hover:bg-[var(--glass-tone-soft)]"
      >
        <AppIcon name="logout" className="h-4 w-4" />
        {t('logout')}
      </button>
    </aside>
  )
}
