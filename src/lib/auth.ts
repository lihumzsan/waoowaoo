import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { logAuthAction } from './logging/semantic'
import { prisma } from './prisma'
import { createAuthAdapter } from '@/lib/auth/next-auth-adapter'
import { readGoogleOAuthConfig, readVerifiedGoogleProfileEmail } from '@/lib/auth/google-oauth'

type AppNextAuthOptions = NextAuthOptions & {
  trustHost?: boolean
}

export const authOptions: AppNextAuthOptions = {
  adapter: createAuthAdapter(),
  // 🔥 允许从任意 Host 访问（解决局域网访问问题）
  trustHost: true,
  // 🔥 根据 URL 协议决定是否使用 Secure Cookie
  // 局域网 HTTP 访问时需要关闭，否则 Cookie 无法设置
  useSecureCookies: (process.env.NEXTAUTH_URL || '').startsWith('https://'),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          logAuthAction('LOGIN', credentials?.username || 'unknown', { error: 'Missing credentials' })
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            name: credentials.username
          }
        })

        if (!user || !user.password) {
          logAuthAction('LOGIN', credentials.username, { error: 'User not found' })
          return null
        }

        // 验证密码
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          logAuthAction('LOGIN', credentials.username, { error: 'Invalid password' })
          return null
        }

        logAuthAction('LOGIN', user.name, { userId: user.id, success: true })

        return {
          id: user.id,
          name: user.name,
        }
      }
    }),
    GoogleProvider({
      ...readGoogleOAuthConfig(),
      allowDangerousEmailAccountLinking: false,
    }),
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
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
