import type { AppIconName } from '@/components/ui/icons'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'
import type { ProfileSection } from '@/lib/profile/sections'

// Navbar 账户菜单的纯投影模型:仅根据 deployment features contract 与
// 权威余额 payload 派生展示数据,不解释任何业务生命周期。

export interface NavbarSettingsBoundary {
  contains(target: Node | null): boolean
}

export interface NavbarSettingsLabels {
  apiConfig: string
  personalCenter: string
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

export function buildNavbarSettingsMenuItems(
  features: PublicDeploymentFeatures | null,
  labels: NavbarSettingsLabels,
): NavbarSettingsMenuItem[] {
  return [
    ...(features?.showApiConfig === true
      ? [{ section: 'apiConfig' as const, icon: 'settingsHexAlt' as const, label: labels.apiConfig }]
      : []),
  ]
}

/**
 * 余额进度感:可用余额占「可用 + 累计消费」的比例,仅用于视觉呈现。
 * 总量为 0 时视为满额,避免除零。
 */
