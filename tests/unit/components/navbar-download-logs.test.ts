import * as React from 'react'
import { createElement } from 'react'
import type { ComponentProps, ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'
import Navbar, { shouldCloseNavbarSettingsMenu } from '@/components/Navbar'

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
    settingsMenu: {
      apiConfig: 'API 配置',
      billingRecords: '扣费记录',
    },
    downloadLogs: '下载日志',
    signin: '登录',
    signup: '注册',
  },
  common: {
    appName: 'waoowaoo',
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

  it('renders settings center dropdown targets for signed-in users', () => {
    Reflect.set(globalThis, 'React', React)
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Earth' } },
      status: 'authenticated',
    })

    const html = renderWithIntl(createElement(Navbar))

    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('href="/profile?section=apiConfig"')
    expect(html).not.toContain('href="/profile?section=stylePresets"')
    expect(html).not.toContain('我的风格')
    expect(html).toContain('href="/profile?section=billing"')
    expect(html).toContain('检查更新')
    expect(html.indexOf('API 配置')).toBeLessThan(html.indexOf('扣费记录'))
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
})
