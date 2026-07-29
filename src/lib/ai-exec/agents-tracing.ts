import path from 'node:path'
import { appendFile, mkdir } from 'node:fs/promises'
import { setTraceProcessors, type TracingProcessor } from '@openai/agents'
import { createScopedLogger } from '@/lib/logging/core'

/**
 * TEMPORARY DEBUG TOOL — full-content traces, manual cleanup required.
 *
 * The Agents SDK default processor uploads spans (including model
 * inputs/outputs) to OpenAI's hosted ingest endpoint; this module always
 * replaces it so trace data never leaves our infrastructure.
 *
 * The local JSONL sink is OFF by default. Set `AGENT_TRACE_DEBUG_ENABLED=true`
 * to enable it for incident debugging only: the files contain verbatim prompt
 * and output content, land in logs/agent-traces/<UTC date>.jsonl, and are
 * never rotated or cleaned automatically — delete them manually when done.
 *
 * Each line is { ts, pid, kind: 'trace_start' | 'trace_end' | 'span',
 * projectId, userId, runId, data }. Correlation ids come from the caller's
 * run-level `traceMetadata` (see project-agent runtime); spans inherit them
 * from their parent trace via traceId. OPENAI_AGENTS_DISABLE_TRACING=true
 * remains the upstream kill switch: spans become no-ops and nothing reaches
 * this sink.
 */

const TRACE_DIR = path.join(process.cwd(), 'logs', 'agent-traces')

const AGENT_TRACE_DEBUG_ENV = 'AGENT_TRACE_DEBUG_ENABLED'

function isAgentTraceDebugEnabled(): boolean {
  return process.env[AGENT_TRACE_DEBUG_ENV]?.trim().toLowerCase() === 'true'
}

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

type AgentTraceCorrelation = {
  projectId: string | null
  userId: string | null
  runId: string | null
}

function readCorrelationField(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readTraceCorrelation(trace: { metadata?: Record<string, unknown> }): AgentTraceCorrelation {
  return {
    projectId: readCorrelationField(trace.metadata, 'projectId'),
    userId: readCorrelationField(trace.metadata, 'userId'),
    runId: readCorrelationField(trace.metadata, 'runId'),
  }
}

function readSpanTraceId(span: object): string | null {
  const traceId = (span as { traceId?: unknown }).traceId
  return typeof traceId === 'string' && traceId ? traceId : null
}

// Appends are chained so lines from concurrent runs never interleave and a
// single failed write cannot break the chain for later spans.
let writeQueue: Promise<void> = Promise.resolve()

function enqueueTraceLine(
  kind: 'trace_start' | 'trace_end' | 'span',
  data: object,
  correlation: AgentTraceCorrelation,
): void {
  const now = new Date()
  const line = `${JSON.stringify({
    ts: now.toISOString(),
    pid: process.pid,
    kind,
    projectId: correlation.projectId,
    userId: correlation.userId,
    runId: correlation.runId,
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

const EMPTY_CORRELATION: AgentTraceCorrelation = {
  projectId: null,
  userId: null,
  runId: null,
}

export function createAgentsTraceFileProcessor(): TracingProcessor {
  const correlationByTraceId = new Map<string, AgentTraceCorrelation>()
  return {
    async onTraceStart(trace) {
      const correlation = readTraceCorrelation(trace)
      correlationByTraceId.set(trace.traceId, correlation)
      const data = trace.toJSON()
      if (data) enqueueTraceLine('trace_start', data, correlation)
    },
    async onTraceEnd(trace) {
      const correlation = correlationByTraceId.get(trace.traceId) ?? readTraceCorrelation(trace)
      correlationByTraceId.delete(trace.traceId)
      const data = trace.toJSON()
      if (data) enqueueTraceLine('trace_end', data, correlation)
    },
    async onSpanStart() {
      // Span facts are complete at end time; start events would double volume.
    },
    async onSpanEnd(span) {
      const data = span.toJSON()
      if (!data) return
      const traceId = readSpanTraceId(data)
      const correlation = (traceId ? correlationByTraceId.get(traceId) : null) ?? EMPTY_CORRELATION
      enqueueTraceLine('span', data, correlation)
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
 * The local file sink additionally requires AGENT_TRACE_DEBUG_ENABLED=true;
 * by default the processor list is emptied and nothing is written anywhere.
 */
export function ensureAgentsLocalTracing(): void {
  if (configured) return
  configured = true
  if (!isAgentTraceDebugEnabled()) {
    // Replacing the default processor list keeps the SDK's hosted OpenAI
    // exporter inactive; with no local processor nothing is written either.
    setTraceProcessors([])
    logger.info({
      action: 'agents_tracing.disabled',
      message: `agents trace export disabled (hosted exporter replaced; set ${AGENT_TRACE_DEBUG_ENV}=true for the local debug sink)`,
    })
    return
  }
  setTraceProcessors([createAgentsTraceFileProcessor()])
  logger.info({
    action: 'agents_tracing.local_sink_active',
    message: 'agents trace export redirected to local JSONL debug sink (full content, manual cleanup required)',
    details: { dir: TRACE_DIR },
  })
}
