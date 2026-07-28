#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import ts from 'typescript'

const root = process.cwd()

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function parseTypeScript(source) {
  return ts.createSourceFile('choice-authority.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function visit(node, visitor) {
  visitor(node)
  ts.forEachChild(node, (child) => visit(child, visitor))
}

function expressionUsesChoiceType(node) {
  if (!node) return false
  if (ts.isIdentifier(node) && node.text === 'choiceType') return true
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'choiceType') return true
  if (
    ts.isElementAccessExpression(node)
    && ts.isStringLiteral(node.argumentExpression)
    && node.argumentExpression.text === 'choiceType'
  ) return true
  let found = false
  ts.forEachChild(node, (child) => {
    if (!found && expressionUsesChoiceType(child)) found = true
  })
  return found
}

export function inspectFixedChoiceDispatch(source) {
  const sourceFile = parseTypeScript(source)
  const violations = []
  visit(sourceFile, (node) => {
    const expression = ts.isSwitchStatement(node)
      ? node.expression
      : ts.isIfStatement(node) || ts.isConditionalExpression(node)
        ? node.expression ?? node.condition
        : null
    if (!expression || !expressionUsesChoiceType(expression)) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push(`Choice control flow branches on retired choiceType at line ${line + 1}`)
  })
  return violations
}

export function inspectChoiceSuspensionReceiptAuthority(source) {
  const violations = []
  for (const marker of [
    'operation.agentFlow?.suspendsFor',
    'requireProjectAgentChoiceHandoffReceipt({',
  ]) {
    if (!source.includes(marker)) {
      violations.push(`Operation invocation is missing Choice suspension authority ${JSON.stringify(marker)}`)
    }
  }
  for (const forbidden of [
    'requireProjectAgentSuspensionReceipt({',
    'resolveProjectAgentOperationPostInvocationStatus',
    'choiceExecutionOutcome',
  ]) {
    if (source.includes(forbidden)) {
      violations.push(`Operation invocation restores legacy Choice postcondition ${JSON.stringify(forbidden)}`)
    }
  }
  return violations
}

function requireMarkers(label, source, markers, violations) {
  for (const marker of markers) {
    if (!source.includes(marker)) violations.push(`${label} is missing ${JSON.stringify(marker)}`)
  }
}

function rejectMarkers(label, source, markers, violations) {
  for (const marker of markers) {
    if (source.includes(marker)) violations.push(`${label} restores ${JSON.stringify(marker)}`)
  }
}

function runSelfTest() {
  const bad = `function render(input: { choiceType: string }) {
    if (input.choiceType === 'style') return 'legacy'
    return 'generic'
  }`
  if (inspectFixedChoiceDispatch(bad).length !== 1) {
    throw new Error('ASSISTANT_CHOICE_GUARD_SELF_TEST_DID_NOT_REJECT_FIXED_DISPATCH')
  }
  if (inspectFixedChoiceDispatch("function render(card: { mode: string }) { return card.mode }").length !== 0) {
    throw new Error('ASSISTANT_CHOICE_GUARD_SELF_TEST_REJECTED_GENERIC_PROTOCOL')
  }
}

runSelfTest()

const files = {
  choiceOffer: read('src/lib/project-agent/choice-offer.ts'),
  choiceResult: read('src/lib/project-agent/choice-result.ts'),
  choiceOperation: read('src/lib/operations/domains/assistant/choice-ops.ts'),
  interruptions: read('src/lib/project-agent/interruptions.ts'),
  commandService: read('src/lib/project-agent/command-service.ts'),
  sessionState: read('src/lib/project-agent/session-state.ts'),
  operationInvocation: read('src/lib/operations/invocation.ts'),
  operationRegistry: read('src/lib/operations/registry.ts'),
  operationTypes: read('src/lib/operations/types.ts'),
  choiceRenderer: read('src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantChoiceCard.tsx'),
}

const violations = []

requireMarkers('generic Choice offer', files.choiceOffer, [
  "mode: z.enum(['confirm', 'confirm_or_text', 'select', 'select_or_text'])",
  'projectAgentChoiceCardAuthoringSchema',
  'projectAgentChoiceSubjectRequestSchema',
  'projectAgentChoiceCommitmentRequestSchema',
  'assertProjectAgentChoiceCommitmentsMatchCard',
  'resolveProjectAgentChoiceSubject',
  'assertProjectAgentChoiceOfferCurrent',
  'parseProjectAgentChoiceOffer',
], violations)
requireMarkers('generic Choice operation', files.choiceOperation, [
  "request_choice: defineOperation({",
  'card: projectAgentChoiceCardAuthoringSchema',
  'subject: projectAgentChoiceSubjectRequestSchema',
  'commitments: z.array(projectAgentChoiceCommitmentRequestSchema)',
  'prepareProjectAgentChoiceExecutionHandoff({',
], violations)
requireMarkers('generic Choice decision', files.choiceResult, [
  "| { kind: 'confirm' }",
  "| { kind: 'select'; selections: ProjectAgentChoiceSelection[] }",
  "| { kind: 'text'; text: string }",
  "| { kind: 'cancelled' }",
  'parseProjectAgentChoiceDecision(',
  'resolveProjectAgentChoiceCommitment(',
], violations)
requireMarkers('Choice atomic consumption', files.interruptions, [
  'parseProjectAgentChoiceOffer(record.payload)',
  'assertProjectAgentChoiceOfferCurrent({',
  'resolveProjectAgentChoiceCommitment({',
  "invocationMode: 'atomic_choice_commit'",
  'response: JSON.parse(JSON.stringify(parsedResponse))',
], violations)
requireMarkers('Choice-eligible Operation registry contract', `${files.operationTypes}\n${files.operationRegistry}`, [
  'choiceCommit?: OperationChoiceCommit',
  'choiceCommit.enabled !== true',
], violations)
requireMarkers('generic Choice renderer', files.choiceRenderer, [
  'card.mode',
  "kind: 'confirm'",
  "kind: 'select'",
  "kind: 'text'",
  "kind: 'cancelled'",
], violations)

for (const [label, source] of Object.entries(files)) {
  rejectMarkers(label, source, [
    'choiceType',
    'EditFirstChoiceType',
    'EDIT_FIRST_CHOICE_REGISTRY',
    'confirm_edit_style_preview',
    'request_edit_style_choice',
    'request_script_confirmation',
    'request_bible_confirmation',
    'request_asset_review',
  ], violations)
  violations.push(...inspectFixedChoiceDispatch(source).map((message) => `${label}: ${message}`))
}

rejectMarkers('Assistant command authority', `${files.commandService}\n${files.interruptions}`, [
  'controlAction.choiceType',
  'choiceType: params.body.choiceType',
  'parseResponse:',
], violations)
rejectMarkers('Session projection', files.sessionState, [
  'buildEditFirstAssistantChoiceCard',
  'readPersistedScriptIntakeChoiceCard',
  'readPersistedChoiceCard',
], violations)
rejectMarkers('generic Choice renderer', files.choiceRenderer, [
  "activeGroup?.key === 'aspectRatio'",
  "activeGroup?.key === 'stylePreviewId'",
], violations)

violations.push(...inspectChoiceSuspensionReceiptAuthority(files.operationInvocation))

for (const retiredPath of [
  'src/lib/project-agent/edit-first-choice-tools.ts',
  'src/lib/project-agent/edit-first-choice-result.ts',
  'src/lib/project-agent/choice-card.ts',
  'src/app/api/projects/[projectId]/bible/style-preview/route.ts',
]) {
  if (fs.existsSync(path.join(root, retiredPath))) {
    violations.push(`retired fixed Choice path was restored: ${retiredPath}`)
  }
}

if (violations.length > 0) {
  process.stderr.write([
    '[assistant-choice-offer-authority] Choice authority violations detected.',
    'AR-02A..AR-02F: one model-authored generic Offer is the only Choice protocol; it handles only the current decision.',
    'See docs/architecture/modules/assistant-run-lifecycle.md.',
    ...violations.map((violation) => `  - ${violation}`),
    '',
  ].join('\n'))
  process.exit(1)
}

process.stdout.write('[assistant-choice-offer-authority] OK\n')
