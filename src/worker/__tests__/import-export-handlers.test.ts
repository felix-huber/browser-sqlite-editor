import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  storage: {
    flush: vi.fn(),
    flushAndClose: vi.fn(),
  },
  registry: {
    isInitialized: vi.fn(),
    init: vi.fn(),
  },
  importDatabase: vi.fn(),
  exportDatabaseBlob: vi.fn(),
}))

vi.mock('../idb-storage', () => ({
  getIDBStorage: () => mocks.storage,
}))

vi.mock('../db-registry', () => ({
  getRegistry: () => mocks.registry,
}))

vi.mock('../file-import', () => ({
  importDatabase: mocks.importDatabase,
}))

vi.mock('../storage', () => ({
  exportDatabaseBlob: mocks.exportDatabaseBlob,
}))

import {
  handleFlushSnapshotRequest,
  handleExportRequest,
  handleImportRequest,
  handleImportOpfsRequest,
  handleFlushAndCloseRequest,
} from '../handlers/import-export'

describe('import/export handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.registry.isInitialized.mockReturnValue(true)
  })

  it('handleFlushSnapshotRequest returns success on flush', async () => {
    mocks.storage.flush.mockResolvedValue({ success: true })
    const postResponse = vi.fn()

    await handleFlushSnapshotRequest({ type: 'flushSnapshot' }, 1, postResponse)

    expect(postResponse).toHaveBeenCalledWith({ type: 'success' }, 1)
  })

  it('handleFlushSnapshotRequest returns error when flush fails', async () => {
    mocks.storage.flush.mockResolvedValue({
      success: false,
      error: { code: 'IDB_FLUSH_FAILED', message: 'nope' },
    })
    const postResponse = vi.fn()

    await handleFlushSnapshotRequest({ type: 'flushSnapshot' }, 2, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'nope', code: 'IDB_FLUSH_FAILED' },
      2
    )
  })

  it('handleFlushSnapshotRequest returns error on exception', async () => {
    mocks.storage.flush.mockRejectedValue(new Error('boom'))
    const postResponse = vi.fn()

    await handleFlushSnapshotRequest({ type: 'flushSnapshot' }, 3, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'Failed to flush snapshot: boom', code: 'UNKNOWN' },
      3
    )
  })

  it('handleExportRequest returns blob on success', async () => {
    const blob = new Blob(['data'])
    mocks.exportDatabaseBlob.mockResolvedValue(blob)
    const postResponse = vi.fn()

    await handleExportRequest({ type: 'export', dbName: 'db1' }, 4, postResponse)

    expect(postResponse).toHaveBeenCalledWith({ type: 'success', data: blob }, 4)
  })

  it('handleExportRequest maps not found to NOT_FOUND', async () => {
    mocks.exportDatabaseBlob.mockRejectedValue(new Error('db not found'))
    const postResponse = vi.fn()

    await handleExportRequest({ type: 'export', dbName: 'missing' }, 5, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'Export failed: db not found', code: 'NOT_FOUND' },
      5
    )
  })

  it('handleImportRequest uses IDB mode and emits progress', async () => {
    mocks.importDatabase.mockImplementation(async (_file: File, options: { onProgress?: (n: number) => void }) => {
      options.onProgress?.(40)
      return {
        success: true,
        dbId: '1',
        dbName: 'db1',
        storageType: 'idb',
        fileSize: 123,
      }
    })
    const postResponse = vi.fn()
    const postBroadcast = vi.fn()

    await handleImportRequest(
      { type: 'import', file: new File(['data'], 'db.sqlite'), nameHint: 'db1' },
      6,
      postResponse,
      postBroadcast
    )

    expect(mocks.importDatabase).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ storageMode: 'idb', nameHint: 'db1' })
    )
    expect(postBroadcast).toHaveBeenCalledWith({
      type: 'progress',
      percent: 40,
      message: 'Importing database...',
    })
    expect(postResponse).toHaveBeenCalledWith(
      {
        type: 'success',
        data: { dbId: '1', dbName: 'db1', storageType: 'idb', fileSize: 123 },
      },
      6
    )
  })

  it('handleImportOpfsRequest uses OPFS mode', async () => {
    mocks.importDatabase.mockResolvedValue({
      success: true,
      dbId: '2',
      dbName: 'db2',
      storageType: 'opfs',
      fileSize: 321,
    })
    const postResponse = vi.fn()
    const postBroadcast = vi.fn()

    await handleImportOpfsRequest(
      { type: 'importOpfs', file: new File(['data'], 'db.sqlite'), nameHint: 'db2' },
      7,
      postResponse,
      postBroadcast
    )

    expect(mocks.importDatabase).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ storageMode: 'opfs', nameHint: 'db2' })
    )
  })

  it('handleImportRequest returns error when import fails', async () => {
    mocks.importDatabase.mockResolvedValue({
      success: false,
      message: 'bad import',
      code: 'IMPORT_FAILED',
    })
    const postResponse = vi.fn()
    const postBroadcast = vi.fn()

    await handleImportRequest(
      { type: 'import', file: new File(['data'], 'db.sqlite') },
      8,
      postResponse,
      postBroadcast
    )

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'bad import', code: 'IMPORT_FAILED' },
      8
    )
  })

  it('handleFlushAndCloseRequest returns error on exception', async () => {
    mocks.storage.flushAndClose.mockRejectedValue(new Error('nope'))
    const postResponse = vi.fn()

    await handleFlushAndCloseRequest({ type: 'flushAndClose', dbId: 'db1' }, 9, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      {
        type: 'flushAndCloseResult',
        success: false,
        error: {
          code: 'IDB_FLUSH_FAILED',
          message: 'Unexpected error during flushAndClose: nope',
          attempts: 0,
        },
      },
      9
    )
  })
})
