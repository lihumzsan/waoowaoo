#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const retiredStyleChoiceRoute = 'src/app/api/projects/[projectId]/bible/style-preview/route.ts'

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const violations = []
const chatRoute = read('src/app/api/projects/[projectId]/assistant/chat/route.ts')
const control = read('src/lib/project-agent/control.ts')
const controlRoute = read('src/app/api/projects/[projectId]/assistant/runs/[runId]/control.ts')
const sessionState = read('src/lib/project-agent/session-state.ts')
const interruptions = read('src/lib/project-agent/interruptions.ts')
const workflowLab = read('src/lib/workflow-lab/service.ts')
const choiceTypes = read('src/lib/project-agent/types.ts')
const choiceCard = read('src/lib/project-agent/choice-card.ts')
const choiceOffer = read('src/lib/project-agent/choice-offer.ts')
const assistantPanel = read('src/features/project-workspace/components/WorkspaceAssistantPanel.tsx')
const assistantRenderers = read('src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx')
const editScriptHooks = read('src/lib/query/hooks/useProjectEditScript.ts')
const editFirstWorkflow = read('src/lib/project-workflow/edit-first.ts')
const editScriptOperations = read('src/lib/operations/domains/media/edit-script-ops.ts')

for (const marker of [
  'getCurrentProjectAgentActivity',
  'PROJECT_AGENT_CHOICE_ACTIVITY_NOT_PENDING',
  'controlAction.choiceType',
  'controlAction.output.cardId',
]) {
  if (chatRoute.includes(marker)) {
    violations.push(`chat route restores client/activity choice authority via ${JSON.stringify(marker)}`)
  }
}
if (interruptions.includes('parseResponse:')) {
  violations.push('Choice consume authority accepts a caller-defined response parser')
}
for (const marker of [
  'export function parseProjectAgentChoiceDecision(',
  'PROJECT_AGENT_CHOICE_SELECTION_NOT_OFFERED',
  'PROJECT_AGENT_CHOICE_SELECTION_REQUIRED',
]) {
  if (!choiceOffer.includes(marker)) {
    violations.push(`Choice definition is missing persisted-offer response validation ${JSON.stringify(marker)}`)
  }
}

for (const marker of [
  'choiceType: value.choiceType',
  'interruptionId: string | null',
  'toolCallId: string | null',
]) {
  if (control.includes(marker)) {
    violations.push(`choice control restores optional or client-defined identity via ${JSON.stringify(marker)}`)
  }
}

if (controlRoute.includes('choiceType: params.body.choiceType')) {
  violations.push('run-scoped choice route forwards client choiceType instead of resolving the persisted offer')
}

for (const marker of [
  'buildEditFirstAssistantChoiceCard',
  'readPersistedScriptIntakeChoiceCard',
  'readPersistedChoiceCard',
]) {
  if (sessionState.includes(marker)) {
    violations.push(`session refresh rebuilds or reparses a private choice card via ${JSON.stringify(marker)}`)
  }
}

for (const marker of [
  'parseProjectAgentChoiceOffer(record.payload)',
  'assertProjectAgentChoiceOfferCurrent({',
  'appendProjectAgentEventsInTransaction(tx,',
  'response: JSON.parse(JSON.stringify(parsedResponse))',
]) {
  if (!interruptions.includes(marker)) {
    violations.push(`choice consumption is missing required atomic authority marker ${JSON.stringify(marker)}`)
  }
}

if (workflowLab.includes("params.choiceType === 'style' ? null")) {
  violations.push('Workflow Lab restores a style choice without a persistent interruption')
}
if (!workflowLab.includes('payload: serializeWorkflowLabValue(offer)')) {
  violations.push('Workflow Lab choice projection does not persist the shared Choice Offer')
}

for (const [label, source] of [
  ['choice types', choiceTypes],
  ['choice card builder', choiceCard],
  ['assistant panel', assistantPanel],
  ['assistant renderers', assistantRenderers],
  ['edit script hooks', editScriptHooks],
]) {
  for (const marker of [
    "kind: 'confirm_edit_style_preview'",
    'useConfirmProjectEditStylePreview',
    'onConfirmEditStylePreviewChoice',
    'onStyleSelected',
  ]) {
    if (source.includes(marker)) {
      violations.push(`${label} restores a private style-choice execution path via ${JSON.stringify(marker)}`)
    }
  }
}
if (fs.existsSync(path.join(root, retiredStyleChoiceRoute))) {
  violations.push(`retired direct style-choice route was restored: ${retiredStyleChoiceRoute}`)
}
if (!choiceCard.includes("submit: { kind: 'submit_tool_output' }")) {
  violations.push('Choice card builder does not submit every choice through the persisted decision control')
}
if (!editFirstWorkflow.includes("workflowAction('confirm_edit_style_preview', 'Confirm selected visual style')")) {
  violations.push('Workflow does not map the consumed style decision to confirm_edit_style_preview')
}
for (const marker of [
  "confirm_edit_style_preview: defineOperation({",
  'confirmProjectEditStylePreview({',
]) {
  if (!editScriptOperations.includes(marker)) {
    violations.push(`style-confirmation Operation authority is missing ${JSON.stringify(marker)}`)
  }
}

if (violations.length > 0) {
  process.stderr.write([
    '[assistant-choice-offer-authority] Choice authority violations detected.',
    'AR-01/AR-02A: the persisted interruption offer is the only card, identity, and reviewed-resource authority.',
    'See docs/architecture/modules/assistant-run-lifecycle.md.',
    ...violations.map((violation) => `  - ${violation}`),
    '',
  ].join('\n'))
  process.exit(1)
}

process.stdout.write('[assistant-choice-offer-authority] OK\n')
