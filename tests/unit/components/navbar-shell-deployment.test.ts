import * as React from 'react'

import {
  Navbar,
  beforeEach,
  buildNavbarSettingsMenuItems,
  createElement,
  describe,
  expect,
  it,
  renderWithIntl,
  useSessionMock,
  type PublicDeploymentFeatures,
} from './navbar.fixture'

describe('Navbar compact split navigation', () => {
  beforeEach(() => {
    useSessionMock.mockReset()
  })

  it('keeps self-hosted download logs available while placing language beside the account trigger', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

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
      showDownloadLogs: true,
      showUpdateCheck: true,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: false,
    }

    const html = renderWithIntl(createElement(Navbar, { initialDeploymentFeatures: features }))

    expect(html).toContain('下载日志')
    expect(html).toContain('href="/home"')
    expect(html).toContain('href="/api/admin/download-logs"')
    expect(html).toContain('download=""')
    expect(html).toContain('LanguageSwitcher')
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
      showDownloadLogs: true,
      showUpdateCheck: true,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: false,
    }

    expect(buildNavbarSettingsMenuItems(features, {
      apiConfig: 'API 配置',
      personalCenter: '个人中心',
    })).toEqual([
      { section: 'apiConfig', icon: 'settingsHexAlt', label: 'API 配置' },
    ])
  })

  it('builds cloud settings with one personal center entry', () => {
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
      showDownloadLogs: false,
      showUpdateCheck: false,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: true,
    }

    expect(buildNavbarSettingsMenuItems(features, {
      apiConfig: 'API 配置',
      personalCenter: '个人中心',
    })).toEqual([
      { section: 'overview', icon: 'user', label: '个人中心' },
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
      showDownloadLogs: false,
      showUpdateCheck: false,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: true,
    }

    const html = renderWithIntl(createElement(Navbar, { initialDeploymentFeatures: features }))

    expect(html).not.toContain('检查更新')
    expect(html).not.toContain('更新')
  })
})
