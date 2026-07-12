import type { LogContext } from './types'
type AsyncStorageLike<T> = {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
  enterWith(store: T): void
}

function createLogContextStorage(): AsyncStorageLike<LogContext> | null {
  if (typeof window !== 'undefined') return null
  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: {
      getBuiltinModule?: (id: string) => unknown
    }
  }).process
  const asyncHooks = runtimeProcess?.getBuiltinModule?.('node:async_hooks') as {
    AsyncLocalStorage?: new <T>() => AsyncStorageLike<T>
  } | undefined
  if (!asyncHooks?.AsyncLocalStorage) {
    throw new Error('LOG_CONTEXT_ASYNC_LOCAL_STORAGE_REQUIRED')
  }
  return new asyncHooks.AsyncLocalStorage<LogContext>()
}

const logContextStorage = createLogContextStorage()
let fallbackContext: LogContext = {}

function getCurrentContext(): LogContext {
  return logContextStorage?.getStore() || fallbackContext
}

export function withLogContext<T>(context: LogContext, fn: () => Promise<T>): Promise<T>
export function withLogContext<T>(context: LogContext, fn: () => T): T
export function withLogContext<T>(context: LogContext, fn: () => T | Promise<T>): T | Promise<T> {
  const merged = { ...getCurrentContext(), ...context }
  if (logContextStorage) {
    return logContextStorage.run(merged, fn)
  }

  const previous = fallbackContext
  fallbackContext = merged
  const result = fn()
  if (result && typeof (result as PromiseLike<T>).then === 'function') {
    return (result as Promise<T>).finally(() => {
      fallbackContext = previous
    })
  }
  fallbackContext = previous
  return result
}

export function getLogContext(): LogContext {
  return getCurrentContext()
}

export function setLogContext(context: Partial<LogContext>): void {
  const merged = {
    ...getCurrentContext(),
    ...context,
  }

  if (logContextStorage) {
    logContextStorage.enterWith(merged)
    return
  }

  fallbackContext = merged
}
