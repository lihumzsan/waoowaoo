# Authenticated Development Route Warmup Design

## Goal

Make the first real browser visit to the development application fast without removing or delaying any application capability. Startup duration may increase. The complete Next.js, worker, watchdog, Bull Board, database, Redis, and object-storage stack remains available.

## Scope

Add a development-only, one-shot warmup process to `npm run dev`. It waits for the local Next.js server, authenticates as the fixed internal development user supplied by the project owner, and requests the routes used by the initial application flow.

This change does not alter production startup, application authorization rules, queue processing, or UI behavior.

## Startup Flow

`npm run dev` continues to initialize storage and start the existing Next.js, worker, watchdog, and Bull Board processes. A fifth process runs the warmup script concurrently:

1. Poll the local Next.js health surface until it accepts requests or a bounded timeout expires.
2. Request `/zh` to compile the locale middleware, layout, providers, navigation, and landing page.
3. Request the NextAuth CSRF endpoint and retain its cookies.
4. Submit one credentials login using the fixed internal development account.
5. Retain the authenticated session cookie without printing it.
6. Request `/api/auth/session` to warm the authenticated session path.
7. Request `/zh/home` to compile the authenticated home page.
8. Request `/api/projects?page=1&pageSize=5` to warm authorization, Prisma, database connection, and the initial project query.
9. Print a compact status and duration summary, then exit successfully.

## Credentials and Safety Boundaries

The fixed credentials are intentionally embedded in the development warmup script at the project owner's request. They are not repeated in this design document or emitted to logs.

The script must:

- target only `http://127.0.0.1` or `http://localhost`;
- refuse to run when `NODE_ENV=production`;
- run only from the development command;
- execute the login once per startup;
- perform only the login POST required to obtain a session and otherwise use GET requests;
- never print passwords, CSRF tokens, or cookies.

## Failure Handling

Warmup is an optimization, not a runtime dependency. Failure must not terminate Next.js or any background service.

- If Next.js does not become reachable before the timeout, log one warning and exit cleanly.
- If CSRF retrieval or login fails, continue with anonymous-safe route warmup where possible and skip authenticated API warmup.
- If an individual route fails, record its status and continue with the remaining routes.
- Use bounded per-request timeouts so the warmup process cannot remain alive indefinitely.

## Alternatives Considered

### Anonymous-only warmup

This avoids credentials but cannot exercise the real project query path because `/api/projects` returns an authorization response. It provides less coverage of the user's actual first-use flow.

### Refactor the landing and authentication module graph

Splitting session, Prisma, bcrypt, Redis, and navigation dependencies could reduce compilation work instead of moving it. It is substantially more invasive and should be considered only if authenticated warmup does not meet the measured latency target.

### Turbopack-only switch

The local comparison improved server readiness but made the first `/zh` compilation slower. It is not a reliable standalone solution for this repository on the current Next.js version.

## Verification

Verification should cover both behavior and performance:

1. Unit-test cookie extraction, CSRF/login request construction, localhost enforcement, timeout handling, and secret redaction.
2. Run the warmup against a controlled HTTP test server to verify request order and authenticated cookie propagation without exposing credentials.
3. Start the complete `npm run dev` stack and confirm the warmup reports successful responses for the critical route chain.
4. Open a fresh browser session after warmup and compare `/zh`, `/api/auth/session`, `/zh/home`, and `/api/projects` request times with the recorded baseline.
5. Confirm worker, watchdog, and Bull Board startup behavior is unchanged.

## Acceptance Criteria

- The complete project still starts through one `npm run dev` command.
- The warmup process completes once and exits without stopping the other processes.
- The first real browser visit uses already-compiled critical routes.
- Authenticated project listing is warmed for the fixed internal user.
- No credential, CSRF token, or session cookie appears in terminal output.
- Production commands do not invoke the warmup script.
