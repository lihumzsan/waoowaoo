import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { logAuthAction } from './logging/semantic'
import { createAuthAdapter } from '@/lib/auth/next-auth-adapter'
import { createGoogleOAuthProvider, readVerifiedGoogleProfileEmail } from '@/lib/auth/google-oauth'
import { authorizePasswordIdentity } from '@/lib/auth/password-auth'
import { authorizePhoneIdentity } from '@/lib/auth/phone-verification'
import { getDeploymentConfig, isCloudDeployment } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { prisma } from '@/lib/prisma'

const deploymentConfig = getDeploymentConfig()
const deploymentFeatures = getDeploymentFeatures(deploymentConfig)
const googleOAuthProvider = createGoogleOAuthProvider(deploymentFeatures)
const passwordProvider = deploymentFeatures.enablePasswordAuth
  ? CredentialsProvider({
      id: 'credentials',
      name: 'password',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        return await authorizePasswordIdentity({
          username: credentials?.username,
          password: credentials?.password,
        })
      },
    })
  : null
const phoneProvider = deploymentFeatures.enablePhoneAuth
  ? CredentialsProvider({
      id: 'phone',
      name: 'phone',
      credentials: {
        phoneNumber: { label: 'Phone number', type: 'tel' },
        code: { label: 'Verification code', type: 'text' },
        inviteCode: { label: 'Invite code', type: 'text' },
      },
      async authorize(credentials) {
        return await authorizePhoneIdentity({
          phoneNumber: credentials?.phoneNumber,
          code: credentials?.code,
          inviteCode: credentials?.inviteCode,
        })
      },
    })
  : null
const secureCookieRequired = (isCloudDeployment(deploymentConfig) && process.env.NODE_ENV === 'production')
  || (process.env.NEXTAUTH_URL || '').startsWith('https://')

export const authOptions: NextAuthOptions = {
  adapter: createAuthAdapter(),
  useSecureCookies: secureCookieRequired,
  providers: [
    ...(passwordProvider ? [passwordProvider] : []),
    ...(phoneProvider ? [phoneProvider] : []),
    ...(googleOAuthProvider ? [googleOAuthProvider] : []),
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true

      const verifiedEmail = readVerifiedGoogleProfileEmail(profile)
      if (!verifiedEmail) {
        logAuthAction('LOGIN', 'google', { error: 'Google email not verified' })
        return false
      }

      logAuthAction('LOGIN', verifiedEmail, { provider: 'google', success: true })
      return true
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
      }
      if (trigger === 'update' && typeof token.id === 'string') {
        const currentUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { name: true },
        })
        if (currentUser) {
          token.name = currentUser.name
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id
      }
      return session
    }
  }
}
