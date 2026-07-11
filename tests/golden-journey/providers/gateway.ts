import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

function targetForPath(input: {
  readonly pathname: string
  readonly modelBaseUrl: string
  readonly mediaBaseUrl: string
}): string {
  return input.pathname === '/v1/chat/completions' || input.pathname === '/__golden/control'
    ? input.modelBaseUrl
    : input.mediaBaseUrl
}

async function proxyGoldenRequest(input: {
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly modelBaseUrl: string
  readonly mediaBaseUrl: string
}): Promise<void> {
  const incomingUrl = new URL(input.request.url ?? '/', 'http://127.0.0.1')
  const targetBase = targetForPath({
    pathname: incomingUrl.pathname,
    modelBaseUrl: input.modelBaseUrl,
    mediaBaseUrl: input.mediaBaseUrl,
  })
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, targetBase)
  const headers = new Headers()
  for (const [name, value] of Object.entries(input.request.headers)) {
    if (value === undefined || name === 'host' || name === 'content-length') continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const bodyChunks: Buffer[] = []
  for await (const chunk of input.request) {
    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const body = Buffer.concat(bodyChunks)
  const upstream = await fetch(targetUrl, {
    method: input.request.method ?? 'GET',
    headers,
    ...(body.length > 0 ? { body } : {}),
    redirect: 'manual',
  })
  const responseHeaders: Record<string, string> = {}
  upstream.headers.forEach((value, name) => {
    if (name !== 'content-encoding' && name !== 'content-length') responseHeaders[name] = value
  })
  input.response.writeHead(upstream.status, responseHeaders)
  if (!upstream.body) {
    input.response.end()
    return
  }
  const reader = upstream.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    input.response.write(Buffer.from(value))
  }
  input.response.end()
}

export interface GoldenProviderGateway {
  readonly baseUrl: string
  readonly server: Server
  close(): Promise<void>
}

export async function startGoldenProviderGateway(input: {
  readonly modelBaseUrl: string
  readonly mediaBaseUrl: string
  readonly port?: number
}): Promise<GoldenProviderGateway> {
  const server = createServer((request, response) => {
    void proxyGoldenRequest({
      request,
      response,
      modelBaseUrl: input.modelBaseUrl,
      mediaBaseUrl: input.mediaBaseUrl,
    }).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port ?? 0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('GOLDEN_PROVIDER_GATEWAY_ADDRESS_MISSING')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
