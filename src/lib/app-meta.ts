const GITHUB_REPOSITORY_VALUE = 'saturndec/waoowaoo'

const packageVersion = process.env.NEXT_PUBLIC_APP_VERSION
if (typeof packageVersion !== 'string' || packageVersion.trim().length === 0) {
  throw new Error('Missing NEXT_PUBLIC_APP_VERSION')
}

export const APP_VERSION = packageVersion.trim()

export const GITHUB_REPOSITORY = GITHUB_REPOSITORY_VALUE

if (!GITHUB_REPOSITORY) {
  throw new Error('Missing GitHub repository configuration')
}
