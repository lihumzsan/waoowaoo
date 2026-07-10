import fs from 'node:fs'
import path from 'node:path'

// Agent continuation control (approval / choice / task follow-up) must travel
// through run-scoped endpoints and server-side interruption/wait rows. The
// client never encodes control state into message metadata and never decides
// continuation semantics. These terms are the legacy metadata-control protocol
// surface; they must not reappear in client code.

const roots = [
  'src/features',
  'src/components',
  'src/hooks',
  'src/contexts',
]

const banned = [
  'projectAgentApprovalResponse',
  'projectAgentChoiceResponse',
  'resumeOperationId',
  'shouldSendAssistantWaitFollowUp',
  'RunState.fromString',
]

export function inspectClientAgentControl(filePath, content) {
  return banned
    .filter((term) => content.includes(term))
    .map((term) => `${filePath} contains ${term}`)
}

function walk(target) {
  const absolute = path.resolve(process.cwd(), target)
  if (!fs.existsSync(absolute)) return []
  const stat = fs.statSync(absolute)
  if (stat.isFile()) return [absolute]
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(absolute, entry.name)
    if (entry.isDirectory()) return walk(path.relative(process.cwd(), next))
    if (entry.isFile()) return [next]
    return []
  })
}

const violations = []
for (const root of roots) {
  for (const filePath of walk(root)) {
    if (!/\.(ts|tsx)$/.test(filePath)) continue
    const content = fs.readFileSync(filePath, 'utf8')
    violations.push(...inspectClientAgentControl(path.relative(process.cwd(), filePath), content))
  }
}

if (violations.length > 0) {
  console.error([
    'AR-01: agent control protocol must not leak into client code (use the structured chat control body).',
    'See docs/architecture/modules/assistant-run-lifecycle.md#不变量.',
    ...violations,
  ].join('\n'))
  process.exit(1)
}
