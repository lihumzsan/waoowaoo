export const workspaceNodeId = {
  resourceCard: (resourceId: string): string => `resource:${resourceId}`,
  folder: (resourceId: string): string => `folder:${resourceId}`,
} as const
