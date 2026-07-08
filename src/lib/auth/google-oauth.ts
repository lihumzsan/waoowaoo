export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

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

export function readGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: readTrimmedEnv('GOOGLE_CLIENT_ID'),
    clientSecret: readTrimmedEnv('GOOGLE_CLIENT_SECRET'),
  }
}

export function readVerifiedGoogleProfileEmail(profile: unknown): string | null {
  if (!isRecord(profile)) return null
  const email = profile.email
  const emailVerified = profile.email_verified

  if (typeof email !== 'string' || !email.trim()) return null
  if (emailVerified !== true) return null

  return email.trim().toLowerCase()
}
