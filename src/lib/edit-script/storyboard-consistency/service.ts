import type { Prisma } from '@prisma/client'
import type { StoryboardConsistencySourceSnapshot } from './types'
import { generateStoryboardPanelPrompts } from './model-generation'
import {
  upsertEditScriptStoryboard,
  upsertStoryboardPanelsFromPrompts,
} from './persistence'

export async function materializeEditScriptStoryboard(input: {
  readonly client: Prisma.TransactionClient
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
}): Promise<{ readonly storyboardId: string; readonly panelCount: number }> {
  const storyboard = await upsertEditScriptStoryboard({
    client: input.client,
    snapshot: input.sourceSnapshot,
  })
  const generatedPanels = generateStoryboardPanelPrompts({
    snapshot: input.sourceSnapshot,
  })
  const panels = await upsertStoryboardPanelsFromPrompts({
    client: input.client,
    storyboardId: storyboard.id,
    snapshot: input.sourceSnapshot,
    generatedPanels,
  })
  return { storyboardId: storyboard.id, panelCount: panels.length }
}
