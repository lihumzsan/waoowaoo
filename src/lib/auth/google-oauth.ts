import GoogleProvider from 'next-auth/providers/google'
import type { DeploymentFeatures } from '@/lib/deployment/features'

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

const GOOGLE_PROFILE_IMAGE_HOST_SUFFIXES = [
  'googleusercontent.com',
  'ggpht.com',
] as const

function readTrimmedEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name}_MISSING`)
  }
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGoogleProfileImageHostname(hostname: string): boolean {
  return GOOGLE_PROFILE_IMAGE_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  )
}

export function readGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: readTrimmedEnv('GOOGLE_CLIENT_ID'),
    clientSecret: readTrimmedEnv('GOOGLE_CLIENT_SECRET'),
  }
}

export function createGoogleOAuthProvider(
  features: Pick<DeploymentFeatures, 'showGoogleOAuth'>,
): ReturnType<typeof GoogleProvider> | null {
  if (!features.showGoogleOAuth) return null

  return GoogleProvider({
    ...readGoogleOAuthConfig(),
    allowDangerousEmailAccountLinking: false,
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: readGoogleProfileImage(profile),
      }
    },
  })
}

export function readVerifiedGoogleProfileEmail(profile: unknown): string | null {
  if (!isRecord(profile)) return null
  const email = profile.email
  const emailVerified = profile.email_verified

  if (typeof email !== 'string' || !email.trim()) return null
  if (emailVerified !== true) return null

  return email.trim().toLowerCase()
}

export function readGoogleProfileImage(profile: unknown): string | null {
  if (!isRecord(profile)) return null
  const picture = profile.picture
  if (typeof picture !== 'string' || !picture.trim()) return null

  try {
    const url = new URL(picture.trim())
    if (url.protocol !== 'https:' || !isGoogleProfileImageHostname(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}
