import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createGoldenMediaAssets } from './assets'

type GoldenFalRequestKind = 'image' | 'audio'

interface GoldenFalRequest {
  readonly id: string
  readonly kind: GoldenFalRequestKind
  readonly createdAt: number
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function requestOrigin(request: IncomingMessage): string {
  return `http://${request.headers.host ?? '127.0.0.1'}`
}

function mediaResponse(response: ServerResponse, contentType: string, body: Buffer): void {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': String(body.length),
  })
  response.end(body)
}

function falRequestKind(pathname: string): GoldenFalRequestKind {
  return pathname.includes('lyria') || pathname.includes('music') ? 'audio' : 'image'
}

function falAudioResult(origin: string): {
  readonly audio: {
    readonly url: string
    readonly content_type: 'audio/mpeg'
  }
} {
  return {
    audio: {
      url: `${origin}/assets/golden.mp3`,
      content_type: 'audio/mpeg',
    },
  }
}

function findFalRequestByPath(
  requests: ReadonlyMap<string, GoldenFalRequest>,
  pathname: string,
): GoldenFalRequest | null {
  const match = pathname.match(/\/requests\/([^/]+)(?:\/status)?$/)
  return match?.[1] ? requests.get(match[1]) ?? null : null
}

export interface GoldenMediaServer {
  readonly baseUrl: string
  readonly server: Server
  close(): Promise<void>
}

export async function startGoldenMediaServer(port = 0): Promise<GoldenMediaServer> {
  const assets = await createGoldenMediaAssets()
  const falRequests = new Map<string, GoldenFalRequest>()
  let requestOrdinal = 0
  let statusDelayMs = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', requestOrigin(request))
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/__golden/media-delay') {
      void readJsonBody(request).then((body) => {
        const record = body && typeof body === 'object' && !Array.isArray(body)
          ? body as Record<string, unknown>
          : null
        const delayMs = record?.delayMs
        if (!Number.isInteger(delayMs) || (delayMs as number) < 0 || (delayMs as number) > 60_000) {
          throw new Error(`GOLDEN_MEDIA_DELAY_INVALID:${String(delayMs)}`)
        }
        statusDelayMs = delayMs as number
        writeJson(response, 200, { ok: true, delayMs: statusDelayMs })
      }).catch((error: unknown) => {
        writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/assets/golden.png') {
      mediaResponse(response, 'image/png', assets.png)
      return
    }
    if (request.method === 'GET' && url.pathname === '/assets/golden.mp4') {
      mediaResponse(response, 'video/mp4', assets.mp4)
      return
    }
    if (request.method === 'GET' && url.pathname === '/assets/golden.mp3') {
      mediaResponse(response, 'audio/mpeg', assets.mp3)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/sound-generation') {
      mediaResponse(response, 'audio/mpeg', assets.mp3)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/videos') {
      requestOrdinal += 1
      writeJson(response, 200, {
        id: `golden_video_${requestOrdinal}`,
        status: 'pending',
      })
      return
    }
    if (request.method === 'GET' && /^\/v1\/videos\/[^/]+$/.test(url.pathname)) {
      writeJson(response, 200, {
        id: url.pathname.split('/').at(-1),
        status: 'completed',
        unsigned_urls: [`${requestOrigin(request)}/assets/golden.mp4`],
      })
      return
    }

    const falRequest = findFalRequestByPath(falRequests, url.pathname)
    if (request.method === 'GET' && falRequest && url.pathname.endsWith('/status')) {
      if (Date.now() - falRequest.createdAt < statusDelayMs) {
        writeJson(response, 200, { status: 'IN_PROGRESS' })
        return
      }
      writeJson(response, 200, {
        status: 'COMPLETED',
        response_url: `${requestOrigin(request)}/fal-results/${falRequest.id}`,
      })
      return
    }
    if (request.method === 'GET' && falRequest) {
      const mediaUrl = falRequest.kind === 'image'
        ? `${requestOrigin(request)}/assets/golden.png`
        : `${requestOrigin(request)}/assets/golden.mp3`
      writeJson(response, 200, falRequest.kind === 'image'
        ? { images: [{ url: mediaUrl }] }
        : falAudioResult(requestOrigin(request)))
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/fal-results/')) {
      const requestId = url.pathname.split('/').at(-1) ?? ''
      const stored = falRequests.get(requestId)
      if (!stored) {
        writeJson(response, 404, { error: 'GOLDEN_FAL_REQUEST_NOT_FOUND' })
        return
      }
      const mediaUrl = stored.kind === 'image'
        ? `${requestOrigin(request)}/assets/golden.png`
        : `${requestOrigin(request)}/assets/golden.mp3`
      writeJson(response, 200, stored.kind === 'image'
        ? { images: [{ url: mediaUrl }] }
        : falAudioResult(requestOrigin(request)))
      return
    }
    if (request.method === 'POST') {
      requestOrdinal += 1
      const id = `golden_fal_${requestOrdinal}`
      const kind = falRequestKind(url.pathname)
      falRequests.set(id, { id, kind, createdAt: Date.now() })
      const origin = requestOrigin(request)
      writeJson(response, 200, kind === 'audio'
        ? {
            request_id: id,
            response_url: `${origin}/fal-results/${id}`,
            status_url: `${origin}/fal-music/requests/${id}/status`,
          }
        : { request_id: id })
      return
    }
    writeJson(response, 404, { error: 'GOLDEN_MEDIA_ROUTE_NOT_FOUND' })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('GOLDEN_MEDIA_SERVER_ADDRESS_MISSING')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
