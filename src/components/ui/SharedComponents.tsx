'use client'

/**
 * Static blue-gray background for the project workspace.
 */
export function WorkspaceBackground() {
    return (
        <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10 bg-[var(--glass-bg-canvas)]"
            style={{
                background: [
                    'radial-gradient(ellipse at 18% 12%, color-mix(in srgb, var(--glass-bg-surface-strong) 72%, transparent) 0%, transparent 58%)',
                    'radial-gradient(ellipse at 82% 88%, color-mix(in srgb, var(--glass-bg-muted) 70%, transparent) 0%, transparent 62%)',
                    'var(--glass-bg-canvas)',
                ].join(', '),
            }}
        />
    )
}

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
