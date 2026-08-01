
/**
 * 检查错误是否是由于页面卸载/刷新导致的 fetch 中止
 * 用于避免在页面刷新时显示无意义的错误提示
 */
export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
}

/**
 * 安全的错误处理函数
 * 返回是否应该显示错误（如果是页面刷新导致的错误则返回 false）
 */
export function shouldShowError(error: unknown): boolean {
    return !isAbortError(error)
}
