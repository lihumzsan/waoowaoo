'use client'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import AccountSecurityTab from './components/AccountSecurityTab'
import ApiConfigTab from './components/ApiConfigTab'
import ProfileSidebar, { type ProfileSectionItem } from './components/ProfileSidebar'
import { BrandPageLoading } from '@/components/ui/BrandLoading'
import { AppIcon } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { readProfileSectionParam, type ProfileSection } from '@/lib/profile/sections'
import { apiFetch } from '@/lib/api-fetch'
import {
  isPublicDeploymentFeatures,
  type PublicDeploymentFeatures,
} from '@/lib/deployment/public-client'

type DeploymentPayload = {
  features?: PublicDeploymentFeatures
}

function isDeploymentPayload(value: unknown): value is DeploymentPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getDefaultProfileSection(features: PublicDeploymentFeatures): ProfileSection {
  if (features.showAccountSecurity) return 'security'
  if (features.showApiConfig) return 'apiConfig'
  return 'security'
}

function isProfileSectionEnabled(section: ProfileSection, features: PublicDeploymentFeatures): boolean {
  if (section === 'security') return features.showAccountSecurity
  if (section === 'apiConfig') return features.showApiConfig
  return section === 'security' || section === 'apiConfig'
}

function ProfilePageContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('profile')
  const tc = useTranslations('common')
  if (!searchParams) {
    throw new Error('ProfilePage requires searchParams')
  }

  const urlSection = readProfileSectionParam(searchParams.get('section'))

  const [deploymentFeatures, setDeploymentFeatures] = useState<PublicDeploymentFeatures | null>(null)
  const [deploymentLoadFailed, setDeploymentLoadFailed] = useState(false)
  const isSigningOutRef = useRef(false)
  const activeSection = deploymentFeatures
    && !isProfileSectionEnabled(urlSection, deploymentFeatures)
    ? getDefaultProfileSection(deploymentFeatures)
    : urlSection

  const handleSignOut = useCallback(async () => {
    isSigningOutRef.current = true
    try {
      await signOut({ redirect: false, callbackUrl: '/' })
      router.replace({ pathname: '/' })
      router.refresh()
    } catch (error) {
      isSigningOutRef.current = false
      throw error
    }
  }, [router])

  useEffect(() => {
    if (status === 'loading' || isSigningOutRef.current) return
    if (!session) { router.push({ pathname: '/auth/signin' }); return }
  }, [router, session, status])

  useEffect(() => {
    if (!session) return
    let canceled = false

    const loadDeployment = async () => {
      const response = await apiFetch('/api/deployment')
      if (!response.ok) {
        if (!canceled) setDeploymentLoadFailed(true)
        return
      }
      const payload: unknown = await response.json()
      if (!canceled && isDeploymentPayload(payload) && isPublicDeploymentFeatures(payload.features)) {
        setDeploymentFeatures(payload.features)
        setDeploymentLoadFailed(false)
      } else if (!canceled) {
        setDeploymentLoadFailed(true)
      }
    }

    void loadDeployment()
    return () => {
      canceled = true
    }
  }, [session])

  useEffect(() => {
    if (!deploymentFeatures) return
    if (isProfileSectionEnabled(urlSection, deploymentFeatures)) return

    const nextSection = getDefaultProfileSection(deploymentFeatures)
    router.replace(
      { pathname: '/profile', query: { section: nextSection } },
      { scroll: false },
    )
  }, [deploymentFeatures, router, urlSection])

  if (deploymentLoadFailed) {
    throw new Error('PROFILE_DEPLOYMENT_FEATURES_UNAVAILABLE')
  }

  if (status === 'loading' || !session) {
    return <BrandPageLoading />
  }

  const sectionItems: ProfileSectionItem[] = [
    ...(deploymentFeatures?.showAccountSecurity === true
      ? [{ section: 'security' as const, icon: 'lock' as const, label: t('accountSecurity.title') }]
      : []),
    ...(deploymentFeatures?.showApiConfig === true
      ? [{ section: 'apiConfig' as const, icon: 'settingsHexAlt' as const, label: t('apiConfig') }]
      : []),
  ]

  const handleSectionChange = (section: ProfileSection) => {
    router.replace(
      { pathname: '/profile', query: { section } },
      { scroll: false },
    )
  }

  return (
    <div className="glass-page min-h-screen">
      <Navbar />

      <main className="mx-auto max-w-[1240px] px-6 pb-14 pt-2">
        {/* 大标题页头 */}
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--glass-text-primary)]">
            {t('pageTitle')}
          </h1>
        </header>

        <div className="flex items-start gap-6">
          <ProfileSidebar
            userName={session.user?.name || t('user')}
            userEmail={session.user?.email ?? null}
            sectionItems={sectionItems}
            activeSection={activeSection}
            onSectionChange={handleSectionChange}
            onSignOut={() => { void handleSignOut() }}
          />

          <div className="min-w-0 flex-1">
            {deploymentFeatures === null ? (
              <div className="glass-surface-elevated flex min-h-64 items-center justify-center text-sm text-[var(--glass-text-secondary)]">
                {tc('loading')}
              </div>
            ) : activeSection === 'security' ? (
              <div className="glass-surface-elevated overflow-hidden">
                <AccountSecurityTab
                  enablePasswordAuth={deploymentFeatures.enablePasswordAuth}
                  showGoogleOAuth={deploymentFeatures.showGoogleOAuth}
                  showWechatOfficialAuth={deploymentFeatures.showWechatOfficialAuth}
                />
              </div>
            ) : activeSection === 'apiConfig' && deploymentFeatures.showApiConfig ? (
              <div className="glass-surface-elevated overflow-hidden">
                <ApiConfigTab />
              </div>
            ) : (
              <div className="glass-surface-elevated flex min-h-64 flex-col items-center justify-center px-6 py-16 text-center">
                <AppIcon name="user" className="mb-4 h-12 w-12 text-[var(--glass-text-tertiary)]" />
                <p className="text-base font-semibold text-[var(--glass-text-primary)]">{t('pageTitle')}</p>
              </div>
            )}
          </div>
        </div>
      </main>

    </div>
  )
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<BrandPageLoading />}>
      <ProfilePageContent />
    </Suspense>
  )
}
