import { describe, expect, it } from 'vitest'
import {
  pruneStoredStartMillis,
  TASK_PROGRESS_START_STORAGE_PREFIX,
  writeStoredStartMillisToStorage,
} from '@/lib/query/hooks/useEstimatedTaskProgress'

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>()

  get length(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }

  keys(): readonly string[] {
    return Array.from(this.items.keys())
  }
}

class QuotaExceededStorage extends MemoryStorage {
  setItem(_key: string, _value: string): void {
    const error = new Error('quota exceeded') as Error & { name: string; code: number }
    error.name = 'QuotaExceededError'
    error.code = 22
    throw error
  }
}

function progressKey(key: string): string {
  return `${TASK_PROGRESS_START_STORAGE_PREFIX}${key}`
}

describe('estimated task progress storage cache', () => {
  it('does not throw when localStorage quota is exceeded while caching task progress start time', () => {
    const storage = new QuotaExceededStorage()

    expect(() => writeStoredStartMillisToStorage(storage, 'task:quota', 1_000, 1_000)).not.toThrow()
    expect(writeStoredStartMillisToStorage(storage, 'task:quota', 1_000, 1_000)).toBe(false)
  })

  it('prunes stale and invalid task progress start keys before writing a new key', () => {
    const storage = new MemoryStorage()
    const now = 10 * 24 * 60 * 60 * 1000
    storage.setItem(progressKey('task:stale'), String(now - 8 * 24 * 60 * 60 * 1000))
    storage.setItem(progressKey('task:invalid'), 'not-a-number')
    storage.setItem(progressKey('task:recent'), String(now - 60_000))

    expect(writeStoredStartMillisToStorage(storage, 'task:new', now, now)).toBe(true)

    expect(storage.getItem(progressKey('task:stale'))).toBeNull()
    expect(storage.getItem(progressKey('task:invalid'))).toBeNull()
    expect(storage.getItem(progressKey('task:recent'))).toBe(String(now - 60_000))
    expect(storage.getItem(progressKey('task:new'))).toBe(String(now))
  })

  it('limits task progress start keys so completed task history cannot fill localStorage', () => {
    const storage = new MemoryStorage()
    const now = 1_000_000
    for (let index = 0; index < 140; index += 1) {
      storage.setItem(progressKey(`task:${index}`), String(now - index))
    }

    pruneStoredStartMillis(storage, now)

    const progressKeys = storage.keys().filter((key) => key.startsWith(TASK_PROGRESS_START_STORAGE_PREFIX))
    expect(progressKeys).toHaveLength(120)
  })
})
