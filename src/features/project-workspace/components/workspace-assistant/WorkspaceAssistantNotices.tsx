/**
 * Parts the runtime needs in the stream but the reader never should see:
 * approval bookkeeping, runtime context snapshots and already-resolved
 * interruptions. Rendering nothing is the intended behaviour, not a stub.
 */
export function HiddenApprovalRequestDataCard() {
  return null
}

export function HiddenRuntimeContextDataCard() {
  return null
}
