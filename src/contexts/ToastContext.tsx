'use client'

/**
 * 🔔 全局 Toast 通知系统
 * 
 * 职责：
 * 1. 提供全局 Toast 状态管理
 * 2. 支持成功/错误/警告/信息四种类型
 * 3. 支持自动翻译错误码
 * 
 * 使用示例：
 * ```typescript
 * const { showToast, showError } = useToast()
 * 
 * // 显示普通消息
 * showToast('操作成功', 'success')
 * 
 * // 显示错误（自动翻译错误码）
 * showError({ code: 'RATE_LIMIT' })
 * ```
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { API_AUTH_REQUIRED_EVENT } from '@/lib/api-fetch'
import { isKnownErrorCode } from '@/lib/errors/codes'
import { resolveClientErrorMessage } from '@/lib/errors/client'
import { projectErrorForUser, type UserErrorAction } from '@/lib/errors/projection'

// ============================================================
// 类型定义
// ============================================================

export interface Toast {
    id: string
    message: string
    type: 'success' | 'error' | 'warning' | 'info'
    duration: number
    actionLabel?: string
    onAction?: () => void
}

interface ToastContextValue {
    toasts: Toast[]
    showToast: (
        message: string,
        type?: Toast['type'],
        duration?: number,
        action?: Pick<Toast, 'actionLabel' | 'onAction'>,
    ) => string
    showError: (error: unknown, fallback?: string, onRetry?: () => void) => void
    dismissToast: (id: string) => void
}

// ============================================================
// Context
// ============================================================

const ToastContext = createContext<ToastContextValue | null>(null)

// ============================================================
// Provider 组件
// ============================================================

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const t = useTranslations('errors')
    const router = useRouter()
    const offlineToastRef = useRef<string | null>(null)

    /**
     * 显示 Toast 消息
     */
    const showToast = useCallback((
        message: string,
        type: Toast['type'] = 'info',
        duration = 5000,
        action?: Pick<Toast, 'actionLabel' | 'onAction'>,
    ) => {
        const id = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 9)

        setToasts(prev => [...prev, { id, message, type, duration, ...action }])

        // 自动消失
        if (duration > 0) {
            setTimeout(() => {
                setToasts(prev => prev.filter(toast => toast.id !== id))
            }, duration)
        }
        return id
    }, [])

    /**
     * 显示错误消息（自动翻译错误码）
     */
    const showError = useCallback((error: unknown, fallback?: string, onRetry?: () => void) => {
        const resolved = resolveClientErrorMessage(
            error,
            (code) => t.has(code) ? t(code) : null,
            fallback?.trim() || t('INTERNAL_ERROR'),
        )
        const projection = resolved.facts.code && isKnownErrorCode(resolved.facts.code)
            ? projectErrorForUser(resolved.facts.code, resolved.facts.requestId)
            : null
        const reference = resolved.facts.requestId
            ? ` ${t('referenceId', { id: resolved.facts.requestId })}`
            : ''
        const actionHandlers: Partial<Record<Exclude<UserErrorAction, null>, () => void>> = {
            open_provider_settings: () => router.push('/profile?section=apiConfig'),
            recharge: () => router.push('/pricing'),
            relogin: () => router.push('/auth/signin'),
            retry: onRetry,
        }
        const action = projection?.action
        const onAction = action ? actionHandlers[action] : undefined
        showToast(
            `${resolved.message}${reference}`,
            'error',
            8000,
            action && onAction ? { actionLabel: t(`actions.${action}`), onAction } : undefined,
        )
    }, [router, showToast, t])

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(toast => toast.id !== id))
    }, [])

    useEffect(() => {
        const handleOffline = () => {
            if (!offlineToastRef.current) {
                offlineToastRef.current = showToast(t('networkOffline'), 'warning', 0)
            }
        }
        const handleOnline = () => {
            if (offlineToastRef.current) {
                dismissToast(offlineToastRef.current)
                offlineToastRef.current = null
            }
            showToast(t('networkRestored'), 'success', 3000)
        }
        const handleAuthRequired = () => showError({ code: 'UNAUTHORIZED' })
        window.addEventListener('offline', handleOffline)
        window.addEventListener('online', handleOnline)
        window.addEventListener(API_AUTH_REQUIRED_EVENT, handleAuthRequired)
        return () => {
            window.removeEventListener('offline', handleOffline)
            window.removeEventListener('online', handleOnline)
            window.removeEventListener(API_AUTH_REQUIRED_EVENT, handleAuthRequired)
        }
    }, [dismissToast, showError, showToast, t])

    return (
        <ToastContext.Provider value={{ toasts, showToast, showError, dismissToast }}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </ToastContext.Provider>
    )
}

// ============================================================
// Hook
// ============================================================

/**
 * 获取 Toast 上下文
 * 
 * @example
 * const { showToast, showError } = useToast()
 */
export function useToast(): ToastContextValue {
    const context = useContext(ToastContext)
    if (!context) {
        throw new Error('useToast must be used within ToastProvider')
    }
    return context
}

// ============================================================
// Toast 容器组件
// ============================================================

function ToastContainer({
    toasts,
    onDismiss
}: {
    toasts: Toast[]
    onDismiss: (id: string) => void
}) {
    if (toasts.length === 0) return null

    return (
        <div className="fixed bottom-4 md:bottom-6 left-4 md:left-6 z-[9999] flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={`
                        pointer-events-auto
                        flex items-center gap-3 
                        px-4 py-3 
                        rounded-xl
                        animate-in slide-in-from-right-full duration-300
                        max-w-md
                        bg-[var(--glass-tone-surface)]
                        shadow-[var(--glass-tone-shadow-hover)]
                        ${getToastStyle(toast.type)}
                    `}
                >
                    {/* 图标 */}
                    <span className="w-5 h-5 flex items-center justify-center">{getToastIcon(toast.type)}</span>

                    {/* 消息 */}
                    <span className="text-sm font-medium flex-1">{toast.message}</span>

                    {toast.actionLabel && toast.onAction ? (
                        <button
                            type="button"
                            onClick={() => {
                                toast.onAction?.()
                                onDismiss(toast.id)
                            }}
                            className="shrink-0 text-sm font-semibold underline underline-offset-2"
                        >
                            {toast.actionLabel}
                        </button>
                    ) : null}

                    {/* 关闭按钮 */}
                    <button
                        onClick={() => onDismiss(toast.id)}
                        className="glass-btn-base glass-btn-ghost w-6 h-6 rounded-md p-0 opacity-70 hover:opacity-100 transition-opacity"
                    >
                        <AppIcon name="close" className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
    )
}

// ============================================================
// 工具函数
// ============================================================

/** Surface and elevation are shared by the container; the type only picks ink. */
function getToastStyle(type: Toast['type']): string {
    switch (type) {
        case 'success':
            return 'text-[var(--glass-tone-success-fg)]'
        case 'error':
            return 'text-[var(--glass-tone-danger-fg)]'
        case 'warning':
            return 'text-[var(--glass-tone-warning-fg)]'
        case 'info':
        default:
            return 'text-[var(--glass-tone-info-fg)]'
    }
}

function getToastIcon(type: Toast['type']) {
    switch (type) {
        case 'success':
            return (
                <AppIcon name="check" className="w-4 h-4" />
            )
        case 'error':
            return (
                <AppIcon name="close" className="w-4 h-4" />
            )
        case 'warning':
            return (
                <AppIcon name="alertOutline" className="w-4 h-4" />
            )
        case 'info':
        default:
            return (
                <AppIcon name="infoCircle" className="w-4 h-4" />
            )
    }
}
