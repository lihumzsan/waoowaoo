export const AMBIENCE_FORBIDDEN_ACTION_TERMS = [
  'footstep',
  'footsteps',
  'walking',
  'running',
  'door',
  'doors',
  'knock',
  'knocking',
  'impact',
  'impacts',
  'collision',
  'collisions',
  'punch',
  'punches',
  'gunshot',
  'gunshots',
] as const

function isExplicitlyNegated(prompt: string, termStart: number): boolean {
  const prefix = prompt.slice(Math.max(0, termStart - 48), termStart)
  return /(?:\bno|\bwithout|\bexclude|\bexcluding|\bavoid)\s+(?:[a-z-]+\s+){0,3}$/i.test(prefix)
}

export function findAmbiencePromptPolicyViolation(prompt: string): string | null {
  for (const term of AMBIENCE_FORBIDDEN_ACTION_TERMS) {
    const pattern = new RegExp(`\\b${term}\\b`, 'gi')
    for (const match of prompt.matchAll(pattern)) {
      const index = match.index
      if (index !== undefined && !isExplicitlyNegated(prompt, index)) return term
    }
  }
  return null
}
