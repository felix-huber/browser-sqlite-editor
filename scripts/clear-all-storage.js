/**
 * Clear All Storage Script for wasm-sqlite-editor
 *
 * This script completely clears all browser storage used by the SQLite editor:
 * - localStorage
 * - IndexedDB (all relevant databases)
 * - OPFS (Origin Private File System)
 *
 * Run this in the browser DevTools console when experiencing persistent
 * sqlite3_open_v2 errors or stale database entries after "clear site data".
 *
 * Usage:
 * 1. Open your app in the browser
 * 2. Open DevTools (F12 or Cmd+Opt+I)
 * 3. Go to Console tab
 * 4. Paste and run this entire script
 * 5. Refresh the page (Cmd+R or F5)
 */

(async function clearAllStorage() {
  console.log('='.repeat(60));
  console.log('Clearing all wasm-sqlite-editor storage...');
  console.log('='.repeat(60));

  const results = {
    localStorage: { success: false, details: '' },
    indexedDB: { success: false, details: [] },
    opfs: { success: false, details: [] },
  };

  // =========================================================================
  // 1. Clear localStorage
  // =========================================================================
  console.log('\n[1/3] Clearing localStorage...');
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        keysToRemove.push(key);
      }
    }

    // Remove all keys (iterate in reverse to avoid index shifting issues)
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    results.localStorage.success = true;
    results.localStorage.details = `Removed ${keysToRemove.length} keys`;
    console.log(`  OK: ${results.localStorage.details}`);
  } catch (err) {
    results.localStorage.details = err.message;
    console.error('  ERROR:', err.message);
  }

  // =========================================================================
  // 2. Clear IndexedDB databases
  // =========================================================================
  console.log('\n[2/3] Clearing IndexedDB databases...');

  const idbDatabases = [
    'sqlite-editor-registry', // Database registry
    'idb-batch-atomic', // IDB VFS storage (IDB_VFS_NAME)
    'idb-sqlite', // Legacy snapshot storage
  ];

  for (const dbName of idbDatabases) {
    try {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
          console.warn(`  BLOCKED: "${dbName}" - close all tabs using this site`);
          // Still resolve, as the deletion will complete when tabs close
          resolve();
        };
      });
      results.indexedDB.details.push({ name: dbName, status: 'deleted' });
      console.log(`  OK: Deleted "${dbName}"`);
    } catch (err) {
      results.indexedDB.details.push({ name: dbName, status: 'error', error: err.message });
      console.error(`  ERROR: "${dbName}" - ${err.message}`);
    }
  }

  // Also try to find and delete any other sqlite-related databases
  if (indexedDB.databases) {
    try {
      const allDbs = await indexedDB.databases();
      for (const db of allDbs) {
        if (
          db.name &&
          !idbDatabases.includes(db.name) &&
          (db.name.includes('sqlite') || db.name.includes('sql'))
        ) {
          try {
            await new Promise((resolve, reject) => {
              const request = indexedDB.deleteDatabase(db.name);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
              request.onblocked = () => resolve();
            });
            results.indexedDB.details.push({ name: db.name, status: 'deleted (discovered)' });
            console.log(`  OK: Deleted "${db.name}" (discovered)`);
          } catch (err) {
            console.warn(`  WARN: Could not delete "${db.name}": ${err.message}`);
          }
        }
      }
    } catch {
      // indexedDB.databases() not supported in all browsers
    }
  }

  results.indexedDB.success = true;

  // =========================================================================
  // 3. Clear OPFS (Origin Private File System)
  // =========================================================================
  console.log('\n[3/3] Clearing OPFS directories...');

  const opfsDirs = [
    'wasm-sqlite-editor', // New layout
    'sqlite-editor', // Legacy layout
  ];

  if (navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();

      for (const dirName of opfsDirs) {
        try {
          // Try to get the directory handle first
          const dirHandle = await root.getDirectoryHandle(dirName);

          // Count files before deletion
          let fileCount = 0;
          try {
            for await (const entry of dirHandle.values()) {
              fileCount++;
            }
          } catch {
            // Ignore counting errors
          }

          // Delete the entire directory recursively
          await root.removeEntry(dirName, { recursive: true });

          results.opfs.details.push({
            name: dirName,
            status: 'deleted',
            fileCount,
          });
          console.log(`  OK: Deleted "/${dirName}/" (${fileCount} entries)`);
        } catch (err) {
          if (err.name === 'NotFoundError') {
            results.opfs.details.push({ name: dirName, status: 'not found' });
            console.log(`  SKIP: "/${dirName}/" does not exist`);
          } else {
            results.opfs.details.push({ name: dirName, status: 'error', error: err.message });
            console.error(`  ERROR: "/${dirName}/" - ${err.message}`);
          }
        }
      }

      results.opfs.success = true;
    } catch (err) {
      console.error('  ERROR: Could not access OPFS root:', err.message);
      results.opfs.details.push({ name: 'root', status: 'error', error: err.message });
    }
  } else {
    console.log('  SKIP: OPFS not available in this browser');
    results.opfs.success = true;
    results.opfs.details.push({ name: 'opfs', status: 'not available' });
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('\nlocalStorage:', results.localStorage.success ? 'OK' : 'FAILED');
  console.log('  -', results.localStorage.details);

  console.log('\nIndexedDB:', results.indexedDB.success ? 'OK' : 'PARTIAL');
  results.indexedDB.details.forEach((db) => {
    console.log(`  - ${db.name}: ${db.status}${db.error ? ` (${db.error})` : ''}`);
  });

  console.log('\nOPFS:', results.opfs.success ? 'OK' : 'FAILED');
  results.opfs.details.forEach((dir) => {
    const extra = dir.fileCount !== undefined ? ` (${dir.fileCount} entries)` : '';
    console.log(`  - ${dir.name}: ${dir.status}${extra}${dir.error ? ` (${dir.error})` : ''}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('NEXT STEPS:');
  console.log('1. Close ALL other tabs/windows with this site open');
  console.log('2. Refresh this page (Cmd+R or F5)');
  console.log('3. The app should start fresh with no databases');
  console.log('='.repeat(60));

  return results;
})();
