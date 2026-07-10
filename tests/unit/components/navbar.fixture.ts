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
      personalCenter: '个人中心',
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

export { createElement } from 'react'
export type { ComponentProps, ReactElement } from 'react'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export { renderToStaticMarkup } from 'react-dom/server'
export { NextIntlClientProvider } from 'next-intl'
export type { AbstractIntlMessages } from 'next-intl'
export { default as Navbar } from '@/components/Navbar'
export { buildNavbarSettingsMenuItems, formatCompactCreditAmount, formatCreditAmount, shouldCloseNavbarSettingsMenu } from '@/components/Navbar'
export type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'
export { React, messages, renderWithIntl, useSessionMock }
