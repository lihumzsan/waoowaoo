import { getLtx23WorkflowProfile, normalizeLtx23WorkflowKey } from './ltx23-workflow-profiles'

const LTX23_PROFILE_PREFIX = 'basevideo/ltx23-profiles/'

function containsLegacyLtx23Marker(workflowKey: string): boolean {
  const normalized = workflowKey.toLowerCase()
  return normalized.includes('ltx2.3')
    || normalized.includes('ltx-2.3')
    || normalized.includes('ltx23')
}

function looksLikeComfyUiVideoWorkflow(workflowKey: string): boolean {
  return workflowKey.startsWith('basevideo/')
}

export function isRemovedLegacyLtx23WorkflowKey(rawKey: string | null | undefined): boolean {
  const workflowKey = normalizeLtx23WorkflowKey(rawKey)
  if (!workflowKey) return false
  if (getLtx23WorkflowProfile(workflowKey)) return false
  if (workflowKey.startsWith(LTX23_PROFILE_PREFIX)) return false
  return looksLikeComfyUiVideoWorkflow(workflowKey) && containsLegacyLtx23Marker(workflowKey)
}

export function assertNotRemovedLegacyLtx23WorkflowKey(rawKey: string | null | undefined): void {
  if (!isRemovedLegacyLtx23WorkflowKey(rawKey)) return
  throw new Error(`LEGACY_LTX23_WORKFLOW_REMOVED: ${normalizeLtx23WorkflowKey(rawKey)}`)
}
