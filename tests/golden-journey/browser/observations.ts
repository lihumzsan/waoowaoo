import type { ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test'

export interface GoldenConsoleObservation {
  readonly type: string
  readonly text: string
  readonly location: string
}

export interface GoldenPageErrorObservation {
  readonly name: string
  readonly message: string
  readonly stack: string | null
}

export interface GoldenHttpObservation {
  readonly method: string
  readonly url: string
  readonly status: number | null
  readonly failure: string | null
}

export interface GoldenBrowserObservationSnapshot {
  readonly consoleErrors: readonly GoldenConsoleObservation[]
  readonly pageErrors: readonly GoldenPageErrorObservation[]
  readonly failedRequests: readonly GoldenHttpObservation[]
  readonly errorResponses: readonly GoldenHttpObservation[]
  readonly blockedExternalRequests: readonly GoldenHttpObservation[]
}

function requestObservation(request: Request, status: number | null, failure: string | null): GoldenHttpObservation {
  return {
    method: request.method(),
    url: request.url(),
    status,
    failure,
  }
}

function consoleObservation(message: ConsoleMessage): GoldenConsoleObservation {
  const location = message.location()
  return {
    type: message.type(),
    text: message.text(),
    location: `${location.url || 'unknown'}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`,
  }
}

export class GoldenBrowserObservations {
  readonly #consoleErrors: GoldenConsoleObservation[] = []
  readonly #pageErrors: GoldenPageErrorObservation[] = []
  readonly #failedRequests: GoldenHttpObservation[] = []
  readonly #errorResponses: GoldenHttpObservation[] = []
  readonly #blockedExternalRequests: GoldenHttpObservation[] = []

  recordBlockedExternalRequest(request: Request): void {
    this.#blockedExternalRequests.push(requestObservation(
      request,
      null,
      'GOLDEN_EXTERNAL_BROWSER_NETWORK_BLOCKED',
    ))
  }

  attach(page: Page): void {
    page.on('console', (message) => {
      if (message.type() === 'error') this.#consoleErrors.push(consoleObservation(message))
    })
    page.on('pageerror', (error) => {
      this.#pageErrors.push({
        name: error.name,
        message: error.message,
        stack: error.stack ?? null,
      })
    })
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown request failure'
      if (failure.includes('ERR_ABORTED')) return
      this.#failedRequests.push(requestObservation(
        request,
        null,
        failure,
      ))
    })
    page.on('response', (response: Response) => {
      if (response.status() < 400) return
      this.#errorResponses.push(requestObservation(response.request(), response.status(), null))
    })
  }

  snapshot(): GoldenBrowserObservationSnapshot {
    return {
      consoleErrors: [...this.#consoleErrors],
      pageErrors: [...this.#pageErrors],
      failedRequests: [...this.#failedRequests],
      errorResponses: [...this.#errorResponses],
      blockedExternalRequests: [...this.#blockedExternalRequests],
    }
  }

  async attachEvidence(testInfo: TestInfo): Promise<void> {
    await testInfo.attach('golden-browser-observations', {
      body: Buffer.from(JSON.stringify(this.snapshot(), null, 2)),
      contentType: 'application/json',
    })
  }

  assertClean(input?: {
    readonly allowedHttpStatuses?: ReadonlySet<number>
  }): void {
    const allowedStatuses = input?.allowedHttpStatuses ?? new Set<number>()
    const snapshot = this.snapshot()
    const unexpectedResponses = snapshot.errorResponses.filter((response) => (
      response.status === null || !allowedStatuses.has(response.status)
    ))
    const violations = [
      ...snapshot.consoleErrors.map((item) => `console:${item.text}`),
      ...snapshot.pageErrors.map((item) => `page:${item.name}:${item.message}`),
      ...snapshot.failedRequests.map((item) => `request:${item.method}:${item.url}:${item.failure}`),
      ...unexpectedResponses.map((item) => `response:${item.status}:${item.method}:${item.url}`),
      ...snapshot.blockedExternalRequests.map((item) => `external-network:${item.method}:${item.url}`),
    ]
    if (violations.length > 0) {
      throw new Error(`GOLDEN_BROWSER_OBSERVATION_FAILED\n${violations.join('\n')}`)
    }
  }
}
