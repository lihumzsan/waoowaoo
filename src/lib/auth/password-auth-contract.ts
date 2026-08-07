export const PASSWORD_AUTH_MODES = ['login', 'register'] as const

export type PasswordAuthMode = (typeof PASSWORD_AUTH_MODES)[number]

export function readPasswordAuthMode(value: unknown): PasswordAuthMode | null {
  return typeof value === 'string' && PASSWORD_AUTH_MODES.includes(value as PasswordAuthMode)
    ? value as PasswordAuthMode
    : null
}
