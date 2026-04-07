import type { Locale } from '@/i18n/routing'

export const PROJECT_NAME_MAX_LENGTH = 100
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500

export interface ProjectDraftInput {
  name: string
  description?: string | null
}

export interface NormalizedProjectDraft {
  name: string
  description: string | null
}

export type ProjectValidationCode =
  | 'PROJECT_NAME_REQUIRED'
  | 'PROJECT_NAME_TOO_LONG'
  | 'PROJECT_DESCRIPTION_TOO_LONG'

export interface ProjectValidationIssue {
  code: ProjectValidationCode
  field: 'name' | 'description'
  limit?: number
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function normalizeProjectDraft(input: ProjectDraftInput): NormalizedProjectDraft {
  return {
    name: input.name.trim(),
    description: normalizeNullableText(input.description),
  }
}

export function validateProjectDraft(input: ProjectDraftInput): ProjectValidationIssue | null {
  const normalized = normalizeProjectDraft(input)

  if (!normalized.name) {
    return {
      code: 'PROJECT_NAME_REQUIRED',
      field: 'name',
    }
  }

  if (normalized.name.length > PROJECT_NAME_MAX_LENGTH) {
    return {
      code: 'PROJECT_NAME_TOO_LONG',
      field: 'name',
      limit: PROJECT_NAME_MAX_LENGTH,
    }
  }

  if (normalized.description && normalized.description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    return {
      code: 'PROJECT_DESCRIPTION_TOO_LONG',
      field: 'description',
      limit: PROJECT_DESCRIPTION_MAX_LENGTH,
    }
  }

  return null
}

export function formatProjectValidationIssue(issue: ProjectValidationIssue, locale: Locale): string {
  switch (issue.code) {
    case 'PROJECT_NAME_REQUIRED':
      return locale === 'en' ? 'Project name is required.' : '项目名称不能为空。'
    case 'PROJECT_NAME_TOO_LONG':
      return locale === 'en'
        ? `Project name cannot exceed ${PROJECT_NAME_MAX_LENGTH} characters.`
        : `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符。`
    case 'PROJECT_DESCRIPTION_TOO_LONG':
      return locale === 'en'
        ? `Project description cannot exceed ${PROJECT_DESCRIPTION_MAX_LENGTH} characters.`
        : `项目描述不能超过 ${PROJECT_DESCRIPTION_MAX_LENGTH} 个字符。`
  }
}
