import * as React from 'react'
import { createElement } from 'react'
import type { ComponentProps, ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'
import Navbar, {
  buildNavbarSettingsMenuItems,
  formatCompactCreditAmount,
  formatCreditAmount,
  shouldCloseNavbarSettingsMenu,
} from '@/components/Navbar'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'

const useSessionMock = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}))

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string } & Record<string, unknown>) => createElement('img', { alt, ...props }),
}))

vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => createElement('div', null, 'LanguageSwitcher'),
}))

vi.mock('@/hooks/common/useGithubReleaseUpdate', () => ({
  useGithubReleaseUpdate: () => ({
    currentVersion: '0.3.0',
    update: null,
    shouldPulse: false,
    showModal: false,
    openModal: () => undefined,
    dismissCurrentUpdate: () => undefined,
    checkNow: async () => undefined,
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string; query?: Record<string, string> }
    children: React.ReactNode
  } & Record<string, unknown>) => {
    if (typeof href === 'string') {
      return createElement('a', { href, ...props }, children)
    }

    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : ''
    const resolvedHref = `${href.pathname}${query}`
    return createElement('a', { href: resolvedHref, ...props }, children)
  },
}))

const messages = {
  nav: {
    workspace: '工作区',
    assetHub: '资产中心',
    profile: '设置中心',
    pricing: '价格',
    settingsMenu: {
      apiConfig: 'API 配置',
      billingRecords: '扣费记录',
    },
    account: {
      balance: '可用余额',
      recharge: '充值',
      frozen: '冻结',
      totalSpent: '累计消费',
      creditsUnit: '额度',
    },
    downloadLogs: '下载日志',
    signin: '登录',
    signup: '注册',
    logout: '退出登录',
  },
  common: {
    appName: 'waoowaoo',
    loading: '加载中',
    betaVersion: 'Beta v{version}',
    updateNotice: {
      openDialog: '打开更新弹窗',
      updateTag: '更新',
      checkUpdate: '检查更新',
      upToDate: '已是最新版本',
    },
  },
} as const

const renderWithIntl = (node: ReactElement) => {
  const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
    locale: 'zh',
    messages: messages as unknown as AbstractIntlMessages,
    timeZone: 'Asia/Shanghai',
    children: node,
  }

  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, providerProps),
  )
}

describe('Navbar compact split navigation', () => {
  beforeEach(() => {
    useSessionMock.mockReset()
  })

  it('keeps download logs available inside the signed-in settings surface', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).toContain('下载日志')
    expect(html).toContain('href="/home"')
    expect(html).toContain('href="/api/admin/download-logs"')
    expect(html).toContain('download=""')
    expect(html).not.toContain('LanguageSwitcher')
    expect(html).toContain('pointer-events-none fixed')
    expect(html).toContain('glass-surface-nav')
    expect(html).not.toContain('glass-nav sticky')
  })

  it('renders the navbar brand as a square svg mark instead of a stretched bitmap', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).not.toContain('logo-small.png')
    expect(html).not.toContain('w-[200px]')
    expect(html).not.toContain('h-[62px]')
    expect(html).toContain('viewBox="0 0 120 120"')
    expect(html).toContain('h-[52px] w-[52px]')
  })

  it('shows a visible animated skeleton while the session is loading', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: null,
      status: 'loading',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="加载中"')
    expect(html).toContain('motion-safe:animate-pulse')
    expect(html).toContain('bg-[var(--glass-tone-neutral-bg)]')
    expect(html).toContain('border-[var(--glass-stroke-base)]')
    expect(html).not.toContain('bg-[var(--glass-bg-muted)] animate-pulse')
  })

  it('keeps signed-in profile section targets behind deployment feature hydration', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('href="/profile?section=apiConfig"')
    expect(html).not.toContain('href="/profile?section=billing"')
    expect(html).not.toContain('href="/profile?section=stylePresets"')
    expect(html).not.toContain('我的风格')
    expect(html).not.toContain('检查更新')
  })

  it('builds self-hosted settings with API configuration only', () => {
    const features: PublicDeploymentFeatures = {
      showOfficialPublicPages: false,
      showPricingPage: false,
      showLegalPages: false,
      showRecharge: false,
      showInviteCode: false,
      showBilling: false,
      showApiConfig: true,
      showAccountSecurity: false,
      showGoogleOAuth: false,
      showUpdateCheck: true,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: false,
    }

    expect(buildNavbarSettingsMenuItems(features, {
      apiConfig: 'API 配置',
      billingRecords: '扣费记录',
    })).toEqual([
      { section: 'apiConfig', icon: 'settingsHexAlt', label: 'API 配置' },
    ])
  })

  it('builds cloud settings with billing only', () => {
    const features: PublicDeploymentFeatures = {
      showOfficialPublicPages: true,
      showPricingPage: true,
      showLegalPages: true,
      showRecharge: true,
      showInviteCode: true,
      showBilling: true,
      showApiConfig: false,
      showAccountSecurity: true,
      showGoogleOAuth: true,
      showUpdateCheck: false,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: true,
    }

    expect(buildNavbarSettingsMenuItems(features, {
      apiConfig: 'API 配置',
      billingRecords: '扣费记录',
    })).toEqual([
      { section: 'billing', icon: 'receipt', label: '扣费记录' },
    ])
  })

  it('hides update checks for cloud deployment features', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const features: PublicDeploymentFeatures = {
      showOfficialPublicPages: true,
      showPricingPage: true,
      showLegalPages: true,
      showRecharge: true,
      showInviteCode: true,
      showBilling: true,
      showApiConfig: false,
      showAccountSecurity: true,
      showGoogleOAuth: true,
      showUpdateCheck: false,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: true,
    }

    const html = renderWithIntl(createElement(Navbar, { initialDeploymentFeatures: features }))

    expect(html).not.toContain('检查更新')
    expect(html).not.toContain('更新')
  })

  it('does not keep a persistent selected state on the current navbar route', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).toContain('glass-selection-control')
    expect(html).not.toContain('aria-current="page"')
    expect(html).not.toContain('data-active="true"')
  })

  it('does not render the download logs entry for signed-out users', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: null,
      status: 'unauthenticated',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).not.toContain('下载日志')
    expect(html).not.toContain('/api/admin/download-logs')
  })

  it('can skip layout space reservation for full-screen canvas pages', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const html = renderWithIntl(createElement(Navbar, { reserveLayoutSpace: false }))

    expect(html).toContain('pointer-events-none fixed')
    expect(html).not.toContain('class="h-16"')
  })

  it('closes the settings surface for blank page clicks outside the trigger and menu', () => {
    const triggerTarget = {} as Node
    const menuTarget = {} as Node
    const pageTarget = {} as Node
    const trigger = { contains: (target: Node | null) => target === triggerTarget }
    const menu = { contains: (target: Node | null) => target === menuTarget }

    expect(shouldCloseNavbarSettingsMenu(triggerTarget, trigger, menu)).toBe(false)
    expect(shouldCloseNavbarSettingsMenu(menuTarget, trigger, menu)).toBe(false)
    expect(shouldCloseNavbarSettingsMenu(pageTarget, trigger, menu)).toBe(true)
    expect(shouldCloseNavbarSettingsMenu(null, trigger, menu)).toBe(false)
  })

  it('keeps menu balance units while allowing compact trigger balance text', () => {
    expect(formatCompactCreditAmount(100)).toBe('100.00')
    expect(formatCreditAmount(100, '额度')).toBe('100.00 额度')
  })
})
