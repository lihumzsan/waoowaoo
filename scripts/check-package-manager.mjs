const userAgent = process.env.npm_config_user_agent?.trim() ?? ''
const execPath = process.env.npm_execpath?.replaceAll('\\', '/') ?? ''
const isNpmCli = userAgent.startsWith('npm/') || execPath.endsWith('/npm/bin/npm-cli.js')

if (!isNpmCli) {
  console.error(
    '[package-manager] This repository uses npm and package-lock.json. Run `npm ci`; other package managers are not supported.',
  )
  process.exit(1)
}

console.log('[package-manager] OK npm CLI')
