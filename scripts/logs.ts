import fs from 'node:fs'
import path from 'node:path'

type LogFile = {
    fullPath: string
    modifiedAtMs: number
    name: string
    sizeBytes: number
}

const LOGS_DIR = path.join(process.cwd(), 'logs')
const DEFAULT_ERROR_PATTERN = 'ERROR|Exception|fail|500'
const DEFAULT_TAIL_LINES = 120
const DEFAULT_ERROR_SCAN_LINES = 400

function usage(): never {
    console.log(`Usage:
  npx tsx scripts/logs.ts list
  npx tsx scripts/logs.ts tail [target] [lines]
  npx tsx scripts/logs.ts follow [target] [lines]
  npx tsx scripts/logs.ts show [target]
  npx tsx scripts/logs.ts errors [lines] [pattern]

Targets:
  app            app.log
  latest         most recently updated log file
  <file>         exact file name, e.g. admin_mountain.log
  <keyword>      partial file name match
`)
    process.exit(1)
}

function ensureLogsDir(): void {
    if (!fs.existsSync(LOGS_DIR)) {
        console.error(`Logs directory not found: ${LOGS_DIR}`)
        process.exit(1)
    }
}

function getLogFiles(): LogFile[] {
    ensureLogsDir()
    return fs.readdirSync(LOGS_DIR)
        .filter((name) => name.endsWith('.log'))
        .map((name) => {
            const fullPath = path.join(LOGS_DIR, name)
            const stat = fs.statSync(fullPath)
            return {
                fullPath,
                modifiedAtMs: stat.mtimeMs,
                name,
                sizeBytes: stat.size,
            }
        })
        .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)
}

function formatSize(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readLastLines(filePath: string, lineCount: number): string[] {
    const content = fs.readFileSync(filePath, 'utf8')
    return content.split(/\r?\n/).filter(Boolean).slice(-lineCount)
}

function resolveTarget(target: string | undefined, files: LogFile[]): LogFile {
    if (files.length === 0) {
        console.error('No log files found in logs directory.')
        process.exit(1)
    }

    const normalized = (target ?? 'latest').trim().toLowerCase()
    if (!normalized || normalized === 'latest') return files[0]

    if (normalized === 'app') {
        const appFile = files.find((file) => file.name === 'app.log')
        if (appFile) return appFile
    }

    const exact = files.find((file) => file.name.toLowerCase() === normalized)
    if (exact) return exact

    const partial = files.find((file) => file.name.toLowerCase().includes(normalized))
    if (partial) return partial

    console.error(`Log target not found: ${target}`)
    console.error('Available files:')
    for (const file of files) {
        console.error(`  - ${file.name}`)
    }
    process.exit(1)
}

function printList(files: LogFile[]): void {
    if (files.length === 0) {
        console.log(`No log files found in ${LOGS_DIR}`)
        return
    }

    console.log(`Logs directory: ${LOGS_DIR}`)
    for (const file of files) {
        console.log(
            `${new Date(file.modifiedAtMs).toLocaleString()}  ${formatSize(file.sizeBytes).padStart(8)}  ${file.name}`,
        )
    }
}

function printFileBlock(file: LogFile, lines: string[]): void {
    console.log(`===== ${file.name} (${path.relative(process.cwd(), file.fullPath)}) =====`)
    if (lines.length === 0) {
        console.log('(empty)')
        return
    }
    for (const line of lines) {
        console.log(line)
    }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') return value
    if (value == null) return ''
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function shouldIncludeErrorLine(line: string, matcher: RegExp): boolean {
    const parsed = parseJsonLine(line)
    if (!parsed) return matcher.test(line)

    const level = String(parsed.level ?? '').toUpperCase()
    if (level === 'ERROR' || level === 'FATAL') return true

    const candidates = [
        parsed.message,
        parsed.action,
        parsed.error,
    ].map(stringifyUnknown)

    return candidates.some((value) => matcher.test(value))
}

function formatErrorLine(line: string): string {
    const parsed = parseJsonLine(line)
    if (!parsed) return line

    const timestamp = stringifyUnknown(parsed.ts) || '-'
    const level = stringifyUnknown(parsed.level).toUpperCase() || 'UNKNOWN'
    const moduleName = stringifyUnknown(parsed.module) || '-'
    const action = stringifyUnknown(parsed.action) || '-'
    const message = stringifyUnknown(parsed.message) || '(no message)'
    const detail = stringifyUnknown(parsed.details)
    const errorMessage = stringifyUnknown(
        parsed.error && typeof parsed.error === 'object'
            ? (parsed.error as Record<string, unknown>).message
            : '',
    )

    const extras = [detail, errorMessage].filter(Boolean).join(' | ')
    return extras
        ? `${timestamp} [${level}] ${moduleName} ${action} ${message} | ${extras}`
        : `${timestamp} [${level}] ${moduleName} ${action} ${message}`
}

async function followFile(file: LogFile, initialLines: number): Promise<void> {
    printFileBlock(file, readLastLines(file.fullPath, initialLines))
    console.log('\n-- following; press Ctrl+C to stop --')

    let lastSize = fs.statSync(file.fullPath).size

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000))

        try {
            const stat = fs.statSync(file.fullPath)
            if (stat.size < lastSize) {
                console.log('\n-- log rotated, re-reading latest tail --')
                printFileBlock(file, readLastLines(file.fullPath, initialLines))
                lastSize = stat.size
                continue
            }

            if (stat.size === lastSize) continue

            const stream = fs.createReadStream(file.fullPath, {
                encoding: 'utf8',
                start: lastSize,
            })

            await new Promise<void>((resolve, reject) => {
                stream.on('data', (chunk) => process.stdout.write(chunk))
                stream.on('end', resolve)
                stream.on('error', reject)
            })

            lastSize = stat.size
        } catch (error) {
            console.error('Failed while following log file:', error)
        }
    }
}

function printErrors(files: LogFile[], lineCount: number, patternSource: string): void {
    const matcher = new RegExp(patternSource, 'i')
    let totalMatches = 0

    for (const file of files) {
        const lines = readLastLines(file.fullPath, lineCount)
        const matches = lines
            .filter((line) => shouldIncludeErrorLine(line, matcher))
            .map((line) => formatErrorLine(line))
        if (matches.length === 0) continue

        totalMatches += matches.length
        printFileBlock(file, matches)
        console.log('')
    }

    if (totalMatches === 0) {
        console.log(`No matches found for /${patternSource}/i in the last ${lineCount} lines of ${files.length} log file(s).`)
    } else {
        console.log(`Matched ${totalMatches} line(s) across ${files.length} log file(s).`)
    }
}

async function main(): Promise<void> {
    const [command = 'list', arg1, arg2] = process.argv.slice(2)
    const files = getLogFiles()

    switch (command) {
        case 'list':
            printList(files)
            return
        case 'tail': {
            const file = resolveTarget(arg1, files)
            const lineCount = parsePositiveInt(arg2, DEFAULT_TAIL_LINES)
            printFileBlock(file, readLastLines(file.fullPath, lineCount))
            return
        }
        case 'follow': {
            const file = resolveTarget(arg1, files)
            const lineCount = parsePositiveInt(arg2, DEFAULT_TAIL_LINES)
            await followFile(file, lineCount)
            return
        }
        case 'show': {
            const file = resolveTarget(arg1, files)
            printFileBlock(file, readLastLines(file.fullPath, Number.MAX_SAFE_INTEGER))
            return
        }
        case 'errors': {
            const lineCount = parsePositiveInt(arg1, DEFAULT_ERROR_SCAN_LINES)
            const patternSource = arg2?.trim() || DEFAULT_ERROR_PATTERN
            printErrors(files, lineCount, patternSource)
            return
        }
        default:
            usage()
    }
}

void main()
