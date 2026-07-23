#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const ADAPTERS = [
  ['src/lib/adapters/api/execute-project-agent-operation.ts', 'api'],
  ['src/lib/adapters/tools/execute-project-agent-operation.ts', 'tool'],
]
const FORBIDDEN_ADAPTER_AUTHORITIES = [
  /\.inputSchema\.safeParse\s*\(/,
  /\.outputSchema\.safeParse\s*\(/,
  /\binvokeApprovedOperationPlan\s*\(/,
  /\bplanOperation\s*\(/,
  /\bcommitOperationPlan\s*\(/,
  /\.execute\s*\(/,
  /\.executeInTransaction\s*\(/,
]

export function inspectOperationAdapter(relPath, channel, content) {
  const violations = []
  if (!/from\s+['"]@\/lib\/operations\/invocation['"]/.test(content)) {
    violations.push(`${relPath} must import the shared operation invocation authority`)
  }
  if (!new RegExp(`channel:\\s*['"]${channel}['"]`).test(content)) {
    violations.push(`${relPath} must declare its ${channel} source channel to the shared authority`)
  }
  if (channel === 'tool' && !/executionFence\s*:/.test(content)) {
    violations.push(`${relPath} must pass the Assistant Run execution fence to the shared authority`)
  }
  for (const pattern of FORBIDDEN_ADAPTER_AUTHORITIES) {
    if (pattern.test(content)) {
      violations.push(`${relPath} reimplements operation parsing, planning, execution, or output validation outside the shared authority`)
      break
    }
  }
  return violations
}

export function inspectOperationDomain(relPath, content) {
  const violations = []
  if (/\bfetch\s*\(/.test(content)) {
    violations.push(`${relPath} must not invoke HTTP from an Operation implementation; call the registered Operation authority explicitly`)
  }
  return violations
}

export function findSingleOperationInvocationViolations(scanRoot = root) {
  const violations = ADAPTERS.flatMap(([relPath, channel]) => {
    const fullPath = path.join(scanRoot, relPath)
    if (!fs.existsSync(fullPath)) return [`${relPath} is missing`]
    return inspectOperationAdapter(relPath, channel, fs.readFileSync(fullPath, 'utf8'))
  })
  const domainsRoot = path.join(scanRoot, 'src', 'lib', 'operations', 'domains')
  const domainFiles = fs.readdirSync(domainsRoot, { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
  for (const entry of domainFiles) {
    const relPath = path.join('src/lib/operations/domains', entry)
    violations.push(...inspectOperationDomain(relPath, fs.readFileSync(path.join(scanRoot, relPath), 'utf8')))
  }
  const authorityPath = 'src/lib/operations/invocation.ts'
  const authority = fs.existsSync(path.join(scanRoot, authorityPath))
    ? fs.readFileSync(path.join(scanRoot, authorityPath), 'utf8')
    : ''
  for (const required of [
    'assertOperationChannelAllowed',
    'assertPrerequisites',
    'inputSchema.safeParse',
    'outputSchema.safeParse',
    'invokeApprovedOperationPlan',
    'runWithProjectAgentOperationExecutionFence',
    'assertProjectAgentOperationExecutionFenceCurrent',
    'assertProjectAgentOperationExecutionFenceInTransaction',
    'requireProjectAgentChoiceHandoffReceipt',
    'assertAssistantToolWriteAuthority',
    'PROJECT_AGENT_OPERATION_TASK_BATCH_BINDING_REQUIRED',
    'PROJECT_AGENT_OPERATION_TASK_SUBMISSION_NOT_COMMITTED',
  ]) {
    if (!authority.includes(required)) {
      violations.push(`${authorityPath} is missing required authority ${required}`)
    }
  }
  for (const forbidden of [
    'assertProjectAgentOperationExecutionFenceAfterInvocation',
    'assertProjectAgentChoiceExecutionFenceAfterInvocation',
    'resolveProjectAgentOperationPostInvocationStatus',
  ]) {
    if (authority.includes(forbidden)) {
      violations.push(`${authorityPath} restores retired post-invocation fence authority ${forbidden}`)
    }
  }
  const channelPolicyPath = 'src/lib/operations/channel-policy.ts'
  const channelPolicy = fs.existsSync(path.join(scanRoot, channelPolicyPath))
    ? fs.readFileSync(path.join(scanRoot, channelPolicyPath), 'utf8')
    : ''
  if (!channelPolicy.includes('export function assertOperationChannelAllowed')) {
    violations.push(`${channelPolicyPath} is missing the shared API/Tool channel policy`)
  }
  const planningPath = 'src/lib/operations/planning.ts'
  const planning = fs.existsSync(path.join(scanRoot, planningPath))
    ? fs.readFileSync(path.join(scanRoot, planningPath), 'utf8')
    : ''
  if (!planning.includes("assertOperationChannelAllowed(operation, 'api')")) {
    violations.push(`${planningPath} must enforce the shared channel policy before API planning`)
  }
  const finalCommitAuthorities = [
    ['src/lib/operations/submit-operation-task.ts', 'assertProjectAgentOperationExecutionFenceInTransaction'],
    ['src/lib/operations/planned-operation-invocation.ts', 'assertProjectAgentOperationExecutionFenceInTransaction'],
  ]
  for (const [relPath, required] of finalCommitAuthorities) {
    const fullPath = path.join(scanRoot, relPath)
    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : ''
    if (!content.includes(required)) {
      violations.push(`${relPath} is missing final Assistant Run execution fence ${required}`)
    }
  }
  const taskSubmissionPath = 'src/lib/operations/submit-operation-task.ts'
  const taskSubmission = fs.readFileSync(path.join(scanRoot, taskSubmissionPath), 'utf8')
  for (const required of [
    'prepareTaskSubmissionInput',
    'persistSubmittedTaskBatchInTransaction',
    'taskBatchBinding?.bindInTransaction',
    'taskBatchBinding?.markCommitted',
  ]) {
    if (!taskSubmission.includes(required)) {
      violations.push(`${taskSubmissionPath} is missing atomic Task batch authority ${required}`)
    }
  }
  if (/\bsubmitTask\s*\(/.test(taskSubmission)) {
    violations.push(`${taskSubmissionPath} restores single-Task submission beside the batch authority`)
  }
  const plannedInvocationPath = 'src/lib/operations/planned-operation-invocation.ts'
  const plannedInvocation = fs.readFileSync(path.join(scanRoot, plannedInvocationPath), 'utf8')
  if (!plannedInvocation.includes('taskBatchBinding?.bindInTransaction')) {
    violations.push(`${plannedInvocationPath} does not bind approved Task batches to Assistant Wait in the commit transaction`)
  }
  const runtimePath = 'src/lib/project-agent/runtime.ts'
  const runtime = fs.readFileSync(path.join(scanRoot, runtimePath), 'utf8')
  if (runtime.includes('createProjectAgentWait(')) {
    violations.push(`${runtimePath} must not create a post-commit Wait`)
  }
  for (const required of [
    'parallelToolCalls: true',
    'createProjectAgentOperationBatchCoordinator',
    'sealProjectAgentOperationBatchWait',
    'PROJECT_AGENT_OPERATION_BATCH_OUTCOME_MISSING',
    'submittedTaskReceiptsByToolCall',
    "toolNotFoundBehavior: 'return_error_to_model'",
    'formatProjectAgentToolNotFound',
  ]) {
    if (!runtime.includes(required)) {
      violations.push(`${runtimePath} is missing non-blocking OperationBatch authority ${required}`)
    }
  }
  for (const forbidden of [
    'parallelToolCalls: false',
    'PROJECT_AGENT_PARALLEL_OPERATION_STEP_FORBIDDEN',
    'PROJECT_AGENT_PARALLEL_APPROVAL_STEP_FORBIDDEN',
    'members.length !== 1',
    'PROJECT_AGENT_WAIT_GROUP_MEMBER_MISMATCH',
    'PROJECT_AGENT_WAIT_GROUP_IDENTITY_MISMATCH',
    "toolNotFoundBehavior: 'raise_error'",
  ]) {
    if (runtime.includes(forbidden)) {
      violations.push(`${runtimePath} restores retired single-Operation step authority ${forbidden}`)
    }
  }
  const stopPolicyPath = 'src/lib/project-agent/stop-conditions.ts'
  const stopPolicy = fs.readFileSync(path.join(scanRoot, stopPolicyPath), 'utf8')
  for (const required of ["case 'submitted_tasks':", 'return null']) {
    if (!stopPolicy.includes(required)) {
      violations.push(`${stopPolicyPath} must keep submitted Tasks non-blocking via ${required}`)
    }
  }
  for (const forbidden of ['awaiting_external_task', 'PROJECT_AGENT_MULTIPLE_ASYNC_OPERATIONS_UNSUPPORTED']) {
    if (stopPolicy.includes(forbidden)) {
      violations.push(`${stopPolicyPath} restores retired Task suspension authority ${forbidden}`)
    }
  }
  const waitsPath = 'src/lib/project-agent/waits.ts'
  const waits = fs.readFileSync(path.join(scanRoot, waitsPath), 'utf8')
  for (const required of [
    'bindProjectAgentOperationBatchWaitMemberInTransaction',
    'prepareProjectAgentOperationBatchHandoffInTransaction',
    'sealProjectAgentOperationBatchWait',
    "'collecting'",
    'task.collection_started',
    'task.collection_member_bound',
    'task.collection_sealed',
    "AND status = 'pending'",
  ]) {
    if (!waits.includes(required)) {
      violations.push(`${waitsPath} is missing atomic OperationBatch Wait lifecycle ${required}`)
    }
  }
  for (const forbidden of [
    'bindProjectAgentWaitToTasksInTransaction',
    'prepareProjectAgentTaskExecutionHandoffInTransaction',
  ]) {
    if (waits.includes(forbidden)) {
      violations.push(`${waitsPath} restores retired foreground Task suspension lifecycle ${forbidden}`)
    }
  }
  const toolAdapterPath = 'src/lib/project-agent/agents-tool-adapter.ts'
  const toolAdapter = fs.readFileSync(path.join(scanRoot, toolAdapterPath), 'utf8')
  for (const required of [
    'bindProjectAgentOperationBatchWaitMemberInTransaction',
    'taskBatchBinding',
    'operationBatch',
    'concurrentExecutionSegmentId: params.context.executionSegmentId ?? null',
  ]) {
    if (!toolAdapter.includes(required)) {
      violations.push(`${toolAdapterPath} is missing non-blocking OperationBatch binding ${required}`)
    }
  }
  for (const forbidden of [
    'approvalBarrierOperationIds',
    'bindProjectAgentCollectingWaitMemberInTransaction',
    'bindProjectAgentWaitToTasksInTransaction',
  ]) {
    if (toolAdapter.includes(forbidden)) {
      violations.push(`${toolAdapterPath} restores retired foreground or legacy Operation-group barrier ${forbidden}`)
    }
  }
  return violations
}

export function runOperationWriteAuthorityRegistryGuard(scanRoot = root) {
  const tsx = path.join(scanRoot, 'node_modules', '.bin', 'tsx')
  const script = path.join(scanRoot, 'scripts', 'guards', 'operation-write-authority-registry.ts')
  const result = spawnSync(tsx, [script], {
    cwd: scanRoot,
    encoding: 'utf8',
  })
  if (result.status === 0) return []
  const detail = (result.stderr || result.stdout || 'unknown registry guard failure').trim()
  return [`actual Operation registry write-authority conformance failed: ${detail}`]
}

export function main() {
  const violations = [
    ...findSingleOperationInvocationViolations(root),
    ...runOperationWriteAuthorityRegistryGuard(root),
  ]
  if (violations.length > 0) {
    process.stderr.write([
      '[single-operation-invocation] Operation invocation or non-blocking OperationBatch contract violation.',
      'AR-03C/AR-04/BA-09: invocation.ts remains the single execution authority; one model step may submit repeated or mixed Operations into one transactionally bound background Wait.',
      'See docs/architecture/modules/assistant-run-lifecycle.md and billing-approval.md.',
      ...violations.map((violation) => `  - ${violation}`),
      '',
    ].join('\n'))
    process.exit(1)
  }
  process.stdout.write('[single-operation-invocation] OK\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
