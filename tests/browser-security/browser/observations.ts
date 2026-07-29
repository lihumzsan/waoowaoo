import type { ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test'

export interface SecurityConsoleObservation {
  readonly type: string
  readonly text: string
  readonly location: string
}

export interface SecurityPageErrorObservation {
  readonly name: string
  readonly message: string
  readonly stack: string | null
}

export interface SecurityHttpObservation {
  readonly method: string
  readonly url: string
  readonly status: number | null
  readonly failure: string | null
}

export interface SecurityBrowserObservationSnapshot {
  readonly consoleErrors: readonly SecurityConsoleObservation[]
  readonly pageErrors: readonly SecurityPageErrorObservation[]
  readonly failedRequests: readonly SecurityHttpObservation[]
  readonly errorResponses: readonly SecurityHttpObservation[]
  readonly blockedExternalRequests: readonly SecurityHttpObservation[]
}

export interface SecurityBrowserObservationAllowances {
  readonly allowedHttpStatuses?: ReadonlySet<number>
  readonly allowedConsoleErrorPatterns?: readonly RegExp[]
  readonly allowedFailedRequestPatterns?: readonly {
    readonly method: string
    readonly url: RegExp
  }[]
}

export function collectSecurityBrowserObservationViolations(
  snapshot: SecurityBrowserObservationSnapshot,
  input: SecurityBrowserObservationAllowances = {},
): string[] {
  const allowedStatuses = input.allowedHttpStatuses ?? new Set<number>()
  const allowedConsoleErrorPatterns = input.allowedConsoleErrorPatterns ?? []
  const allowedFailedRequestPatterns = input.allowedFailedRequestPatterns ?? []
  const unexpectedResponses = snapshot.errorResponses.filter((response) => (
    response.status === null || !allowedStatuses.has(response.status)
  ))
  return [
    ...snapshot.consoleErrors
      .filter((item) => !allowedConsoleErrorPatterns.some((pattern) => pattern.test(item.text)))
      .map((item) => `console:${item.text}`),
    ...snapshot.pageErrors.map((item) => `page:${item.name}:${item.message}`),
    ...snapshot.failedRequests
      .filter((item) => !allowedFailedRequestPatterns.some((pattern) => (
        pattern.method === item.method && pattern.url.test(item.url)
      )))
      .map((item) => `request:${item.method}:${item.url}:${item.failure}`),
    ...unexpectedResponses.map((item) => `response:${item.status}:${item.method}:${item.url}`),
    ...snapshot.blockedExternalRequests.map((item) => `external-network:${item.method}:${item.url}`),
  ]
}

function requestObservation(request: Request, status: number | null, failure: string | null): SecurityHttpObservation {
  return {
    method: request.method(),
    url: request.url(),
    status,
    failure,
  }
}

function consoleObservation(message: ConsoleMessage): SecurityConsoleObservation {
  const location = message.location()
  return {
    type: message.type(),
    text: message.text(),
    location: `${location.url || 'unknown'}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`,
  }
}

export class SecurityBrowserObservations {
  readonly #consoleErrors: SecurityConsoleObservation[] = []
  readonly #pageErrors: SecurityPageErrorObservation[] = []
  readonly #failedRequests: SecurityHttpObservation[] = []
  readonly #errorResponses: SecurityHttpObservation[] = []
  readonly #blockedExternalRequests: SecurityHttpObservation[] = []

  recordBlockedExternalRequest(request: Request): void {
    this.#blockedExternalRequests.push(requestObservation(
      request,
      null,
      'SECURITY_EXTERNAL_BROWSER_NETWORK_BLOCKED',
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

  snapshot(): SecurityBrowserObservationSnapshot {
    return {
      consoleErrors: [...this.#consoleErrors],
      pageErrors: [...this.#pageErrors],
      failedRequests: [...this.#failedRequests],
      errorResponses: [...this.#errorResponses],
      blockedExternalRequests: [...this.#blockedExternalRequests],
    }
  }

  async attachEvidence(testInfo: TestInfo): Promise<void> {
    await testInfo.attach('security-browser-observations', {
      body: Buffer.from(JSON.stringify(this.snapshot(), null, 2)),
      contentType: 'application/json',
    })
  }

  assertClean(input?: SecurityBrowserObservationAllowances): void {
    const snapshot = this.snapshot()
    const violations = collectSecurityBrowserObservationViolations(snapshot, input)
    if (violations.length > 0) {
      throw new Error(`SECURITY_BROWSER_OBSERVATION_FAILED\n${violations.join('\n')}`)
    }
  }
}
