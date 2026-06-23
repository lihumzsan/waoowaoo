export type EditFirstChoiceType = 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review'

export const EDIT_FIRST_CHOICE_TOOL_IDS = {
  duration_and_aspect_ratio: 'request_edit_duration_aspect_ratio_choice',
  screenplay_review: 'request_edit_screenplay_review_choice',
  style: 'request_edit_style_choice',
  asset_review: 'request_edit_asset_review_choice',
} as const satisfies Record<EditFirstChoiceType, string>

export type EditFirstChoiceToolId = (typeof EDIT_FIRST_CHOICE_TOOL_IDS)[EditFirstChoiceType]

export const EDIT_FIRST_CHOICE_OPERATION_IDS: readonly EditFirstChoiceToolId[] = [
  EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio,
  EDIT_FIRST_CHOICE_TOOL_IDS.screenplay_review,
  EDIT_FIRST_CHOICE_TOOL_IDS.style,
  EDIT_FIRST_CHOICE_TOOL_IDS.asset_review,
]

export function isEditFirstChoiceToolId(operationId: string): operationId is EditFirstChoiceToolId {
  return (EDIT_FIRST_CHOICE_OPERATION_IDS as readonly string[]).includes(operationId)
}
