import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createEditFirstWorkflowView,
  type EditFirstWorkflowStatusKind,
  type EditFirstWorkflowStep,
  type EditFirstWorkflowView,
} from '@/lib/project-workflow/edit-first-view'

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

const {
  buildEditFirstAssistantChoiceCard,
  readEditFirstAspectRatio,
} = await import('@/lib/project-agent/choice-card')

function workflow(
  step: EditFirstWorkflowStep,
  status: EditFirstWorkflowStatusKind,
): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step,
    status: status === 'processing' || status === 'needs_user_choice' || status === 'failed'
      ? { kind: status, reason: 'test workflow position' }
      : { kind: status, reason: null },
  })
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export type { EditFirstWorkflowView } from '@/lib/project-workflow/edit-first-view'
export { buildEditFirstAssistantChoiceCard, prismaState, readEditFirstAspectRatio, workflow }
