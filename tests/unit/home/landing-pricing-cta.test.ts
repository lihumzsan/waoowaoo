import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import HomeClient from '@/app/[locale]/HomeClient'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: null,
    status: 'unauthenticated',
  }),
}))

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string } & Record<string, unknown>) => createElement('img', { alt, ...props }),
}))

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const messages: Record<string, Record<string, string>> = {
      landing: {
        title: 'waoowaoo',
        subtitle: 'AI影视Studio',
        getStarted: '立即体验',
      },
      nav: {
        pricing: '价格',
      },
    }
    return messages[namespace]?.[key] ?? `${namespace}.${key}`
  },
}))

vi.mock('@/components/Navbar', () => ({
  default: () => createElement('nav', null, 'Navbar'),
}))

vi.mock('@/components/PublicFooter', () => ({
  default: () => createElement('footer', null, 'PublicFooter'),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string }
    children: React.ReactNode
  } & Record<string, unknown>) => {
    const resolvedHref = typeof href === 'string' ? href : href.pathname
    return createElement('a', { href: resolvedHref, ...props }, children)
  },
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

const cloudFeatures: PublicDeploymentFeatures = {
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

describe('unauthenticated landing pricing CTA', () => {
  it('renders a pricing link beside the get-started CTA when public pricing is enabled', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(HomeClient, {
      initialDeploymentFeatures: cloudFeatures,
    }))

    expect(html).toContain('href="/auth/signup"')
    expect(html).toContain('立即体验')
    expect(html).toContain('href="/pricing"')
    expect(html).toContain('价格')
  })

  it('hides the pricing CTA when the deployment disables the pricing page', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(HomeClient, {
      initialDeploymentFeatures: {
        ...cloudFeatures,
        showPricingPage: false,
      },
    }))

    expect(html).toContain('href="/auth/signup"')
    expect(html).not.toContain('href="/pricing"')
  })
})
