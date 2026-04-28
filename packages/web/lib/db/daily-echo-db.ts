/**
 * Daily Echo Report Storage (IndexedDB)
 *
 * Persist generated reports for offline access and history
 */

import type { DailyEchoReport } from '../daily-echo/types';

const DB_NAME = 'mindos-daily-echo';
const DB_VERSION = 1;
const STORE_NAME = 'reports';

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) {
    return db;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error}`));
    };

    request.onupgradeneeded = event => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'date' });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
  });
}

/**
 * Save a daily echo report
 */
export async function saveDailyEchoReport(
  report: DailyEchoReport
): Promise<void> {
  const database = await initDB();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.put(report);

    request.onerror = () => {
      reject(
        new Error(
          `Failed to save report: ${request.error?.message || 'Unknown error'}`
        )
      );
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

/**
 * Get a report by date
 */
export async function getDailyEchoReport(
  date: string
): Promise<DailyEchoReport | null> {
  const database = await initDB();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.get(date);

    request.onerror = () => {
      reject(
        new Error(
          `Failed to get report: ${request.error?.message || 'Unknown error'}`
        )
      );
    };

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

/**
 * Get all reports
 */
export async function getAllDailyEchoReports(): Promise<
  DailyEchoReport[]
> {
  const database = await initDB();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.getAll();

    request.onerror = () => {
      reject(
        new Error(
          `Failed to get reports: ${request.error?.message || 'Unknown error'}`
        )
      );
    };

    request.onsuccess = () => {
      resolve(request.result ?? []);
    };
  });
}

/**
 * Delete a report by date
 */
export async function deleteDailyEchoReport(date: string): Promise<void> {
  const database = await initDB();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.delete(date);

    request.onerror = () => {
      reject(
        new Error(
          `Failed to delete report: ${request.error?.message || 'Unknown error'}`
        )
      );
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

/**
 * Clean up old reports (keep only last N days)
 */
export async function cleanupOldReports(
  daysToKeep: number = 30
): Promise<void> {
  const database = await initDB();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const cutoff = Date.now() - daysToKeep * 86400000; // milliseconds

  return new Promise((resolve, reject) => {
    const getAllRequest = store.getAll();

    getAllRequest.onerror = () => {
      reject(
        new Error(
          `Failed to cleanup reports: ${getAllRequest.error?.message || 'Unknown error'}`
        )
      );
    };

    getAllRequest.onsuccess = () => {
      const reports = getAllRequest.result ?? [];
      const toDelete: string[] = [];

      for (const report of reports) {
        const reportTime = new Date(report.generatedAt).getTime();
        if (reportTime < cutoff) {
          toDelete.push(report.date);
        }
      }

      for (const date of toDelete) {
        const deleteRequest = store.delete(date);
        deleteRequest.onerror = () => {
          console.warn(`Failed to delete old report: ${date}`);
        };
      }

      resolve();
    };
  });
}
