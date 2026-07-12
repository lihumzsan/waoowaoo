'use client'

/**
 * GlassPanel - 毛玻璃卡片容器
 */
export function GlassPanel({
    children,
    className = ''
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={`
      glass-surface-elevated
      ${className}
    `}>
            {children}
        </div>
    )
}

/**
 * Button - 通用按钮组件
 */
export function Button({
    children,
    primary = false,
    onClick,
    disabled = false,
    icon,
    className = ''
}: {
    children: React.ReactNode
    primary?: boolean
    onClick?: () => void
    disabled?: boolean
    icon?: React.ReactNode
    className?: string
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
        glass-btn-base px-6 py-2.5
        ${primary
                    ? 'glass-btn-primary text-white'
                    : 'glass-btn-secondary'}
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
        >
            {icon && <span>{icon}</span>}
            {children}
        </button>
    )
}
