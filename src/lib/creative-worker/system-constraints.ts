export const CREATIVE_WORK_CALLER_CONSTRAINT_LIMIT = 64

export const CREATIVE_WORK_SYSTEM_CONSTRAINTS = {
  human_visual_safety: 'Mandatory human visual safety: every depicted human identity must be clearly stylized and non-photoreal. Never select, imitate, or depict a real person, real face, public figure, celebrity, face likeness, digital human, photoreal human, or realistic human 3D/CG/CGI. CCTV, VHS, documentary, or archival texture may shape the environment, but must not make people photoreal.',
} as const

export type CreativeWorkSystemConstraintId = keyof typeof CREATIVE_WORK_SYSTEM_CONSTRAINTS

export const CREATIVE_WORK_COMPILED_CONSTRAINT_LIMIT = (
  CREATIVE_WORK_CALLER_CONSTRAINT_LIMIT
  + Object.keys(CREATIVE_WORK_SYSTEM_CONSTRAINTS).length
)

export function compileCreativeWorkSystemConstraints(input: {
  readonly callerConstraints: readonly string[]
  readonly systemConstraintIds: readonly CreativeWorkSystemConstraintId[]
}): string[] {
  const systemConstraints = input.systemConstraintIds.map(
    (constraintId) => CREATIVE_WORK_SYSTEM_CONSTRAINTS[constraintId],
  )
  const uniqueSystemConstraints = new Set<string>(systemConstraints)
  if (uniqueSystemConstraints.size !== systemConstraints.length) {
    throw new Error('CREATIVE_WORK_SYSTEM_CONSTRAINT_DUPLICATE')
  }
  return [
    ...systemConstraints,
    ...input.callerConstraints.filter((constraint) => !uniqueSystemConstraints.has(constraint)),
  ]
}
