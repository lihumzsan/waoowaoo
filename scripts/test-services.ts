import {
  prepareFreshTestServices,
  startTestServices,
  stopTestServices,
  waitForTestServices,
  pushTestSchema,
} from '../tests/setup/test-services'

const command = process.argv[2]

async function main() {
  if (command === 'prepare') {
    await prepareFreshTestServices()
    return
  }

  if (command === 'start') {
    startTestServices()
    await waitForTestServices()
    return
  }

  if (command === 'wait') {
    await waitForTestServices()
    return
  }

  if (command === 'schema') {
    pushTestSchema()
    return
  }

  if (command === 'stop') {
    stopTestServices()
    return
  }

  throw new Error(`Unknown test service command: ${command || '(empty)'}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
