import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { logAuthAction } from './logging/semantic'
import { createAuthAdapter, syncLinkedGoogleAccountImage } from '@/lib/auth/next-auth-adapter'
import {
  createGoogleOAuthProvider,
  readGoogleProfileImage,
  readVerifiedGoogleProfileEmail,
} from '@/lib/auth/google-oauth'
import { authorizePasswordIdentity } from '@/lib/auth/password-auth'
import { authorizePhoneIdentity } from '@/lib/auth/phone-verification'
import { exchangeWechatOfficialAttempt } from '@/lib/auth/wechat-official-attempt'
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
        identity: { label: 'Identity', type: 'text' },
        password: { label: 'Password', type: 'password' },
        mode: { label: 'Mode', type: 'text' },
      },
      async authorize(credentials) {
        return await authorizePasswordIdentity({
          identity: credentials?.identity,
          password: credentials?.password,
          mode: credentials?.mode,
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
      },
      async authorize(credentials) {
        return await authorizePhoneIdentity({
          phoneNumber: credentials?.phoneNumber,
          code: credentials?.code,
        })
      },
    })
  : null
const wechatOfficialProvider = deploymentFeatures.showWechatOfficialAuth
  ? CredentialsProvider({
      id: 'wechat-official',
      name: 'wechat-official',
      credentials: {
        attemptId: { label: 'Attempt ID', type: 'text' },
        browserToken: { label: 'Browser token', type: 'password' },
      },
      async authorize(credentials) {
        return await exchangeWechatOfficialAttempt({
          attemptId: credentials?.attemptId,
          browserToken: credentials?.browserToken,
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
    ...(wechatOfficialProvider ? [wechatOfficialProvider] : []),
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
        logAuthAction('LOGIN', 'Google email not verified', { success: false, provider: 'google' })
        return false
      }

      logAuthAction('LOGIN', 'Google login succeeded', { success: true, provider: 'google' }, undefined, verifiedEmail)
      return true
    },
    async jwt({ token, user, trigger, account, profile }) {
      if (user) {
        token.id = user.id
      }
      if (account?.provider === 'google') {
        const image = readGoogleProfileImage(profile)
        if (image) {
          await syncLinkedGoogleAccountImage({
            providerAccountId: account.providerAccountId,
            image,
          })
          token.picture = image
        }
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
        session.user.image = typeof token.picture === 'string' ? token.picture : null
      }
      return session
    }
  }
}
