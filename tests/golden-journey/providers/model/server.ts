import { createServer, type IncomingMessage, type Server } from 'node:http'
import { decideGoldenModelResponse } from './policy'
import {
  parseGoldenChatCompletionRequest,
  readGoldenScenarioId,
} from './protocol'
import {
  writeGoldenJsonResponse,
  writeGoldenStreamingResponse,
} from './response'

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) as unknown : null
}

export interface GoldenModelServer {
  readonly baseUrl: string
  readonly server: Server
  close(): Promise<void>
}

export async function startGoldenModelServer(port = 0): Promise<GoldenModelServer> {
  const requestCountByScenario = new Map<string, number>()
  let streamPacing: { readonly chunkSize: number; readonly delayMs: number } | null = null
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/__golden/control') {
        const control = await readJsonBody(request)
        const record = control && typeof control === 'object' && !Array.isArray(control)
          ? control as Record<string, unknown>
          : {}
        if (Object.prototype.hasOwnProperty.call(record, 'streamPacing')) {
          const pacing = record.streamPacing && typeof record.streamPacing === 'object' && !Array.isArray(record.streamPacing)
            ? record.streamPacing as Record<string, unknown>
            : null
          streamPacing = pacing
            && typeof pacing.chunkSize === 'number' && Number.isSafeInteger(pacing.chunkSize) && pacing.chunkSize > 0
            && typeof pacing.delayMs === 'number' && Number.isSafeInteger(pacing.delayMs) && pacing.delayMs >= 0
            ? { chunkSize: pacing.chunkSize, delayMs: pacing.delayMs }
            : null
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, streamPacing }))
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'GOLDEN_MODEL_ROUTE_NOT_FOUND' } }))
        return
      }
      const scenarioId = readGoldenScenarioId(request.headers.authorization)
      const completionRequest = parseGoldenChatCompletionRequest(await readJsonBody(request))
      const requestOrdinal = (requestCountByScenario.get(scenarioId) ?? 0) + 1
      requestCountByScenario.set(scenarioId, requestOrdinal)
      const decision = decideGoldenModelResponse({
        scenarioId,
        request: completionRequest,
        requestOrdinal,
      })
      if (completionRequest.stream) {
        await writeGoldenStreamingResponse({
          response,
          request: completionRequest,
          decision,
          pacing: streamPacing,
        })
      } else {
        writeGoldenJsonResponse({ response, request: completionRequest, decision })
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('GOLDEN_MODEL_SERVER_ADDRESS_MISSING')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    server,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
