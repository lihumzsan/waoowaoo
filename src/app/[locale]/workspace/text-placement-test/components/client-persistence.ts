import {
  isPersistedTextPlacementTestState,
  TEXT_PLACEMENT_TEST_STORAGE_KEY,
  type PersistedTextPlacementTestState,
} from './client-state'

const TEXT_PLACEMENT_TEST_DB_NAME = 'waoowaoo.textPlacementTest'
const TEXT_PLACEMENT_TEST_DB_VERSION = 1
const TEXT_PLACEMENT_TEST_STORE_NAME = 'states'
const TEXT_PLACEMENT_TEST_STATE_ID = 'current'

function openTextPlacementTestDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(TEXT_PLACEMENT_TEST_DB_NAME, TEXT_PLACEMENT_TEST_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TEXT_PLACEMENT_TEST_STORE_NAME)) {
        database.createObjectStore(TEXT_PLACEMENT_TEST_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('TEXT_PLACEMENT_TEST_DB_OPEN_FAILED'))
  })
}

function runStateStoreOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openTextPlacementTestDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(TEXT_PLACEMENT_TEST_STORE_NAME, mode)
    const store = transaction.objectStore(TEXT_PLACEMENT_TEST_STORE_NAME)
    const request = operation(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('TEXT_PLACEMENT_TEST_DB_OPERATION_FAILED'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error('TEXT_PLACEMENT_TEST_DB_TRANSACTION_FAILED'))
    }
  }))
}

export async function loadTextPlacementTestState(): Promise<PersistedTextPlacementTestState | null> {
  const stored = await runStateStoreOperation<unknown>('readonly', (store) => store.get(TEXT_PLACEMENT_TEST_STATE_ID))
  if (isPersistedTextPlacementTestState(stored)) {
    window.localStorage.removeItem(TEXT_PLACEMENT_TEST_STORAGE_KEY)
    return stored
  }

  const legacyRaw = window.localStorage.getItem(TEXT_PLACEMENT_TEST_STORAGE_KEY)
  window.localStorage.removeItem(TEXT_PLACEMENT_TEST_STORAGE_KEY)
  if (!legacyRaw) return null

  let legacyParsed: unknown
  try {
    legacyParsed = JSON.parse(legacyRaw)
  } catch {
    return null
  }
  if (!isPersistedTextPlacementTestState(legacyParsed)) return null
  await saveTextPlacementTestState(legacyParsed)
  return legacyParsed
}

export async function saveTextPlacementTestState(state: PersistedTextPlacementTestState): Promise<void> {
  await runStateStoreOperation<IDBValidKey>('readwrite', (store) => store.put(state, TEXT_PLACEMENT_TEST_STATE_ID))
  window.localStorage.removeItem(TEXT_PLACEMENT_TEST_STORAGE_KEY)
}

export async function clearTextPlacementTestState(): Promise<void> {
  await runStateStoreOperation<undefined>('readwrite', (store) => store.delete(TEXT_PLACEMENT_TEST_STATE_ID))
  window.localStorage.removeItem(TEXT_PLACEMENT_TEST_STORAGE_KEY)
}
