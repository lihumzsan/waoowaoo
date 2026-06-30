import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { storyboardMutationOperationOutputSchema } from '@/lib/operations/output-schemas'
import {
  cancelStoryboardPanelCandidatesInputSchema,
  selectStoryboardPanelCandidateInputSchema,
  updateStoryboardPanelPromptInputSchema,
  executeStoryboardMutationOperation,
} from './panel-mutations'

const EFFECTS_WRITE = {
  writes: true,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

export function createStoryboardPanelEditOperations(): ProjectAgentOperationRegistryDraft {
  return {
    update_storyboard_panel_prompt: defineOperation({
      id: 'update_storyboard_panel_prompt',
      summary: 'Update prompt or acting notes fields for a storyboard panel.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE,
        overwrite: true,
      },
      confirmation: {
        required: true,
        summary: '将修改分镜格提示词或演技指导。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: updateStoryboardPanelPromptInputSchema,
      outputSchema: storyboardMutationOperationOutputSchema,
      execute: async (ctx, input) => executeStoryboardMutationOperation(ctx, {
        ...input,
        action: 'update_panel_prompt',
      }, 'update_storyboard_panel_prompt'),
    }),
    select_storyboard_panel_candidate: defineOperation({
      id: 'select_storyboard_panel_candidate',
      summary: 'Select one storyboard panel candidate image as the final panel image.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE,
        overwrite: true,
      },
      confirmation: {
        required: true,
        summary: '将确认候选图并覆盖当前分镜图。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: selectStoryboardPanelCandidateInputSchema,
      outputSchema: storyboardMutationOperationOutputSchema,
      execute: async (ctx, input) => executeStoryboardMutationOperation(ctx, {
        ...input,
        action: 'select_panel_candidate',
      }, 'select_storyboard_panel_candidate'),
    }),
    cancel_storyboard_panel_candidates: defineOperation({
      id: 'cancel_storyboard_panel_candidates',
      summary: 'Cancel and clear candidate images for a storyboard panel.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE,
        destructive: true,
      },
      confirmation: {
        required: true,
        summary: '将清空该分镜格的候选图。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: cancelStoryboardPanelCandidatesInputSchema,
      outputSchema: storyboardMutationOperationOutputSchema,
      execute: async (ctx, input) => executeStoryboardMutationOperation(ctx, {
        ...input,
        action: 'cancel_panel_candidates',
      }, 'cancel_storyboard_panel_candidates'),
    }),
  }
}
