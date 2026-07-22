export const workspaceNodeId = {
  resourceCard: (resourceOrCandidateSetId: string): string => `resource:${resourceOrCandidateSetId}`,
} as const
