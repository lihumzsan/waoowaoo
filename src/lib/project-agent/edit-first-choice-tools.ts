export type EditFirstChoiceType = 'script_intake' | 'bible_review' | 'style' | 'asset_review' | 'budget_confirmation'

export const EDIT_FIRST_CHOICE_TOOL_IDS = {
  script_intake: 'request_script_intake_choice',
  bible_review: 'request_edit_bible_review_choice',
  style: 'request_edit_style_choice',
  asset_review: 'request_edit_asset_review_choice',
  budget_confirmation: 'request_edit_budget_confirmation_choice',
} as const satisfies Record<EditFirstChoiceType, string>

export type EditFirstChoiceToolId = (typeof EDIT_FIRST_CHOICE_TOOL_IDS)[EditFirstChoiceType]

export const EDIT_FIRST_CHOICE_OPERATION_IDS: readonly EditFirstChoiceToolId[] = [
  EDIT_FIRST_CHOICE_TOOL_IDS.script_intake,
  EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
  EDIT_FIRST_CHOICE_TOOL_IDS.style,
  EDIT_FIRST_CHOICE_TOOL_IDS.asset_review,
  EDIT_FIRST_CHOICE_TOOL_IDS.budget_confirmation,
]

export function isEditFirstChoiceToolId(operationId: string): operationId is EditFirstChoiceToolId {
  return (EDIT_FIRST_CHOICE_OPERATION_IDS as readonly string[]).includes(operationId)
}
