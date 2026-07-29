/**
 * Server-side log file writer.
 *
 * stdout JSON 是日志的权威输出流；本模块只维护一份便利文件
 * `logs/app.log`（供自托管管理员下载），超限时通过原子 rename 轮转为
 * `logs/app.log.1`，避免多进程 read-modify-write 覆写丢行。
 *
 * This module is Edge-safe at import-time: all Node.js APIs are accessed via
 * async dynamic `import()` calls that only run at write-time.
 *
 * The writer is intentionally fire-and-forget: callers should never await it
 * and logging failures should never crash the application.
 */

// ─── environment guard ────────────────────────────────────────────────

function isEdgeOrBrowser(): boolean {
    if (typeof window !== 'undefined') return true
    const g = globalThis as { EdgeRuntime?: unknown }
    return typeof g.EdgeRuntime === 'string'
}

// ─── node module cache ────────────────────────────────────────────────
// We cache lazily so the module stays Edge-safe at import time.

type NodeModules = {
    fs: typeof import('node:fs')
    path: typeof import('node:path')
    cwd: string
}

let nodeModulesCache: NodeModules | null | 'pending' | undefined

async function getNodeModules(): Promise<NodeModules | null> {
    if (nodeModulesCache === null) return null
    if (nodeModulesCache && nodeModulesCache !== 'pending') return nodeModulesCache
    if (isEdgeOrBrowser()) {
        nodeModulesCache = null
        return null
    }

    // Only one concurrent initialisation
    if (nodeModulesCache === 'pending') {
        // Another call is already initialising – yield and retry
        await new Promise((r) => setTimeout(r, 0))
        return getNodeModules()
    }
    nodeModulesCache = 'pending'

    try {
        // 使用 new Function() 间接导入，绕过 Next.js 静态分析器的 Edge Runtime 检查。
        // 运行时行为与直接 import() 完全一致，但打包器不会静态追踪这些模块。
        const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>
        const [fs, path] = await Promise.all([
            dynamicImport('node:fs'),
            dynamicImport('node:path'),
        ]) as [typeof import('node:fs'), typeof import('node:path')]
        // process.cwd() 同理，用 new Function 包裹避免静态分析追踪
        const getCwd = new Function('return process.cwd()') as () => string
        const resolved: NodeModules = { fs, path, cwd: getCwd() }
        nodeModulesCache = resolved
        return resolved
    } catch {
        nodeModulesCache = null
        return null
    }
}

// ─── global log writer ──────────────────────────────────────────────

const GLOBAL_LOG_MAX_BYTES = 50 * 1024 * 1024 // 50 MB per file, one rotated generation kept

function appLogPath(modules: NodeModules): string {
    return modules.path.join(modules.cwd, 'logs', 'app.log')
}

/**
 * Write a log line to `logs/app.log`.
 * Rotation is rename-based (atomic): when the file exceeds the limit it is
 * renamed to `app.log.1` (replacing the previous generation) and appends
 * continue into a fresh file. Writers in other processes that still hold the
 * old path simply follow the rename – no lines are dropped.
 */
export async function writeGlobalLogLine(line: string): Promise<void> {
    if (isEdgeOrBrowser()) return
    const modules = await getNodeModules()
    if (!modules) return

    const filePath = appLogPath(modules)
    try {
        modules.fs.mkdirSync(modules.path.dirname(filePath), { recursive: true })

        try {
            const stat = modules.fs.statSync(filePath)
            if (stat.size > GLOBAL_LOG_MAX_BYTES) {
                modules.fs.renameSync(filePath, `${filePath}.1`)
            }
        } catch {
            // File may not exist yet, that's fine
        }

        modules.fs.appendFileSync(filePath, line + '\n')
    } catch (err) {
        console.error('[file-writer] Failed to write global log line', err)
    }
}

// ─── log file access (for admin download) ───────────────────────────

/**
 * Read the rotated generation plus the current `app.log` for admin download.
 * Bounded by design: at most two files of GLOBAL_LOG_MAX_BYTES each.
 */
export async function readAllLogs(): Promise<string> {
    if (isEdgeOrBrowser()) return ''
    const modules = await getNodeModules()
    if (!modules) return ''

    const filePath = appLogPath(modules)
    const sections: string[] = []
    for (const candidate of [`${filePath}.1`, filePath]) {
        try {
            sections.push(modules.fs.readFileSync(candidate, 'utf-8'))
        } catch {
            // Missing generation is normal.
        }
    }
    return sections.join('')
}
