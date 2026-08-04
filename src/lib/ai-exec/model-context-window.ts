import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'

/**
 * Single reader for a model's declared context window.
 *
 * Returns null when the model does not declare one. Callers must fail closed on
 * null rather than substitute a default: an assumed window is either wasted
 * context or a hard overflow, and both are invisible until they bite.
 */
export function readModelContextWindow(modelKey: string): number | null {
  ensureAiCatalogsRegistered()
  const contextWindow = resolveBuiltinCapabilitiesByModelKey('llm', modelKey)?.llm?.contextWindow
  return typeof contextWindow === 'number' ? contextWindow : null
}
