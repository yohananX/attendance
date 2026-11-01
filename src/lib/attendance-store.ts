export type EventType = "sign_in" | "sign_out";
export type EventSyncState = "pending" | "failed";

export interface AttendanceEvent {
  eventId: string;
  eventType: EventType;
  sessionRef: string;
  studentName?: string;
  parentPhone?: string;
  deviceEventAt: string;
  capturedOffline: boolean;
  deviceId: string;
  deviceSeq: number;
  dayKey: string;
  staffName: string;
  syncState: EventSyncState;
  syncError?: string;
}

export interface AttendanceRecord {
  sessionRef: string;
  studentName: string;
  parentPhone: string;
  dayKey: string;
  signedInAt: string | null;
  signedOutAt: string | null;
  signedInBy: string | null;
  signedOutBy: string | null;
  serverVersion: number;
  corrected: boolean;
  conflictType: string | null;
  lateSynced: boolean;
  needsReview: boolean;
  whatsappLaunchedAt: string | null;
  pendingEvents: AttendanceEvent[];
  syncError: string | null;
}

interface ServerRecord {
  sessionRef: string;
  studentName: string;
  parentPhone: string;
  dayKey: string;
  signedInAt: string | null;
  signedOutAt: string | null;
  signedInBy: string | null;
  signedOutBy: string | null;
  serverVersion: number;
  corrected: boolean;
  conflictType: string | null;
  lateSynced: boolean;
  needsReview: boolean;
  whatsappLaunchedAt: string | null;
}

const DATABASE_NAME = "grace-house-attendance";
const DATABASE_VERSION = 1;
const RECORDS_STORE = "attendance";
const DATASET_KEY = "gh_attendance_dataset";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support local attendance storage."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        database.createObjectStore(RECORDS_STORE, { keyPath: "sessionRef" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local attendance storage."));
    request.onblocked = () => reject(new Error("Local attendance storage is blocked by another tab."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Local attendance save was interrupted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save attendance on this device."));
  });
}

export function getAttendanceForDay(dayKey: string): Promise<AttendanceRecord[]> {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORDS_STORE, "readonly");
    const request = transaction.objectStore(RECORDS_STORE).getAll();
    request.onsuccess = () => {
      resolve((request.result as AttendanceRecord[])
        .filter((record) => record.dayKey === dayKey)
        .sort((a, b) => (b.signedInAt ?? "").localeCompare(a.signedInAt ?? "")));
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read local attendance."));
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not read local attendance."));
    };
  }));
}

export async function matchAttendanceDataset(datasetId: string): Promise<boolean> {
  const storedDatasetId = localStorage.getItem(DATASET_KEY);
  if (storedDatasetId === datasetId) return true;

  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORDS_STORE, "readonly");
    const request = transaction.objectStore(RECORDS_STORE).count();
    const done = transactionDone(transaction);
    const recordCount = await new Promise<number>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not check local attendance data."));
    });
    await done;

    if (storedDatasetId === null && recordCount === 0) {
      localStorage.setItem(DATASET_KEY, datasetId);
      return true;
    }
    return false;
  } finally {
    database.close();
  }
}

export function getStoredAttendanceDatasetId(): string | null {
  return localStorage.getItem(DATASET_KEY);
}

export async function clearAttendanceForDataset(datasetId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORDS_STORE, "readwrite");
    const store = transaction.objectStore(RECORDS_STORE);
    const done = transactionDone(transaction);

    let aborted = false;
    await new Promise<void>((resolve, reject) => {
      // Scan inside the request callback so the transaction stays active while we
      // decide whether to abort or to queue deletions. This avoids issuing deletes
      // against an inactive transaction after awaiting getAll().
      const allRequest = store.getAll();
      allRequest.onsuccess = () => {
        const records = allRequest.result as AttendanceRecord[];
        const unacknowledged = records.flatMap((record) => record.pendingEvents).filter(
          (event) => event.syncState === "pending" || event.syncState === "failed",
        );

        if (unacknowledged.length > 0) {
          // Block the dataset-mismatch clear: unacknowledged events must never be purged.
          aborted = true;
          transaction.abort();
          resolve();
          return;
        }

        // Only acknowledged/synced records remain, so it is safe to delete them.
        for (const record of records) {
          store.delete(record.sessionRef);
        }
        resolve();
      };
      allRequest.onerror = () => reject(allRequest.error ?? new Error("Could not read local attendance records."));
    });

    // transactionDone rejects when the transaction aborts. Handle that rejection so
    // the caller always receives the intended D6 error and never an unhandled
    // promise rejection.
    try {
      await done;
    } catch {
      if (aborted) {
        throw new Error(
          `Cannot clear dataset "${datasetId}": unacknowledged attendance event(s) saved on this device have not been acknowledged by the server. Sync them first, or resolve them in review, then clear again.`,
        );
      }
      throw new Error("Could not clear old device data.");
    }

    // Only rewrite the dataset identifier when the clear actually committed.
    if (!aborted) {
      localStorage.setItem(DATASET_KEY, datasetId);
    }
  } finally {
    database.close();
  }
}

export async function saveSignIn(
  record: AttendanceRecord,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORDS_STORE, "readwrite");
    transaction.objectStore(RECORDS_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveSignOut(
  sessionRef: string,
  event: AttendanceEvent,
  staffName: string,
): Promise<"saved" | "already_signed_out" | "not_found"> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite");
  const store = transaction.objectStore(RECORDS_STORE);
  try {
    const result = await new Promise<"saved" | "already_signed_out" | "not_found">((resolve, reject) => {
      const request = store.get(sessionRef);
      request.onsuccess = () => {
        const record = request.result as AttendanceRecord | undefined;
        if (!record) {
          resolve("not_found");
          return;
        }
        if (record.signedOutAt) {
          resolve("already_signed_out");
          return;
        }
        record.signedOutAt = event.deviceEventAt;
        record.signedOutBy = staffName;
        record.pendingEvents.push(event);
        record.syncError = null;
        store.put(record);
        resolve("saved");
      };
      request.onerror = () => reject(request.error ?? new Error("Could not find this student on the device."));
    });
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

function applyPendingEvents(record: AttendanceRecord, events: AttendanceEvent[]): AttendanceRecord {
  return events.reduce((current, event) => {
    if (event.eventType === "sign_in") {
      return {
        ...current,
        studentName: event.studentName ?? current.studentName,
        parentPhone: event.parentPhone ?? current.parentPhone,
        signedInAt: event.deviceEventAt,
        signedInBy: current.signedInBy ?? event.staffName,
      };
    }
    return {
      ...current,
      signedOutAt: event.deviceEventAt,
      signedOutBy: current.signedOutBy ?? event.staffName,
    };
  }, record);
}

export async function mergeServerAttendance(
  dayKey: string,
  serverRecords: ServerRecord[],
): Promise<AttendanceRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite");
  const store = transaction.objectStore(RECORDS_STORE);
  const done = transactionDone(transaction);
  const allRequest = store.getAll();
  try {
    const merged = await new Promise<AttendanceRecord[]>((resolve, reject) => {
      allRequest.onsuccess = () => {
        const existing = new Map(
          (allRequest.result as AttendanceRecord[])
            .filter((record) => record.dayKey === dayKey)
            .map((record) => [record.sessionRef, record]),
        );
        const serverRefs = new Set<string>();
        const output = serverRecords.map((serverRecord) => {
          serverRefs.add(serverRecord.sessionRef);
          const local = existing.get(serverRecord.sessionRef);
          const pendingEvents = local?.pendingEvents ?? [];
          const base: AttendanceRecord = {
            ...serverRecord,
            whatsappLaunchedAt: serverRecord.whatsappLaunchedAt ?? local?.whatsappLaunchedAt ?? null,
            pendingEvents,
            syncError: local?.syncError ?? null,
          };
          const projected = applyPendingEvents(base, pendingEvents);
          store.put(projected);
          return projected;
        });

        for (const local of existing.values()) {
          if (!serverRefs.has(local.sessionRef)) output.push(local);
        }
        resolve(output.sort((a, b) => (b.signedInAt ?? "").localeCompare(a.signedInAt ?? "")));
      };
      allRequest.onerror = () => reject(allRequest.error ?? new Error("Could not merge attendance from the server."));
    });
    await done;
    return merged;
  } finally {
    database.close();
  }
}

export async function getPendingEvents(
  includeFailed = false,
): Promise<AttendanceEvent[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORDS_STORE, "readonly");
    const request = transaction.objectStore(RECORDS_STORE).getAll();
    const done = transactionDone(transaction);
    const events = await new Promise<AttendanceEvent[]>((resolve, reject) => {
      request.onsuccess = () => {
        resolve((request.result as AttendanceRecord[])
          .flatMap((record) => record.pendingEvents)
          .filter((event) => includeFailed || event.syncState === "pending")
          .sort((a, b) => a.deviceEventAt.localeCompare(b.deviceEventAt)));
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read pending attendance."));
    });
    await done;
    return events;
  } finally {
    database.close();
  }
}

export async function updatePendingEvent(
  eventId: string,
  accepted: boolean,
  errorMessage?: string,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite");
  const store = transaction.objectStore(RECORDS_STORE);
  const allRequest = store.getAll();
  allRequest.onsuccess = () => {
    for (const record of allRequest.result as AttendanceRecord[]) {
      const event = record.pendingEvents.find((item) => item.eventId === eventId);
      if (!event) continue;
      if (accepted) {
        record.pendingEvents = record.pendingEvents.filter((item) => item.eventId !== eventId);
        record.syncError = null;
      } else {
        event.syncState = "failed";
        event.syncError = errorMessage ?? "The server did not accept this attendance record.";
        record.syncError = event.syncError;
      }
      store.put(record);
      break;
    }
  };
  try {
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function retryFailedEvents(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite");
  const store = transaction.objectStore(RECORDS_STORE);
  const allRequest = store.getAll();
  allRequest.onsuccess = () => {
    for (const record of allRequest.result as AttendanceRecord[]) {
      let changed = false;
      for (const event of record.pendingEvents) {
        if (event.syncState === "failed") {
          event.syncState = "pending";
          event.syncError = undefined;
          changed = true;
        }
      }
      if (changed) {
        record.syncError = null;
        store.put(record);
      }
    }
  };
  try {
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function setLocalWhatsAppLaunch(
  sessionRef: string,
  launchedAt: string,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite");
  const store = transaction.objectStore(RECORDS_STORE);
  const request = store.get(sessionRef);
  request.onsuccess = () => {
    const record = request.result as AttendanceRecord | undefined;
    if (record) {
      record.whatsappLaunchedAt = record.whatsappLaunchedAt ?? launchedAt;
      store.put(record);
    }
  };
  try {
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function getDeviceId(): string {
  const existing = localStorage.getItem("gh_device_id");
  if (existing) return existing;
  const deviceId = crypto.randomUUID();
  localStorage.setItem("gh_device_id", deviceId);
  return deviceId;
}

export interface CachedStaffSession {
  staffName: string;
  expiresAt: number;
}

const STAFF_SESSION_KEY = "gh_staff_session";

export function saveCachedStaffSession(
  staffName: string,
  expiresAt = Date.now() + 12 * 60 * 60 * 1000,
): CachedStaffSession {
  const session = { staffName, expiresAt };
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getCachedStaffSession(): CachedStaffSession | null {
  const raw = localStorage.getItem(STAFF_SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CachedStaffSession>;
    if (
      typeof value.staffName !== "string" ||
      !value.staffName.trim() ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(STAFF_SESSION_KEY);
      return null;
    }
    return { staffName: value.staffName, expiresAt: value.expiresAt };
  } catch {
    localStorage.removeItem(STAFF_SESSION_KEY);
    return null;
  }
}

export function clearCachedStaffSession(): void {
  localStorage.removeItem(STAFF_SESSION_KEY);
}
