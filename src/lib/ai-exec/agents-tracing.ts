import path from 'node:path'
import { appendFile, mkdir } from 'node:fs/promises'
import { setTraceProcessors, type TracingProcessor } from '@openai/agents'
import { createScopedLogger } from '@/lib/logging/core'

/**
 * Local JSONL sink for Agents SDK traces. Replaces the SDK default processor,
 * which uploads spans (including model inputs/outputs) to OpenAI's hosted
 * ingest endpoint — trace data must stay inside our own infrastructure.
 *
 * Files land in logs/agent-traces/<UTC date>.jsonl, one JSON object per line:
 * { ts, pid, kind: 'trace_start' | 'trace_end' | 'span', data }. The project
 * log cleanup only rewrites top-level *.log files, so trace files persist
 * until removed deliberately. OPENAI_AGENTS_DISABLE_TRACING=true remains the
 * upstream kill switch: spans become no-ops and nothing reaches this sink.
 */

const TRACE_DIR = path.join(process.cwd(), 'logs', 'agent-traces')

const logger = createScopedLogger({
  module: 'ai-exec.agents-tracing',
})

let traceDirReady: Promise<void> | null = null

async function ensureTraceDir(): Promise<void> {
  if (!traceDirReady) {
    traceDirReady = mkdir(TRACE_DIR, { recursive: true }).then(() => undefined)
  }
  await traceDirReady
}

// Appends are chained so lines from concurrent runs never interleave and a
// single failed write cannot break the chain for later spans.
let writeQueue: Promise<void> = Promise.resolve()

function enqueueTraceLine(kind: 'trace_start' | 'trace_end' | 'span', data: object): void {
  const now = new Date()
  const line = `${JSON.stringify({
    ts: now.toISOString(),
    pid: process.pid,
    kind,
    data,
  })}\n`
  const fileName = `${now.toISOString().slice(0, 10)}.jsonl`
  writeQueue = writeQueue
    .then(async () => {
      await ensureTraceDir()
      await appendFile(path.join(TRACE_DIR, fileName), line, 'utf8')
    })
    .catch((error: unknown) => {
      logger.error({
        action: 'agents_tracing.write_failed',
        message: 'failed to append agent trace line',
        details: { kind, fileName },
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: 'UnknownError', message: String(error) },
      })
    })
}

export function createAgentsTraceFileProcessor(): TracingProcessor {
  return {
    async onTraceStart(trace) {
      const data = trace.toJSON()
      if (data) enqueueTraceLine('trace_start', data)
    },
    async onTraceEnd(trace) {
      const data = trace.toJSON()
      if (data) enqueueTraceLine('trace_end', data)
    },
    async onSpanStart() {
      // Span facts are complete at end time; start events would double volume.
    },
    async onSpanEnd(span) {
      const data = span.toJSON()
      if (data) enqueueTraceLine('span', data)
    },
    async forceFlush() {
      await writeQueue
    },
    async shutdown() {
      await writeQueue
    },
  }
}

let configured = false

/**
 * Idempotent; call once per process from every Agents SDK run entry before
 * the first run() so the OpenAI exporter is never the active processor.
 */
export function ensureAgentsLocalTracing(): void {
  if (configured) return
  configured = true
  setTraceProcessors([createAgentsTraceFileProcessor()])
  logger.info({
    action: 'agents_tracing.local_sink_active',
    message: 'agents trace export redirected to local JSONL sink',
    details: { dir: TRACE_DIR },
  })
}
