'use client'

import { useEffect } from "react"
import { SessionProvider } from "next-auth/react"
import { ToastProvider } from "@/contexts/ToastContext"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { installGlobalErrorReporting } from "@/lib/errors/client-reporter"

export function Providers({ children }: { children: React.ReactNode }) {
  // 全局错误监听只在根 Provider 挂载一次（install 自身幂等）。
  useEffect(() => {
    installGlobalErrorReporting()
  }, [])

  return (
    <SessionProvider
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      <QueryProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </QueryProvider>
    </SessionProvider>
  )
}
