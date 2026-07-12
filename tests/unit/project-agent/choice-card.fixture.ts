import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

const prismaState = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  bibleFindFirst: vi.fn(),
  editScriptFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: prismaState.projectFindFirst,
    },
    projectEditBible: {
      findFirst: prismaState.bibleFindFirst,
    },
    projectEditScript: {
      findMany: prismaState.editScriptFindMany,
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: (key: string) => `/signed/${key}`,
}))

import {
  buildEditFirstAssistantChoiceCard,
  readEditFirstAspectRatio,
} from '@/lib/project-agent/choice-card'

function workflow(
  stage: EditFirstWorkflowState['stage'],
  nextAction: EditFirstWorkflowState['nextAction'] = null,
): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: stage === 'needs_style_choice' || stage === 'assets_ready_for_review' ? 'needs_user_choice' : 'needs_confirmation',
      reason: null,
    },
    nextAction,
    allowedOperationIds: nextAction ? [nextAction.operationId] : [],
    operationGroup: null,
  }
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
export { buildEditFirstAssistantChoiceCard, readEditFirstAspectRatio } from '@/lib/project-agent/choice-card'
export { prismaState, workflow }
