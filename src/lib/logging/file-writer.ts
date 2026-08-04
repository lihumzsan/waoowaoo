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

// 保留是有界的：app.log 与数据库共享同一块盘，无上限的日志增长最终以磁盘写满、
// 数据库不可用收场。默认 200MB × 10 代（约 2GB）；需要更长历史时调大环境变量即可。
function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const GLOBAL_LOG_MAX_BYTES = parsePositiveInt(process.env.LOG_FILE_MAX_BYTES, 200 * 1024 * 1024)
const GLOBAL_LOG_MAX_GENERATIONS = parsePositiveInt(process.env.LOG_FILE_MAX_GENERATIONS, 10)

function appLogPath(modules: NodeModules): string {
    return modules.path.join(modules.cwd, 'logs', 'app.log')
}

/**
 * Write a log line to `logs/app.log`.
 * Rotation is rename-based (atomic per file): when the current file exceeds
 * the limit, generations shift (`app.log.N-1` → `app.log.N`, …, `app.log` →
 * `app.log.1`; the oldest generation is dropped) and appends continue into a
 * fresh file. Writers in other processes that still hold the old path simply
 * follow the rename – no current lines are dropped.
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
                for (let generation = GLOBAL_LOG_MAX_GENERATIONS - 1; generation >= 1; generation -= 1) {
                    try {
                        modules.fs.renameSync(`${filePath}.${generation}`, `${filePath}.${generation + 1}`)
                    } catch {
                        // Missing generation is normal.
                    }
                }
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

// 管理端下载的内存预算：完整历史留在磁盘（可直接取文件），下载只返回最近的整文件窗口。
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024

/**
 * Read the most recent log history (chronological order) for admin download.
 * Whole files only, newest first until DOWNLOAD_MAX_BYTES is reached, so the
 * concatenated string stays memory-bounded regardless of retention settings.
 */
export async function readAllLogs(): Promise<string> {
    if (isEdgeOrBrowser()) return ''
    const modules = await getNodeModules()
    if (!modules) return ''

    const filePath = appLogPath(modules)
    const newestFirst: string[] = [filePath]
    for (let generation = 1; generation <= GLOBAL_LOG_MAX_GENERATIONS; generation += 1) {
        newestFirst.push(`${filePath}.${generation}`)
    }

    const selected: string[] = []
    let budget = DOWNLOAD_MAX_BYTES
    for (const candidate of newestFirst) {
        try {
            const size = modules.fs.statSync(candidate).size
            if (selected.length > 0 && size > budget) break
            selected.push(candidate)
            budget -= size
        } catch {
            // Missing generation is normal.
        }
    }

    const sections: string[] = []
    for (const candidate of selected.reverse()) {
        try {
            sections.push(modules.fs.readFileSync(candidate, 'utf-8'))
        } catch {
            // File may have rotated away between stat and read.
        }
    }
    return sections.join('')
}
