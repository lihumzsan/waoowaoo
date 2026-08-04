/**
 * Compatibility identity for durable Codex session state.
 *
 * Bump only when the pinned Codex protocol, process host, or tool topology can
 * no longer be resumed safely. Product messages remain authoritative and seed
 * the replacement native Thread; ordinary process restarts keep this value.
 */
export const ASSISTANT_RUNTIME_REVISION = 'codex-0.146.0-autonomous-creative-workers-v2' as const
