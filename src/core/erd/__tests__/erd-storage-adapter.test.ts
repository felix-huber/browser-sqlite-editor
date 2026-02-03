import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  toErdFilename,
  getStorageAdapter,
  setStorageAdapter,
  resetStorageAdapter,
} from '../erd-storage-adapter'
import { checkOPFSAvailability } from '../../engine/opfs-vfs'

vi.mock('../../engine/opfs-vfs', () => ({
  checkOPFSAvailability: vi.fn(),
}))

const mockedCheck = vi.mocked(checkOPFSAvailability)

describe('erd-storage-adapter', () => {
  const originalStorage = navigator.storage
  let fileContents: Map<string, string>

  beforeEach(() => {
    fileContents = new Map()
    mockedCheck.mockResolvedValue({ available: true })

    const fakeDir = {
      getDirectoryHandle: vi.fn(async () => fakeDir),
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        if (!options?.create && !fileContents.has(name)) {
          throw new DOMException('Not found', 'NotFoundError')
        }
        return {
          getFile: async () => ({
            text: async () => fileContents.get(name) ?? '',
          }),
          createWritable: async () => ({
            write: async (content: string) => {
              fileContents.set(name, String(content))
            },
            close: async () => undefined,
          }),
        }
      }),
      removeEntry: vi.fn(async (name: string) => {
        if (!fileContents.has(name)) {
          throw new DOMException('Not found', 'NotFoundError')
        }
        fileContents.delete(name)
      }),
    }

    Object.defineProperty(navigator, 'storage', {
      value: { getDirectory: vi.fn(async () => fakeDir) },
      configurable: true,
    })
  })

  afterEach(() => {
    if (originalStorage) {
      Object.defineProperty(navigator, 'storage', {
        value: originalStorage,
        configurable: true,
      })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).storage
    }
    resetStorageAdapter()
    vi.clearAllMocks()
  })

  it('sanitizes db names for ERD sidecar files', () => {
    expect(toErdFilename('My DB:Name*?')).toBe('my_db_name__.erd.json')
  })

  it('supports setting and resetting custom adapter', () => {
    const custom = {
      isOpfsAvailable: vi.fn(async () => true),
      readSidecar: vi.fn(async () => null),
      writeSidecar: vi.fn(async () => undefined),
      deleteSidecar: vi.fn(async () => undefined),
    }

    setStorageAdapter(custom)
    expect(getStorageAdapter()).toBe(custom)

    resetStorageAdapter()
    expect(getStorageAdapter()).not.toBe(custom)
  })

  it('reads, writes, and deletes sidecar files via default adapter', async () => {
    resetStorageAdapter()
    const adapter = getStorageAdapter()

    await adapter.writeSidecar('My Db', 'layout')
    await expect(adapter.readSidecar('My Db')).resolves.toBe('layout')

    await adapter.deleteSidecar('My Db')
    await expect(adapter.readSidecar('My Db')).resolves.toBe(null)
  })

  it('returns false when OPFS availability check throws', async () => {
    mockedCheck.mockRejectedValueOnce(new Error('boom'))
    resetStorageAdapter()
    const adapter = getStorageAdapter()

    await expect(adapter.isOpfsAvailable()).resolves.toBe(false)
  })
})
