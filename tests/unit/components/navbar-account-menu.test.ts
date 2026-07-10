import * as React from 'react'

import {
  Navbar,
  beforeEach,
  createElement,
  describe,
  expect,
  formatCompactCreditAmount,
  formatCreditAmount,
  it,
  renderWithIntl,
  shouldCloseNavbarSettingsMenu,
  useSessionMock,
  type PublicDeploymentFeatures,
} from './navbar.fixture'

describe('Navbar compact split navigation', () => {
  beforeEach(() => {
    useSessionMock.mockReset()
  })

  it('hides download logs and logout from the cloud account surface', () => {
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

    expect(html).toContain('个人中心')
    expect(html).toContain('LanguageSwitcher')
    expect(html).not.toContain('下载日志')
    expect(html).not.toContain('/api/admin/download-logs')
    expect(html).not.toContain('退出登录')
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
