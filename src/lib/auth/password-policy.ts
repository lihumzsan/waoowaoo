export const AUTH_PASSWORD_MIN_LENGTH = 8

export function isPasswordLengthValid(password: string): boolean {
  return password.length >= AUTH_PASSWORD_MIN_LENGTH
}
