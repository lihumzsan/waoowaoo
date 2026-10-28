import { z } from 'zod'

/** Identity of one immutable project file; paths never replace this pair. */
export const workspaceResourceReferenceSchema = z
  .object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  })
  .strict()
