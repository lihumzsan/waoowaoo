import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync, spawnSync } from 'node:child_process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const developmentEnvFile = path.resolve(
  repositoryRoot,
  process.env.WAO_DEV_ENV_FILE || '.env',
)

if (!existsSync(developmentEnvFile)) {
  throw new Error(`Development environment file does not exist: ${developmentEnvFile}`)
}

const composeProjectName = process.env.COMPOSE_PROJECT_NAME || 'waoowaoo'
const configuredRuntimeRoot = process.env.WAO_DEV_CODEX_RUNTIME_ROOT
const hostRuntimeRoot = configuredRuntimeRoot
  ? resolveHostPath(configuredRuntimeRoot)
  : path.join(repositoryRoot, '.runtime', 'codex')
const composeRuntimeRoot = toComposePath(hostRuntimeRoot)
const dependencyFingerprint = execFileSync(
  'git',
  ['hash-object', '--stdin'],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: execFileSync(
      'git',
      ['hash-object', 'package.json', 'package-lock.json'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ),
  },
).trim().slice(0, 16)

mkdirSync(hostRuntimeRoot, { recursive: true })

const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: composeProjectName,
  WAO_DEV_CODEX_RUNTIME_HOST_PATH: toComposeHostPath(hostRuntimeRoot),
  WAO_DEV_CODEX_RUNTIME_ROOT: composeRuntimeRoot,
  WAO_DEV_DEPENDENCY_FINGERPRINT: dependencyFingerprint,
  WAO_DEV_ENV_FILE: developmentEnvFile,
}

const composeBaseArgs = [
  'compose',
  '--env-file',
  developmentEnvFile,
  '-f',
  path.join(repositoryRoot, 'docker-compose.yml'),
  '-f',
  path.join(repositoryRoot, 'docker-compose.dev.yml'),
]

runDocker([...composeBaseArgs, 'build', 'app-dev', 'codex-runtime-dev'], environment)
runDocker(
  [...composeBaseArgs, 'up', '--remove-orphans', 'app-dev', 'temporal-worker-dev'],
  environment,
)

function runDocker(args, environmentValue) {
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    env: environmentValue,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolveHostPath(value) {
  if (process.platform !== 'win32') return path.resolve(value)
  if (/^\/[a-zA-Z]\//u.test(value)) {
    return path.resolve(`${value[1].toUpperCase()}:\\${value.slice(3).replaceAll('/', '\\')}`)
  }
  return path.resolve(value)
}

function toComposePath(value) {
  if (process.platform !== 'win32') return value
  const normalized = path.resolve(value).replaceAll('\\', '/')
  const drive = normalized.slice(0, 1).toLowerCase()
  return `/${drive}${normalized.slice(2)}`
}

function toComposeHostPath(value) {
  if (process.platform !== 'win32') return value
  return path.resolve(value).replaceAll('\\', '/')
}
