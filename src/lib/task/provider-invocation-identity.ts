/**
 * Provider invocation keys identify one external request within a Task. They
 * are intentionally independent of stream attempts and transport retries.
 */
export function createImageCandidateInvocationKey(candidateIndex: number): string {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
    throw new Error(`IMAGE_CANDIDATE_INVOCATION_INDEX_INVALID:${String(candidateIndex)}`)
  }
  return `media:image:candidate:${String(candidateIndex)}`
}
