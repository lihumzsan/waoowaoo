import { Client, Connection } from '@temporalio/client'
import {
  buildTemporalConnectionOptions,
  getTemporalRuntimeConfig,
  type TemporalRuntimeConfig,
} from './config'

export interface ConnectedTemporalClient {
  client: Client
  close(): Promise<void>
}

export async function connectTemporalClient(
  config: TemporalRuntimeConfig = getTemporalRuntimeConfig(),
): Promise<ConnectedTemporalClient> {
  const connection = await Connection.connect(
    buildTemporalConnectionOptions(config),
  )
  return {
    client: new Client({
      connection,
      namespace: config.namespace,
    }),
    async close() {
      await connection.close()
    },
  }
}

const globalForTemporal = globalThis as typeof globalThis & {
  __waoowaooTemporalClientPromise?: Promise<Client>
}

export async function getTemporalClient(): Promise<Client> {
  if (!globalForTemporal.__waoowaooTemporalClientPromise) {
    globalForTemporal.__waoowaooTemporalClientPromise = connectTemporalClient()
      .then(({ client }) => client)
      .catch((error: unknown) => {
        delete globalForTemporal.__waoowaooTemporalClientPromise
        throw error
      })
  }
  return await globalForTemporal.__waoowaooTemporalClientPromise
}
